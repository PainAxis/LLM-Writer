/** Finite 10.5M UTF-16 geometry, local budget pause and cooperative cancellation. No model/network. */
import assert from 'node:assert/strict'
import { chapterRevision } from '../src/services/memory/revision'
import type { MemoryIndexStats, MemoryProjectInput } from '../src/types/memory'
import type { NovelScanGenerator, NovelScanInput } from '../src/types/memoryNovelScan'
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } })
globalThis.fetch = async () => { throw new Error('Unmocked network forbidden') }
const { prepareNovelCandidateScan, NOVEL_SCAN_DEFAULT_ALLOCATION, NovelScanError } = await import('../src/services/memory/novelScan')
const { planNovelWindows, createNovelConnectionPlanner } = await import('../src/services/memory/novelScanPlan')
const { buildNovelPrompt } = await import('../src/services/memory/novelScanProtocol')
const started = performance.now(), cpu = process.cpuUsage(), baseline = process.memoryUsage()
const project: MemoryProjectInput = { id: 'synthetic-10m-capacity', title: 'Controlled geometry only', clues: [], chapters: [] }
const length = 10_500_000, chapterLength = 21_000
for (let offset = 0; offset < length; offset += chapterLength) project.chapters.push({ id: `chapter-${offset}`, title: `Chapter ${offset}`, text: '前文银钥匙。'.repeat(3500) })
assert.equal(project.chapters.reduce((sum, chapter) => sum + chapter.text.length, 0), length)
const chapters: MemoryIndexStats['chapters'] = []
for (const [index, chapter] of project.chapters.entries()) chapters.push({ id: chapter.id, title: chapter.title, ordinal: index + 1, chars: chapter.text.length, revision: await chapterRevision(chapter) })
const stats: MemoryIndexStats = { projectId: project.id, fingerprint: 'a'.repeat(64), chapters, chunks: 0, clues: 0, staleClues: 0, chars: length, buildMs: 0,
  sync: { mode: 'full', rebuiltChapters: chapters.length, reusedChapters: 0, insertedDocuments: 0, removedDocuments: 0, reusedDocuments: 0 } }
const source: NovelScanInput = { project, stats, throughChapterId: project.chapters.at(-1)!.id, graphRevision: null,
  allocation: { ...NOVEL_SCAN_DEFAULT_ALLOCATION, attempts: 1 }, assertOwner() {}, async assertFresh() {} }
const plan = await planNovelWindows(project, stats, source.throughChapterId)
let primaryChars = 0, maxInputChars = 0, maxInputBytes = 0
const seen = new Set<number>()
for (const window of plan.windows) {
  const prompt = buildNovelPrompt('collect', window.sources.map(id => plan.atoms[id]!), window.primaryReferences)
  maxInputChars = Math.max(maxInputChars, prompt.inputChars); maxInputBytes = Math.max(maxInputBytes, prompt.inputBytes)
  for (const id of window.primary) { assert.ok(!seen.has(id)); seen.add(id); primaryChars += plan.atoms[id]!.quote.length }
}
assert.equal(primaryChars, length); assert.equal(seen.size, plan.atoms.length)
for (let index = 0; index < plan.atoms.length; index += 6) buildNovelPrompt('connect', plan.atoms.slice(index, index + 6))
const session = await prepareNovelCandidateScan(source)
let calls = 0
const empty: NovelScanGenerator = async request => { await request.beforeRequest(); calls++; return JSON.stringify({ version: 1, cues: [], saturated: false }) }
let page = await session.startA(session.preview, empty)
assert.equal(page.state, 'running_a'); page = await session.advance(page)
assert.equal(page.reason, 'budget'); assert.equal(calls, 1); assert.equal(page.progress.ledger.used.attempts, 1)
assert.ok(page.progress.remainingChars > 10_000_000); assert.ok(page.progress.misses.some(miss => miss.reason === 'range_ledger_overflow'))
assert.ok(page.progress.misses.length <= 131)
session.cancel()
const abort = new AbortController(), cancellationStarted = performance.now()
const pending = prepareNovelCandidateScan({ ...source, signal: abort.signal })
setTimeout(() => abort.abort(), 1)
await assert.rejects(pending, error => error instanceof NovelScanError && error.reason === 'cancelled')
const cancelMs = performance.now() - cancellationStarted
assert.ok(cancelMs < 1000, 'Preparation must yield and settle promptly after cancellation')
// A dense shared-key corpus really contains far more finite-route jobs than a normal call budget.
const dense = createNovelConnectionPlanner(Array.from({ length: 120 }, (_, id) => ({ id, kind: 'event', keys: ['shared'], atoms: [id] })))
const boundedIds = new Set<string>()
let planningSteps = 0
for (const job of dense) {
  planningSteps++
  if (job) boundedIds.add(job.id)
  if (boundedIds.size === 65_536) break
  assert.ok(planningSteps < 2_000_000)
}
assert.equal(boundedIds.size, 65_536)
const memory = process.memoryUsage(), usedCpu = process.cpuUsage(cpu)
console.log(JSON.stringify({ suite: 'novel-scan-capacity-controlled', chars: length, chapters: chapters.length, atoms: plan.atoms.length,
  windows: plan.windows.length, primaryChars, maxInputChars, maxInputBytes, dispatched: calls, pause: page.reason,
  indexCueCount: page.progress.indexCueCount, finitePlannerIds: boundedIds.size, planningSteps, cancelMs: Math.ceil(cancelMs),
  elapsedMs: Math.ceil(performance.now() - started), cpuMs: (usedCpu.user + usedCpu.system) / 1000,
  heapUsedBefore: baseline.heapUsed, heapUsedAfter: memory.heapUsed, rssBefore: baseline.rss, rssAfter: memory.rss,
  processMaxRssKiB: process.resourceUsage().maxRSS, note: 'Process memory is observed, not the 16MiB payload limit. No semantic/model accuracy or all-connections completion claim.' }))
