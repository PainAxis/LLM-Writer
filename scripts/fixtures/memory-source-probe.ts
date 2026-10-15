/** Test-only browser entry: import real services; never mount or instrument the app. */
import { initNovelPersistence, replaceNovelPersistence } from '@/services/novelPersistence'
import { StorageKeys, storageReadCommitted } from '@/utils/storage'
import { stripWriterHtml } from '@/utils/writerContent'
import { idbSet } from '@/services/blobStore'
import { readMemoryNovel } from '@/services/memory/labData'
import { chapterRevision } from '@/services/memory/revision'
import { MemoryClient } from '@/services/memory/client'
import { prepareWriterMemoryContext, type WriterMemoryClient } from '@/services/memory/writerContext'
import type { MemoryProjectInput } from '@/types/memory'
import type { FactGraphDocument } from '@/types/factGraph'

interface Novel {
  id: number; title: string
  chapterList: Array<{ id: number; title: string; content: string; contentRef?: string }>
}
interface Config {
  projectId: string; targetChapterId: string; query: string; exactIdentifier: string
  expectedChars: number; expectedChapters: number; expectedDisclosed: number
}
interface Counters {
  transactions: number; readonlyTransactions: number; readwriteTransactions: number
  gets: number; bodyGets: number; graphGets: number; returnedChars: number; bodyReturnedChars: number
}
const counters: Counters = { transactions: 0, readonlyTransactions: 0, readwriteTransactions: 0, gets: 0, bodyGets: 0, graphGets: 0, returnedChars: 0, bodyReturnedChars: 0 }
const originalTransaction = IDBDatabase.prototype.transaction
IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
  counters.transactions++
  if (args[1] === 'readwrite') counters.readwriteTransactions++
  else counters.readonlyTransactions++
  return originalTransaction.apply(this, args)
}
const originalGet = IDBObjectStore.prototype.get
IDBObjectStore.prototype.get = function (key: IDBValidKey | IDBKeyRange) {
  counters.gets++
  const body = typeof key === 'string' && key.startsWith('novel:') && key.includes(':content:')
  if (body) counters.bodyGets++
  if (typeof key === 'string' && key.startsWith('memory-fact-graph:')) counters.graphGets++
  const request = originalGet.call(this, key)
  request.addEventListener('success', () => {
    if (typeof request.result === 'string') {
      counters.returnedChars += request.result.length
      if (body) counters.bodyReturnedChars += request.result.length
    }
  })
  return request
}
const check = (condition: unknown, message: string): void => { if (!condition) throw new Error(message) }
const rounded = (value: number) => Number(value.toFixed(3))
const heap = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
async function measured<T>(operation: string, work: () => T | Promise<T>) {
  const before = { ...counters }
  const heapBefore = heap()
  const started = performance.now()
  const value = await work()
  const durationMs = rounded(performance.now() - started)
  const io = Object.fromEntries(Object.entries(counters).map(([key, value]) => [key, value - before[key as keyof Counters]]))
  return { value, measurement: { operation, durationMs, io, heapBeforeBytes: heapBefore, heapAfterBytes: heap() } }
}
function disclosed(project: MemoryProjectInput, config: Config): MemoryProjectInput {
  const cutoff = project.chapters.findIndex(chapter => chapter.id === config.targetChapterId)
  check(cutoff + 1 === config.expectedDisclosed, 'Fixture narrative cutoff changed')
  const chapters = project.chapters.slice(0, cutoff + 1).map(({ id, title, text }) => ({ id, title, text }))
  const ids = new Set(chapters.map(chapter => chapter.id))
  return { id: project.id, title: project.title, chapters, clues: project.clues.filter(clue => ids.has(clue.chapterId)) }
}
function validate(project: MemoryProjectInput, config: Config) {
  check(project.id === config.projectId && project.chapters.length === config.expectedChapters, 'Target project differs')
  check(project.chapters.reduce((sum, chapter) => sum + chapter.text.length, 0) === config.expectedChars, 'Committed visible source characters differ')
  check(project.chapters.some(chapter => chapter.text.includes(config.exactIdentifier)), 'Exact identifier source lost')
}
async function seed(novels: Novel[], graph: FactGraphDocument) {
  await initNovelPersistence()
  await replaceNovelPersistence(novels)
  await idbSet(`memory-fact-graph:v1:${graph.projectId}`, JSON.stringify(graph))
  const raw = localStorage.getItem(StorageKeys.novels)!
  const metadata = JSON.parse(raw) as Novel[]
  return { metadataChars: raw.length, novels: metadata.length,
    splitChapters: metadata.reduce((sum, novel) => sum + novel.chapterList.filter(chapter => !!chapter.contentRef).length, 0) }
}

