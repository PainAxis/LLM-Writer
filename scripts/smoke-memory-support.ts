/** Controlled protocol/source/lifecycle checks; NOT a real-model accuracy evaluation. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { MemoryIndex } from '../src/services/memory/engine'
import { chapterRevision } from '../src/services/memory/revision'
import type { FactAnchor } from '../src/types/factGraph'
import type { MemoryProjectInput } from '../src/types/memory'
import type { SupportCheckInput, SupportResponseV1, SupportGenerationRequest, SupportCheckResult } from '../src/types/memorySupport'

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } })
const { buildSupportPrompt, parseSupportResponse, prepareSupportCheck, SupportCheckError, SUPPORT_CHECK_LIMITS: L } = await import('../src/services/memory/supportCheck')
const { useApiConfig } = await import('../src/services/apiConfig')

const fixtureRaw = readFileSync(new URL('./fixtures/support-check-fixture-v1.json', import.meta.url))
const frozenHash = 'ebf0a7ea662e6ddd3e2079598954888cd553c72ae74c666691ae822704b20c2d'
assert.equal(createHash('sha256').update(fixtureRaw).digest('hex'), frozenHash, 'Do not change gold after comparing outputs')
const fixture = JSON.parse(fixtureRaw.toString()) as {
  evaluation: { semanticCases: number; operationalCases: number }
  corpus: Array<{ sourceId: string; chapterId: string; chapterTitle: string; quote: string }>
  cases: Array<{ id: string; kind: string; category: string; question: string; throughChapterId: string;
    sourceExcerpts: Array<{ sourceId: string }>; controlledResponse: SupportResponseV1 | null;
    expected: { verdict: string; requiredPremiseIds: string[]; requiredAnswerFacts: string[]; forbiddenConclusions: string[]; maxAttemptedCalls: number; allowedReasons: string[] } }>
}
const originalFetch = globalThis.fetch
globalThis.fetch = async () => { throw new Error('Unmocked network is forbidden in support smoke tests') }
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function assessed(result: SupportCheckResult) { assert.equal(result.state, 'assessed'); if (result.state !== 'assessed') throw new Error('Expected assessed'); return result }
function rejected(result: SupportCheckResult, reason?: string) { assert.equal(result.state, 'unverified'); if (result.state !== 'unverified') throw new Error('Expected unverified'); if (reason) assert.equal(result.reason, reason) }
async function throwsReason(fn: () => Promise<unknown>, reason?: string) {
  await assert.rejects(fn, error => error instanceof SupportCheckError && (!reason || error.reason === reason))
}
const project: MemoryProjectInput = { id: 'support-synthetic', title: 'Synthetic only', clues: [], chapters: [] }
for (const source of fixture.corpus) {
  let chapter = project.chapters.find(chapter => chapter.id === source.chapterId)
  if (!chapter) { chapter = { id: source.chapterId, title: source.chapterTitle, text: '' }; project.chapters.push(chapter) }
  chapter.text += `${chapter.text ? '\n' : ''}${source.quote}`
}
project.chapters.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
const index = new MemoryIndex()
const stats = await index.sync(project)
const anchors = new Map<string, FactAnchor>()
for (const source of fixture.corpus) {
  const chapter = project.chapters.find(chapter => chapter.id === source.chapterId)!
  const start = chapter.text.indexOf(source.quote)
  anchors.set(source.sourceId, { chapterId: chapter.id, sourceRevision: await chapterRevision(chapter), start, end: start + source.quote.length, quote: source.quote })
}
const positive = fixture.cases.find(item => item.id === 'P01')!.controlledResponse!
const rawPositive = JSON.stringify(positive)
function source(ids = ['S1'], cutoff = 'c10', question = '顾行把银钥匙交给谁？') {
  const committed = copy(project)
  const signature = JSON.stringify(committed)
  let owner = true
  let guardHook: (() => Promise<void> | void) | undefined
  let ownerHook: (() => void) | undefined
  let guards = 0
  const input: SupportCheckInput = { question, project: copy(project), stats: copy(stats), throughChapterId: cutoff,
    evidence: ids.map(id => copy(anchors.get(id)!)), selectionFingerprint: 'selected-synthetic',
    assertOwner() { ownerHook?.(); if (!owner) throw new Error('owner replaced') },
    async assertFresh() { guards++; await guardHook?.(); if (JSON.stringify(committed) !== signature) throw new Error('committed sources changed') },
  }
  return { input, committed, loseOwner: () => { owner = false }, guard: (fn?: () => Promise<void> | void) => { guardHook = fn },
    onOwner: (fn?: () => void) => { ownerHook = fn }, get guards() { return guards } }
}

const suiteStarted = performance.now()
let maxInputChars = 0, maxInputBytes = 0, maxResponseChars = 0, maxResponseBytes = 0
const failureCategories: Record<string, number> = {}
let semanticCalls = 0
const recovered = { supported: 0, insufficient: 0, uncertain: 0 }
let validCitations = 0
let requiredPremises = 0
const semanticCases = fixture.cases.filter(item => item.kind === 'semantic')
for (const test of semanticCases) {
  const sample = source(test.sourceExcerpts.map(item => item.sourceId), test.throughChapterId, test.question)
  const plan = await prepareSupportCheck(sample.input)
  maxInputChars = Math.max(maxInputChars, plan.preview.inputChars)
  maxInputBytes = Math.max(maxInputBytes, plan.preview.inputBytes)
  const controlledRaw = JSON.stringify(test.controlledResponse)
  maxResponseChars = Math.max(maxResponseChars, controlledRaw.length)
  maxResponseBytes = Math.max(maxResponseBytes, new TextEncoder().encode(controlledRaw).byteLength)
  assert.equal(semanticCalls, semanticCases.slice(0, semanticCalls).length, 'preparation has no transport')
  let calls = 0
  const result = assessed(await plan.run(async request => {
    await request.beforeRequest(); calls++; semanticCalls++
    const wire = JSON.parse(request.prompt)
    assert.deepEqual(Object.keys(wire).sort(), ['question', 'sources', 'version'])
    assert.equal(wire.question, test.question)
    assert.ok(wire.sources.every((item: object) => JSON.stringify(Object.keys(item).sort()) === JSON.stringify(['quote', 'reference'])))
    assert.equal(request.maxOutputTokens, 1200)
    return JSON.stringify(test.controlledResponse)
  }))
  assert.equal(calls, 1)
  assert.equal(result.verdict, test.expected.verdict, test.id)
  assert.ok(test.expected.allowedReasons.includes(result.reason), test.id)
  for (const fact of test.expected.requiredAnswerFacts) assert.ok(result.answer?.includes(fact), `${test.id}: missing frozen answer fact`)
  assert.equal(result.answer, test.controlledResponse!.answer, `${test.id}: controlled answer must not be changed`)
  assert.equal(result.explanation, test.controlledResponse!.explanation)
  assert.deepEqual(result.missing, test.controlledResponse!.missing)
  assert.equal(result.scope, 'selected-excerpts'); assert.equal(result.manuscriptAbsenceEstablished, false)
  const cited = result.premises.flatMap(premise => premise.citations)
  for (const id of test.expected.requiredPremiseIds) {
    assert.ok(cited.some(anchor => anchor.quote === anchors.get(id)!.quote), `${test.id}: missing ${id}`)
    requiredPremises++
  }
  for (const citation of cited) {
    const chapter = project.chapters.find(chapter => chapter.id === citation.chapterId)!
    assert.equal(chapter.text.slice(citation.start, citation.end), citation.quote)
    validCitations++
  }
  recovered[result.verdict]++
}
assert.deepEqual(recovered, { supported: 12, insufficient: 6, uncertain: 7 })
// Both degenerate policies fail the frozen gold, even when mechanically well-formed.
const allRefusal = { version: 1, verdict: 'insufficient', reason: 'missing_premise', answer: null, explanation: '所选片段信息不全。', premises: [], missing: ['所需事实'] }
const allSupport = { ...positive }
let refusalFailures = 0, supportFailures = 0
for (const test of semanticCases) {
  const refusal = parseSupportResponse(JSON.stringify(allRefusal), test.sourceExcerpts.length)
  const support = parseSupportResponse(JSON.stringify(allSupport), test.sourceExcerpts.length)
  if (refusal.verdict !== test.expected.verdict) refusalFailures++
  if (support.verdict !== test.expected.verdict) supportFailures++
}
assert.equal(refusalFailures, 19); assert.equal(supportFailures, 13)
// Semantic failure intentionally remains possible despite valid protocol/current citations.
const sourceValidWrong = parseSupportResponse(JSON.stringify({ ...positive, answer: '错误答案。' }), 1)
assert.equal(sourceValidWrong.verdict, 'supported')
assert.ok(!fixture.cases[0]!.expected.requiredAnswerFacts.every(fact => sourceValidWrong.answer?.includes(fact)), 'Gold catches a source-valid but semantically wrong answer')
const chain = fixture.cases.find(item => item.category === 'two-premise-positive')
assert.ok(chain, 'Frozen two-premise case must exist')
{
  const missingCitation = { ...chain.controlledResponse!, premises: chain.controlledResponse!.premises.slice(0, 1) }
  missingCitation.reason = 'direct_statement'
  assert.ok(parseSupportResponse(JSON.stringify(missingCitation), chain.sourceExcerpts.length))
  const covered = missingCitation.premises.flatMap(item => item.references.map(ref => chain.sourceExcerpts[ref - 1]!.sourceId))
  assert.ok(chain.expected.requiredPremiseIds.some(id => !covered.includes(id)), 'Gold, not parser, catches omitted semantic premise')
}

let operational = 0
for (const test of fixture.cases.filter(item => item.kind === 'operational')) {
  const sample = source(test.sourceExcerpts.map(item => item.sourceId), test.throughChapterId, test.question)
  let attempts = 0
  if (test.id === 'G08') {
    const anchor = sample.input.evidence[0]!
    anchor.start++; anchor.quote = sample.input.project.chapters.find(chapter => chapter.id === anchor.chapterId)!.text.slice(anchor.start, anchor.end)
  }
  if (test.id === 'G01' || test.id === 'G08') {
    await throwsReason(() => prepareSupportCheck(sample.input), 'source_changed')
    failureCategories.source_changed = (failureCategories.source_changed ?? 0) + 1
  }
  else {
    const plan = await prepareSupportCheck(sample.input)
    if (test.id === 'G02') sample.guard(() => { sample.committed.chapters[0]!.text += '改' })
    const result = await plan.run(async request => {
      await request.beforeRequest(); attempts++
      if (test.id === 'G03') sample.committed.chapters[0]!.text += '改'
      if (test.id === 'G05') sample.loseOwner()
      if (test.id === 'G06') plan.cancel()
      return JSON.stringify(test.controlledResponse)
    })
    rejected(result)
    if (result.state === 'unverified') failureCategories[result.reason] = (failureCategories[result.reason] ?? 0) + 1
    if (test.id === 'G04' || test.id === 'G07') rejected(result, 'invalid_response')
    if (test.id === 'G02' || test.id === 'G03') rejected(result, 'source_changed')
  }
  assert.ok(attempts <= test.expected.maxAttemptedCalls, test.id)
  operational++
}
assert.equal(operational, 8)

// Strict schema fields, citation types and cross-field bounds.
const invalid = [
  rawPositive.replace('\"version\":1', '\"version\":1,\"version\":1'),
  rawPositive.replace('\"text\":', '\"text\":\"first\",\"text\":'),
  '```json\n' + rawPositive + '\n```', rawPositive + ' commentary', 'null', '[]', '{',
  ...[['direct_statement'], ['combined_premises'], {}, null, 1].map(reason => JSON.stringify({ ...positive, reason })),
  JSON.stringify({ ...positive, revision: 'model-owned' }), JSON.stringify({ ...positive, verdict: 'verified' }),
  JSON.stringify({ ...positive, answer: null }), JSON.stringify({ ...positive, missing: ['not allowed'] }),
  JSON.stringify({ ...positive, reason: 'combined_premises' }), JSON.stringify({ ...positive, explanation: '' }),
  ...[0, 2, -1, 1.5, '1'].map(ref => JSON.stringify({ ...positive, premises: [{ text: '事实', references: [ref] }] })),
  ...[[], [1, 1]].map(refs => JSON.stringify({ ...positive, premises: [{ text: '事实', references: refs }] })),
  JSON.stringify({ ...positive, premises: [{ text: '事实', references: [1], quote: 'model-owned' }] }),
  JSON.stringify({ ...positive, premises: [{ text: 'a'.repeat(241), references: [1] }] }),
  JSON.stringify({ ...positive, answer: 'a'.repeat(601) }), JSON.stringify({ ...positive, explanation: 'a'.repeat(601) }),
  JSON.stringify({ ...positive, premises: Array(5).fill(positive.premises[0]) }),
  JSON.stringify({ ...allRefusal, missing: [] }), JSON.stringify({ ...allRefusal, missing: ['a'.repeat(161)] }),
  JSON.stringify({ ...allRefusal, missing: Array(5).fill('fact') }),
]
for (const raw of invalid) assert.throws(() => parseSupportResponse(raw, 1), SupportCheckError)
assert.equal(parseSupportResponse(rawPositive.padEnd(8000, ' '), 1).verdict, 'supported')
assert.throws(() => parseSupportResponse(' '.repeat(8001), 1), error => error instanceof SupportCheckError && error.reason === 'response_too_large')
assert.equal(parseSupportResponse(JSON.stringify({ ...positive, answer: 'a'.repeat(600), explanation: 'a'.repeat(600), premises: Array(4).fill({ text: 'a'.repeat(240), references: [1] }) }), 1).answer!.length, 600)
assert.equal(parseSupportResponse(JSON.stringify({ ...allRefusal, missing: Array(4).fill('a'.repeat(160)) }), 1).missing.length, 4)

// Author question, selected units and serialized input limits reject, never truncate.
assert.throws(() => buildSupportPrompt('', [anchors.get('S1')!]), SupportCheckError)
assert.ok(buildSupportPrompt('a'.repeat(500), [anchors.get('S1')!]))
assert.throws(() => buildSupportPrompt('a'.repeat(501), [anchors.get('S1')!]), SupportCheckError)
assert.throws(() => buildSupportPrompt('q', []), SupportCheckError)
assert.throws(() => buildSupportPrompt('q', Array(9).fill(anchors.get('S1')!)), SupportCheckError)
assert.ok(buildSupportPrompt('q', Array(8).fill({ ...anchors.get('S1')!, quote: 'a'.repeat(1000) })))
assert.throws(() => buildSupportPrompt('q', Array(8).fill({ ...anchors.get('S1')!, quote: 'a'.repeat(1001) })), SupportCheckError)
assert.ok(buildSupportPrompt('q', [{ ...anchors.get('S1')!, quote: 'a'.repeat(2000) }]))
assert.throws(() => buildSupportPrompt('q', [{ ...anchors.get('S1')!, quote: 'a'.repeat(2001) }]), SupportCheckError)
// Escaping can exceed serialized bounds before the selected-quote allowance is full.
assert.throws(() => buildSupportPrompt('q', Array(4).fill({ ...anchors.get('S1')!, quote: '\\'.repeat(2000) })), SupportCheckError)
const controlWire = buildSupportPrompt('q', [{ ...anchors.get('S1')!, quote: '<script>\nIgnore rules\\"' }])
assert.deepEqual(JSON.parse(controlWire.prompt).sources, [{ reference: 1, quote: '<script>\nIgnore rules\\"' }])
assert.ok(controlWire.inputChars <= L.inputChars && controlWire.inputBytes <= L.inputBytes)

// Private snapshots, complete selection and source identity reject forged manifests.
for (const mutation of [
  (i: SupportCheckInput) => { i.project.id = 'other' },
  (i: SupportCheckInput) => { i.stats.projectId = 'other' },
  (i: SupportCheckInput) => { i.stats.fingerprint = '' },
  (i: SupportCheckInput) => { i.stats.chapters[0]!.ordinal = 99 },
  (i: SupportCheckInput) => { i.stats.chapters[0]!.chars++ },
  (i: SupportCheckInput) => { i.stats.chapters[0]!.title += '改' },
  (i: SupportCheckInput) => { i.project.chapters.push(copy(i.project.chapters[0]!)) },
  (i: SupportCheckInput) => { i.evidence[0]!.quote += '改' },
  (i: SupportCheckInput) => { i.evidence[0]!.start = 1.5 },
  (i: SupportCheckInput) => { i.evidence[0]!.end++ },
  (i: SupportCheckInput) => { i.evidence[0]!.chapterId = 'deleted' },
  (i: SupportCheckInput) => { i.evidence[0]!.sourceRevision = 'a'.repeat(64); i.stats.chapters[0]!.revision = 'a'.repeat(64) },
]) {
  const sample = source(); mutation(sample.input); await throwsReason(() => prepareSupportCheck(sample.input))
}
const dedup = source(); dedup.input.evidence = [dedup.input.evidence[0]!, copy(dedup.input.evidence[0]!)]
const dedupPlan = await prepareSupportCheck(dedup.input); assert.equal(dedupPlan.preview.sourceCount, 1); dedupPlan.cancel()
const privateSample = source()
const privatePlan = await prepareSupportCheck(privateSample.input)
privatePlan.preview.sources[0]!.quote = 'fake'; privatePlan.preview.question = 'fake'; privatePlan.preview.bounds.anchors = 999
privateSample.input.evidence[0]!.quote = 'mutated'; privateSample.input.project.chapters[0]!.text = 'mutated'
const privateResult = assessed(await privatePlan.run(async request => { assert.ok(!request.prompt.includes('fake')); assert.ok(!request.prompt.includes('mutated')); await request.beforeRequest(); return rawPositive }))
assert.equal(privateResult.premises[0]!.citations[0]!.quote, anchors.get('S1')!.quote)

// Cancellation before lazy dispatch; a stalled dependency cannot retain a running UI operation.
const cancelSample = source(); const cancelPlan = await prepareSupportCheck(cancelSample.input)
let cancelCalls = 0; cancelPlan.cancel(); rejected(await cancelPlan.run(async () => { cancelCalls++; return rawPositive }), 'cancelled'); assert.equal(cancelCalls, 0)
const stalled = source(); const stalledPlan = await prepareSupportCheck(stalled.input); stalled.guard(() => new Promise(() => undefined))
const stalledRun = stalledPlan.run(async () => rawPositive); stalledPlan.cancel()
rejected(await stalledRun, 'cancelled')
const pending = source(); const pendingPlan = await prepareSupportCheck(pending.input); const late = deferred<string>(); const started = deferred<void>()
const pendingRun = pendingPlan.run(async request => { await request.beforeRequest(); started.resolve(); return late.promise })
await started.promise; pendingPlan.cancel(); rejected(await pendingRun, 'cancelled'); late.resolve(rawPositive)

// Generic SDK sanitation must not erase a source/owner failure at guarded dispatch.
const sanitized = source(); const sanitizedPlan = await prepareSupportCheck(sanitized.input)
rejected(await sanitizedPlan.run(async request => {
  sanitized.committed.chapters[0]!.text += 'changed'
  try { await request.beforeRequest() } catch { throw Object.assign(new Error('safe transport failure'), { name: 'BoundedGenerationError', code: 'transport' }) }
  return rawPositive
}), 'source_changed')

// Double-click and already-used plans cannot call another transport.
const single = await prepareSupportCheck(source().input); let dispatches = 0
const generator = async (request: SupportGenerationRequest) => { await request.beforeRequest(); dispatches++; return rawPositive }
const first = single.run(generator); const second = single.run(generator); assert.equal(first, second)
assessed(await first); await single.run(generator); assert.equal(dispatches, 1)
const repeatedPreflight = await prepareSupportCheck(source().input)
rejected(await repeatedPreflight.run(async request => { await request.beforeRequest(); await request.beforeRequest(); return rawPositive }), 'request_limit')

// Slow dependencies ignoring cancellation still settle on per-guard/provider timers.
const setTimer = globalThis.setTimeout
try {
  globalThis.setTimeout = ((fn: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) =>
    setTimer(fn, Math.min(delay ?? 0, 5), ...args)) as typeof setTimeout
  const guardStall = source(); const guardPlan = await prepareSupportCheck(guardStall.input)
  guardStall.guard(() => new Promise(() => undefined))
  const guardFailure = await guardPlan.run(async () => rawPositive)
  rejected(guardFailure, 'timeout')
  assert.ok(guardFailure.state === 'unverified' && guardFailure.sourceValidationFailed)
  const providerPlan = await prepareSupportCheck(source().input)
  const providerFailure = await providerPlan.run(() => new Promise(() => undefined))
  rejected(providerFailure, 'timeout')
  assert.ok(providerFailure.state === 'unverified' && !providerFailure.sourceValidationFailed)
} finally { globalThis.setTimeout = setTimer }

// Deterministic race: source guard enters at provider+25s; outer deadline wins at +30s.
const deadlineRealNow = performance.now.bind(performance)
let deadlineOffset = 0
let providerDeadline: (() => void) | undefined
try {
  Object.defineProperty(performance, 'now', { configurable: true, value: () => deadlineRealNow() + deadlineOffset })
  globalThis.setTimeout = ((fn: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (delay === L.providerMs) providerDeadline = () => fn(...args)
    return setTimer(fn, delay, ...args)
  }) as typeof setTimeout
  const lateGuard = source(); const lateGuardPlan = await prepareSupportCheck(lateGuard.input)
  const lateGuardResult = await lateGuardPlan.run(async request => {
    deadlineOffset += 25000
    lateGuard.guard(() => {
      assert.ok(providerDeadline, 'Provider timer was established before its late source guard')
      deadlineOffset += 5000
      providerDeadline()
      return new Promise(() => undefined)
    })
    await request.beforeRequest()
    return rawPositive
  })
  rejected(lateGuardResult, 'timeout')
  assert.ok(lateGuardResult.state === 'unverified' && lateGuardResult.sourceValidationFailed,
    'The 30s provider deadline winning during a 25s-late source guard must still revoke source validation')
} finally {
  globalThis.setTimeout = setTimer
  Object.defineProperty(performance, 'now', { configurable: true, value: deadlineRealNow })
}

// Changes during local/pre-dispatch/response guards, including no storage event.
for (const boundary of ['ready', 'lazy', 'response'] as const) {
  const sample = source(); const plan = await prepareSupportCheck(sample.input); let dispatches = 0
  if (boundary === 'ready') sample.committed.chapters[0]!.title += 'changed'
  const result = await plan.run(async request => {
    if (boundary === 'lazy') sample.committed.chapters[0]!.text += 'changed'
    await request.beforeRequest(); dispatches++
    if (boundary === 'response') sample.committed.chapters[0]!.text += 'changed'
    return rawPositive
  })
  rejected(result, 'source_changed'); assert.equal(dispatches, boundary === 'response' ? 1 : 0)
}
const dead = source(); dead.loseOwner(); await throwsReason(() => prepareSupportCheck(dead.input), 'owner_changed')
const config = useApiConfig().apiConfig
const configOriginal = copy(config.value)
for (const key of ['selectedModel', 'baseURL', 'proxyUrl'] as const) {
  const plan = await prepareSupportCheck(source().input)
  config.value = { ...config.value, [key]: `${config.value[key] ?? ''}-changed` }
  config.value = copy(configOriginal) // Change and restore still invalidates this owner.
  let calls = 0; rejected(await plan.run(async () => { calls++; return rawPositive }), 'configuration_changed'); assert.equal(calls, 0)
}

// Virtual monotonic clock probes: expiry, total budget, and no extra tail allowance.
const realNow = performance.now.bind(performance)
let clock = 100
Object.defineProperty(performance, 'now', { configurable: true, value: () => clock })
try {
  const expired = await prepareSupportCheck(source().input); clock += L.readyMs
  rejected(await expired.run(async () => rawPositive), 'expired')
  const guardOverrun = source(); const guardOverrunPlan = await prepareSupportCheck(guardOverrun.input)
  guardOverrun.guard(() => { clock += L.guardMs })
  rejected(await guardOverrunPlan.run(async () => rawPositive), 'timeout')
  const sample = source(); const plan = await prepareSupportCheck(sample.input)
  const start = clock
  sample.guard(() => { clock += 9000 })
  rejected(await plan.run(async request => { await request.beforeRequest(); clock = start + 44000; return rawPositive }), 'timeout')
  const tailSample = source(); const tailPlan = await prepareSupportCheck(tailSample.input)
  const parse = JSON.parse
  try {
    const result = await tailPlan.run(async request => {
      await request.beforeRequest()
      JSON.parse = ((value: string, reviver?: Parameters<typeof JSON.parse>[1]) => {
        const parsed = parse(value, reviver)
        if (value === rawPositive) clock += L.totalMs
        return parsed
      }) as typeof JSON.parse
      return rawPositive
    })
    rejected(result, 'timeout')
  } finally { JSON.parse = parse }
} finally { Object.defineProperty(performance, 'now', { configurable: true, value: realNow }) }

globalThis.fetch = originalFetch
console.log(JSON.stringify({ suite: 'memory-support-controlled', fixtureSha256: frozenHash, semanticCases: semanticCases.length,
  recovered, supportedRecovery: '12/12', appropriateInsufficiency: '6/6', appropriateUncertainty: '7/7', requiredPremises, validCitations,
  operationalBlocks: `${operational}/8`, allRefusalFailures: refusalFailures, allSupportedFailures: supportFailures,
  attemptedControlledCalls: semanticCalls, realModelCalls: 0, maxInputChars, maxInputBytes, maxResponseChars, maxResponseBytes,
  failureCategories, elapsedMs: Math.round(performance.now() - suiteStarted), note: 'Controlled replies validate protocol, sources and lifecycle, not real-model quality.' }))
