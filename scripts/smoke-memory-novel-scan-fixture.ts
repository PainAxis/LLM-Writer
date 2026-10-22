/** Frozen controlled-provider pipeline. No live service, credentials, browser, or real-model claim. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { FactGraphDocument, FactAnchor } from '../src/types/factGraph'
import type { MemoryProjectInput } from '../src/types/memory'
import type { NovelScanCandidate, NovelScanGenerationRequest, NovelScanInput, NovelScanPage, PreparedNovelScan } from '../src/types/memoryNovelScan'
import { MemoryIndex } from '../src/services/memory/engine'
import { buildNovelPrompt, parseNovelCandidateResponse, parseNovelCueResponse } from '../src/services/memory/novelScanProtocol'
import { createNovelConnectionPlanner, planNovelWindows } from '../src/services/memory/novelScanPlan'
import { createFactPlotLink, resolveFactAnchors, selectFactPlotLinks } from '../src/services/memory/factGraph'
import { readFactGraph, saveFactGraph } from '../src/services/memory/factGraphStore'
import { buildLongProfile, buildEscapingProfile } from './fixtures/novel-candidate-long-profile.mjs'

const mutant = process.argv.find(argument => argument.startsWith('--mutant='))?.slice('--mutant='.length)
assert.ok(mutant === undefined || mutant === 'always-empty' || mutant === 'wrong-meaning', 'Unknown mutation control')
const FROZEN_SHA256 = '6d54c1cc1a02d0fe1b4b7580b21c8e5fb02d13f15e9f712b853e6721b67a8206'
const fixtureBytes = readFileSync(new URL('./fixtures/novel-candidate-scan-v1.json', import.meta.url))
assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'), FROZEN_SHA256, 'Do not silently edit frozen gold')
const fixture = JSON.parse(fixtureBytes.toString())
assert.equal(fixture.cases.length, 24)
const positive = fixture.cases.filter((item: any) => item.category === 'positive')
const negative = fixture.cases.filter((item: any) => item.category === 'negative')
const unsupported = fixture.cases.filter((item: any) => item.category === 'unsupported')
assert.deepEqual([positive.length, negative.length, unsupported.length], [12, 6, 6])
const sources = new Map<string, any>(fixture.corpus.map((source: any) => [source.sourceId, source]))
const sourceFor = (id: string) => { const source = sources.get(id); assert.ok(source); return source }

// Exclusive commit-aware IDB double exercises the real graph store and CAS code.
interface Request { result?: unknown; onsuccess?: () => void; onerror?: () => void }
const disk = new Map<string, string>(), storage = new Map<string, string>()
let queue = Promise.resolve(), graphWrites = 0
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, String(value)),
  removeItem: (key: string) => storage.delete(key), clear: () => storage.clear(),
} })
storage.set('apiConfig', JSON.stringify({ apiKey: 'synthetic-not-a-credential', baseURL: 'https://fixture.invalid/v1', provider: 'custom', selectedModel: 'novel-scan-fixture', maxTokens: 2048, temperature: 0, customHeaders: {} }))
Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open() {
  const request: Request = {}
  queueMicrotask(() => {
    request.result = { objectStoreNames: { contains: () => true }, close() {}, transaction(name: string, mode: string) {
      assert.equal(name, 'kv')
      const reads: Array<{ key: string; request: Request }> = [], writes: Array<[string, string]> = []
      let aborted = false
      const tx = { oncomplete: undefined as (() => void) | undefined, onabort: undefined as (() => void) | undefined,
        abort() { aborted = true }, objectStore() { return {
          get(key: string) { const read: Request = {}; reads.push({ key, request: read }); return read },
          put(value: string, key: string) { assert.equal(mode, 'readwrite'); writes.push([key, value]) },
        } } }
      queue = queue.then(async () => {
        for (const read of reads) { read.request.result = disk.get(read.key); read.request.onsuccess?.() }
        if (aborted) tx.onabort?.()
        else { for (const [key, value] of writes) { disk.set(key, value); graphWrites++ }; tx.oncomplete?.() }
      })
      return tx
    } }
    request.onsuccess?.()
  })
  return request
} } })
let networkAttempts = 0
Object.defineProperty(globalThis, 'fetch', { configurable: true, value: () => { networkAttempts++; throw new Error('Network forbidden in frozen fixture evaluation') } })

const { prepareNovelCandidateScan } = await import('../src/services/memory/novelScan')
const report: any = { fixtureSha256: FROZEN_SHA256, mode: 'controlled-provider-production-pipeline', realModelQuality: 'not measured', cases: [], mutationControls: {}, geometry: [] }
function projectFor(test: any): MemoryProjectInput {
  return { id: `fixture:${test.id}`, title: 'TITLE_MUST_NOT_BE_TRANSMITTED', clues: [], chapters: test.sourceIds.map((id: string) => {
    const source = sourceFor(id); return { id: source.chapterId, title: source.chapterTitle, text: source.text }
  }) }
}
function candidatePremises(candidate: NovelScanCandidate) {
  return candidate.kind === 'relationship' ? [{ role: 'support', evidence: candidate.evidence }] : candidate.premises
}
function semanticMatch(test: any, candidate: NovelScanCandidate) {
  if (!test.gold.candidate) return false
  for (const [key, value] of Object.entries(test.gold.candidate)) if (JSON.stringify((candidate as any)[key]) !== JSON.stringify(value)) return false
  const actual = candidatePremises(candidate)
  return test.gold.requiredPremises.every((required: any) => {
    const group = actual.find(item => item.role === required.role)
    return group && required.sourceIds.every((id: string) => group.evidence.some(anchor => {
      const source = sourceFor(id)
      return anchor.chapterId === source.chapterId && anchor.start === 0 && anchor.end === source.text.length && anchor.quote === source.text
    }))
  })
}
function responseFor(test: any, request: NovelScanGenerationRequest) {
  const payload = JSON.parse(request.prompt)
  assert.deepEqual(Object.keys(payload).sort(), request.phase === 'collect' ? ['primaryReferences', 'sources', 'version'] : ['sources', 'version'])
  const current = payload.sources.map((source: any, index: number) => {
    assert.deepEqual(Object.keys(source).sort(), ['quote', 'reference']); assert.equal(source.reference, index + 1)
    const matched = test.sourceIds.map(sourceFor).find((item: any) => item.text === source.quote)
    assert.ok(matched, 'Only exact original prose enters controlled transport')
    assert.ok(test.sourceIds.indexOf(matched.sourceId) <= test.sourceIds.indexOf(test.throughSourceId), 'Future source is never dispatched')
    return { ...matched, reference: source.reference }
  })
  assert.ok(!request.prompt.includes('TITLE_MUST_NOT_BE_TRANSMITTED'))
  assert.ok(request.system.length + request.prompt.length <= 16_000)
  assert.ok(Buffer.byteLength(request.system + request.prompt) <= 48_000)
  if (request.phase === 'collect') return JSON.stringify({ version: 1, cues: current.flatMap((source: any) => source.cues.map((cue: any) => ({ ...cue, references: [source.reference] }))), saturated: false })
  const required = test.gold.requiredPremises.flatMap((group: any) => group.sourceIds)
  const complete = test.gold.candidate && required.every((id: string) => current.some((source: any) => source.sourceId === id))
  return JSON.stringify({ version: 1, candidates: complete && mutant !== 'always-empty' ? [{ ...test.gold.candidate, ...(mutant === 'wrong-meaning' && test.id === 'P01' ? { predicate: '互不相识且从未交谈' } : {}), premises: test.gold.requiredPremises.map((group: any) => ({ role: group.role, references: group.sourceIds.map((id: string) => current.find((source: any) => source.sourceId === id).reference) })) }] : [], saturated: false })
}
async function runToEnd(session: PreparedNovelScan, initial: NovelScanPage, generator: (request: NovelScanGenerationRequest) => Promise<string>) {
  let page = initial
  while (page.state === 'running_a') page = await session.advance(page)
  assert.equal(page.state, 'ready_b', JSON.stringify(page))
  const aCalls = page.progress.ledger.used.attempts
  page = await session.startB(page, generator)
  for (let bounded = 0; page.state === 'running_b'; bounded++) {
    assert.ok(bounded < 10_000, 'Finite fixture must terminate'); page = await session.advance(page)
  }
  assert.equal(page.state, 'reviewing_complete_for_contract', JSON.stringify(page))
  return { page, aCalls }
}
async function persist(session: PreparedNovelScan, page: NovelScanPage, candidate: NovelScanCandidate) {
  const guarded = await session.reviewCandidate(page, candidate.id)
  assert.ok(guarded)
  const before = await readFactGraph(candidate.projectId)
  const provenance = { campaignId: candidate.campaignId, segmentId: candidate.segmentId, jobId: candidate.jobId, candidateId: candidate.id }
  let next: FactGraphDocument
  if (candidate.kind === 'relationship') next = { ...before, relations: [...before.relations, { id: candidate.id, projectId: candidate.projectId,
    source: candidate.source, target: candidate.target, predicate: candidate.predicate, origin: candidate.origin,
    evidence: candidate.evidence, createdBy: 'model', authorConfirmed: false, semanticValidation: candidate.semanticValidation, provenance }] }
  else next = { ...before, plotLinks: [...before.plotLinks, createFactPlotLink({ id: candidate.id, projectId: candidate.projectId, mode: candidate.mode, title: candidate.title,
    explanation: candidate.explanation, origin: candidate.origin, premises: candidate.premises, provenance })] }
  const saved = await saveFactGraph(next, before.revision || null)
  const after = await session.notifyAccepted(page, candidate.id, before.revision || null, saved.revision)
  assert.equal((await readFactGraph(candidate.projectId)).revision, saved.revision)
  assert.equal(saved.version, 2)
  assert.equal((candidate.kind === 'relationship' ? saved.relations : saved.plotLinks).at(-1)!.authorConfirmed, false)
  return after
}

for (const test of fixture.cases) {
  const project = projectFor(test), index = new MemoryIndex(), stats = await index.sync(project)
  let currentProject = structuredClone(project)
  const throughChapterId = sourceFor(test.throughSourceId).chapterId
  const input: NovelScanInput = { project, stats, throughChapterId, graphRevision: null,
    assertOwner() {}, async assertFresh(expected) {
      assert.deepEqual(currentProject, project, 'Committed source changed')
      assert.equal((await readFactGraph(project.id)).revision || null, expected, 'External graph changed')
    } }
  const calls: Array<{ phase: string; sources: number; chars: number }> = []
  const generator = async (request: NovelScanGenerationRequest) => {
    await request.beforeRequest()
    calls.push({ phase: request.phase, sources: JSON.parse(request.prompt).sources.length, chars: request.prompt.length + request.system.length })
    return responseFor(test, request)
  }
  const writesBefore = graphWrites
  const session = await prepareNovelCandidateScan(input)
  assert.equal(calls.length, 0, 'Preparation is a no-transport preview')
  const first = await session.startA(session.preview, generator)
  const result = await runToEnd(session, first, generator)
  let page = result.page
  const aCalls = result.aCalls
  assert.equal(graphWrites, writesBefore, 'Full A+B scan never writes author graph')
  assert.equal(page.progress.sourceCoverage, 'complete')
  assert.equal(page.progress.connectionCoverage, 'complete_for_contract')
  assert.equal(page.progress.processedChars, project.chapters.slice(0, project.chapters.findIndex(chapter => chapter.id === throughChapterId) + 1).reduce((sum, chapter) => sum + chapter.text.length, 0))
  assert.equal(page.progress.ledger.used.attempts, calls.length)
  const candidates = page.candidates ?? [], matches = candidates.filter(candidate => semanticMatch(test, candidate))
  assert.equal(matches.length > 0, test.gold.expectedRecovery, test.id)
  if (test.category !== 'positive') assert.equal(candidates.length, 0, `${test.id}: empty is an explicit true negative or known miss, never a claimed semantic success`)
  for (const candidate of candidates) {
    assert.equal(candidate.authorConfirmed, false)
    assert.equal(candidate.semanticValidation, 'protocol-and-current-sources')
    for (const group of candidatePremises(candidate)) assert.ok(resolveFactAnchors(project, stats, throughChapterId, group.evidence))
    assert.ok(semanticMatch(test, candidate), 'Correct citation syntax alone is not semantic success')
    page = await persist(session, page, candidate)
  }
  const stored = await readFactGraph(project.id)
  assert.equal(stored.relations.length + stored.plotLinks.length, candidates.length)
  if (stored.plotLinks.length) {
    assert.equal(selectFactPlotLinks(project, stats, stored, throughChapterId).plotLinks.length, stored.plotLinks.length)
    currentProject = structuredClone(project); currentProject.chapters[0]!.text += '修订后旧引用应失效。'
    const changedStats = await index.sync(currentProject)
    assert.equal(selectFactPlotLinks(currentProject, changedStats, stored, throughChapterId).plotLinks.length, 0)
  }
  report.cases.push({ id: test.id, category: test.category, route: test.route, recovered: matches.length > 0, candidates: candidates.length,
    aCalls, bCalls: calls.length - aCalls, eligibleChars: page.progress.eligibleChars, processedChars: page.progress.processedChars,
    knownMiss: test.category === 'unsupported' ? test.gold.missDefinition : undefined })
}

assert.equal(report.cases.filter((test: any) => test.recovered).length, 12)
assert.ok(positive.every((test: any) => !semanticMatch(test, {} as NovelScanCandidate)), 'Always-empty mutant loses every positive')
const sample = positive[0], project = projectFor(sample), stats = await new MemoryIndex().sync(project)
const anchor: FactAnchor = { chapterId: project.chapters[0]!.id, sourceRevision: stats.chapters[0]!.revision, start: 0, end: project.chapters[0]!.text.length, quote: project.chapters[0]!.text }
const valid = { ...sample.gold.candidate, premises: [{ role: 'support', references: [1] }] }
const wrongMeaning = parseNovelCandidateResponse(JSON.stringify({ version: 1, candidates: [{ ...valid, predicate: '互不相识且从未交谈' }], saturated: false }), [anchor]).candidates[0]!
assert.ok(resolveFactAnchors(project, stats, anchor.chapterId, [anchor]))
assert.equal(semanticMatch(sample, wrongMeaning as NovelScanCandidate), false, 'Valid anchors with contradicted meaning must fail gold scoring')
for (const bad of [
  { ...valid, authorConfirmed: true }, { ...valid, premises: [{ role: 'support', references: [2] }] },
  { ...valid, source: { type: 'person', label: '不存在的人' } },
]) assert.throws(() => parseNovelCandidateResponse(JSON.stringify({ version: 1, candidates: [bad], saturated: false }), [anchor]))
assert.throws(() => parseNovelCandidateResponse('{"version":1,"version":1,"candidates":[],"saturated":false}', [anchor]))
assert.throws(() => parseNovelCueResponse(JSON.stringify({ version: 1, cues: [{ kind: 'event', keys: ['凭空实体'], references: [1] }], saturated: false }), [anchor], [1]))
report.mutationControls = { alwaysEmpty: { rejected: 12, recoveredTargets: '0/18' }, validCitationWrongMeaning: 'rejected by semantic gold, not parser', protocolForgeries: 5 }

// CPU-only full-coverage geometry uses the production planner, not a reimplementation.
for (const profile of [buildLongProfile(), buildEscapingProfile()]) {
  const project: MemoryProjectInput = { id: profile.id, title: 'Metadata is not source', clues: [], chapters: profile.chapters }
  const index = new MemoryIndex(), before = process.memoryUsage(), started = performance.now(), stats = await index.sync(project)
  const plan = await planNovelWindows(project, stats, profile.throughChapterId)
  const eligible = project.chapters.slice(0, plan.cutoff + 1)
  const primaryCounts = new Map<number, number>()
  for (const window of plan.windows) {
    for (const atom of window.primary) primaryCounts.set(atom, (primaryCounts.get(atom) ?? 0) + 1)
    const payload = buildNovelPrompt('collect', window.sources.map(id => plan.atoms[id]!), window.primaryReferences)
    assert.ok(payload.inputChars <= 16_000 && payload.inputBytes <= 48_000 && payload.sourceChars <= 8_000)
  }
  assert.equal(primaryCounts.size, plan.atoms.length)
  assert.ok([...primaryCounts.values()].every(count => count === 1), 'Every primary source atom exactly once, no sampling')
  for (const chapter of eligible) {
    const atoms = plan.atoms.filter(atom => atom.chapterId === chapter.id)
    assert.equal(atoms.map(atom => atom.quote).join(''), chapter.text)
    for (const atom of atoms) {
      assert.equal(chapter.text.slice(atom.start, atom.end), atom.quote)
      assert.ok(!/^[\uDC00-\uDFFF]/.test(atom.quote) && !/[\uD800-\uDBFF]$/.test(atom.quote), 'No surrogate half at source boundaries')
    }
  }
  assert.equal(plan.eligibleChars, eligible.reduce((sum, chapter) => sum + chapter.text.length, 0))
  // A six-source B job is also bounded even for worst-case JSON escaping.
  for (let offset = 0; offset < plan.atoms.length; offset += 6) buildNovelPrompt('connect', plan.atoms.slice(offset, offset + 6))
  report.geometry.push({ profile: profile.id, disclosedChapters: eligible.length, eligibleChars: plan.eligibleChars,
    windows: plan.windows.length, atoms: plan.atoms.length, cpuOnlyMs: Math.round(performance.now() - started),
    heapDeltaBytes: process.memoryUsage().heapUsed - before.heapUsed, rssBytes: process.memoryUsage().rss, providerCalls: 0 })
}
// Planner is not all-to-all: five unrelated cues omit distant endpoints.
const planned = [...createNovelConnectionPlanner(Array.from({ length: 5 }, (_, id) => ({ id, kind: 'event' as const, keys: [`独立${id}`], atoms: [id] })))].filter(Boolean)
assert.ok(!planned.some(job => job!.atoms.includes(0) && job!.atoms.includes(4)))
assert.equal(networkAttempts, 0)
report.summary = { recoveredAllStoryTargets: '12/18', recoveredDisclosedTargets: '12/17', recoveredInContractTargets: '12/12',
  negativeControls: '6/6', knownMisses: '6/6 honestly retained', productionCasWrites: graphWrites, networkRequests: 0, browser: 'not run', realModel: 'not run' }
console.log(JSON.stringify(report, null, 2))
console.log('PASS frozen novel-candidate semantic gold, production parsing/anchors/review/CAS-v2 pipeline and exact long/escaping geometry')