async function readPhases(config: Config) {
  const results = []
  const initialization = await measured('page.coldPersistenceInit', () => initNovelPersistence())
  results.push(initialization.measurement)
  const committed = await measured('storageReadCommitted.allNovels', async () => await storageReadCommitted(StorageKeys.novels) as Novel[])
  results.push(committed.measurement)
  const novel = committed.value.find(item => `novel:${item.id}` === config.projectId)!
  check(!!novel, 'Committed target novel missing')
  const converted = await measured('source.targetHtmlConversion', () => novel.chapterList.map(chapter => stripWriterHtml(chapter.content)))
  results.push({ ...converted.measurement, chapters: novel.chapterList.length, chars: converted.value.reduce((sum, text) => sum + text.length, 0) })
  check(converted.value.reduce((sum, text) => sum + text.length, 0) === config.expectedChars, 'HTML conversion changed source')
  const source = await measured('readMemoryNovel.target', () => readMemoryNovel(config.projectId))
  results.push(source.measurement)
  validate(source.value, config)
  check(source.value.chapters.every((chapter, index) => chapter.text === converted.value[index]), 'Source adapter and direct HTML conversion differ')
  const full = await measured('source.fullJsonSignature', () => JSON.stringify(source.value))
  results.push({ ...full.measurement, chars: full.value.length })
  const scoped = await measured('source.disclosedJsonSignature', () => JSON.stringify(disclosed(source.value, config)))
  results.push({ ...scoped.measurement, chars: scoped.value.length })
  const compare = await measured('source.disclosedJsonComparison', () => JSON.stringify(disclosed(source.value, config)) === scoped.value)
  check(compare.value, 'Unchanged source comparison differs')
  results.push(compare.measurement)
  const clone = await measured('source.jsonSnapshotClone', () => JSON.parse(full.value) as MemoryProjectInput)
  results.push(clone.measurement)
  check(clone.value.chapters.length === config.expectedChapters, 'Snapshot clone lost chapters')
  check(JSON.stringify(clone.value) === full.value, 'Snapshot clone changed source values')
  const hashes = await measured('source.allChapterRevisions', async () => {
    let count = 0
    for (const chapter of source.value.chapters) { check((await chapterRevision(chapter)).length === 64, 'Invalid chapter hash'); count++ }
    return count
  })
  results.push({ ...hashes.measurement, chapters: hashes.value })
  // Repeated reads share one page, but still read committed storage. Do not call
  // an in-memory cache a persisted-index restore or an independent cold sample.
  const repeated = await measured('readMemoryNovel.samePageRepeat', () => readMemoryNovel(config.projectId))
  validate(repeated.value, config)
  check(JSON.stringify(repeated.value) === full.value, 'Unchanged committed reads differ')
  results.push(repeated.measurement)
  return { measurements: results, validation: { sourceSha256: await sha256(full.value), disclosedSha256: await sha256(scoped.value),
    sourceChars: config.expectedChars, chapterRevisionChecks: hashes.value, convertedChapterChecks: converted.value.length } }
}

async function writerPhases(config: Config, mode: 'cold' | 'newPageRestore') {
  const client = new MemoryClient()
  const results = []
  const calls: Array<{ operation: string; durationMs: number; work?: unknown }> = []
  let sourceReads = 0
  const readProject = async (id: string) => {
    const result = await measured('writer.committedSourceRead', () => readMemoryNovel(id))
    sourceReads++
    calls.push({ ...result.measurement })
    return result.value
  }
  const instrumented: WriterMemoryClient = {
    sync: async project => {
      const result = await measured('writer.workerSync', () => client.sync(project))
      calls.push({ ...result.measurement, work: result.value.sync })
      return result.value
    },
    search: async (...args) => {
      const result = await measured('writer.workerSearch', () => client.search(...args))
      calls.push(result.measurement)
      return result.value
    },
    invalidateSource: () => client.invalidateSource(),
  }
  try {
    const prepared = await measured(`writer.${mode}.prepare`, () => prepareWriterMemoryContext({
      projectId: config.projectId, query: config.query, throughChapterId: config.targetChapterId,
      targetChapterId: config.targetChapterId, maxChars: 6000, limit: 8, includeGraph: true,
    }, { client: instrumented, readProject }))
    results.push({ ...prepared.measurement, sourceReads, hits: prepared.value.hits.length, relations: prepared.value.relations.length, assessment: prepared.value.assessment,
      evidence: prepared.value.hits.map(({ id, chapterId, ordinal, revision, start, end, quote }) => ({ id, chapterId, ordinal, revision, start, end, quote })),
      promptSha256: await sha256(prepared.value.prompt) })
    check(prepared.value.assessment.answerability === 'unverified', 'A retrieval candidate became a verified answer')
    check(!prepared.value.prompt.includes('FUTURE-SECRET-59480'), 'Future source leaked into preview')
    const exact = prepared.value.hits.find(hit => hit.match?.identifiers.quote.includes(config.exactIdentifier.toLowerCase()))
    check(!!exact, 'PR35 exact identifier recall regressed')
    const beforeSelect = sourceReads
    const selection = await measured('writer.explicitSelectOne', () => prepared.value.selectEvidence({ hitIds: [exact!.id], relationIds: [] }))
    results.push({ ...selection.measurement, sourceReads: sourceReads - beforeSelect, promptChars: selection.value.prompt.length,
      chosenId: exact!.id, promptSha256: await sha256(selection.value.prompt) })
    check(selection.value.hits.length === 1 && selection.value.relations.length === 0, 'Explicit selection boundary changed')
    for (const name of ['beforeTransport', 'beforeAcceptOutput']) {
      const beforeGuard = sourceReads
      const guard = await measured(`writer.assertFresh.${name}`, () => selection.value.assertFresh())
      results.push({ ...guard.measurement, sourceReads: sourceReads - beforeGuard })
    }
    const empty = await prepared.value.selectEvidence({ hitIds: [], relationIds: [] })
    check(empty.prompt === '', 'Empty author selection entered generation context')
    return { measurements: results, nestedCalls: calls, totalSourceReads: sourceReads,
      caveat: 'Service prepare/select/pre-transport/pre-accept guards only. No model request, generated prose, or mounted Writer UI is timed.' }
  } finally { client.dispose() }
}

Object.assign(globalThis, { __memorySourceBenchmark: { seed, readPhases, writerPhases } })
