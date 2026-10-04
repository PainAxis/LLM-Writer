/** Opt-in, bounded live business checks. Uses synthetic prose only; never reads local novels. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { MemoryIndex } from '../src/services/memory/engine'
import { MEMORY_PROVIDER_DEFAULTS } from '../src/services/memory/providers'
import type { MemoryProjectInput, MemoryRemoteOptions, MemorySearchResult } from '../src/types/memory'

const apiKey = process.env.JINA_API_KEY?.trim() ?? ''
delete process.env.JINA_API_KEY
if (!apiKey) throw new Error('Set JINA_API_KEY to run the optional live test; it is not part of CI.')
const options: MemoryRemoteOptions = {
  embedding: { ...MEMORY_PROVIDER_DEFAULTS.embedding, apiKey },
  rerank: { ...MEMORY_PROVIDER_DEFAULTS.rerank, apiKey },
}
const project: MemoryProjectInput = {
  id: 'live-memory-synthetic', title: 'Synthetic retrieval acceptance', clues: [],
  chapters: [
    { id: 'c1', title: '托付', text: '天亮前，顾行把银钥匙交给沈砚，请他代为保管。沈砚把银钥匙放进贴身的布袋。' },
    { id: 'c2', title: '约定', text: '沈砚把一枚缺角的铜铃系在窗边，嘱咐阿宁听见三声铃响就去西渡口接人。这是他们约定的联络暗号。' },
    { id: 'c80', title: '揭晓', text: '玄衣客的真名是顾行。这个身份直到此刻才向众人揭晓。未来专属密语为紫曜灯塔。' },
  ],
}
const fetchOriginal = globalThis.fetch
let cutoff = 'c2'
let requests = 0
let sentChars = 0
let documentInputs: string[] = []
const checks: Array<{ name: string; passed: boolean; elapsedMs?: number; resultCount?: number; firstChapter?: string; diagnostics?: MemorySearchResult['diagnostics'] }> = []
const startedAt = new Date().toISOString()

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  assert.ok(['https://api.jina.ai/v1/embeddings', 'https://api.jina.ai/v1/rerank'].includes(url), 'live calls are restricted to the chosen provider')
  const body = JSON.parse(String(init?.body)) as { input?: string[]; documents?: string[]; query?: string; task?: string }
  const allText = [...(body.input ?? []), ...(body.documents ?? []), body.query ?? ''].join('\n')
  sentChars += allText.length
  assert.ok(++requests <= 20 && sentChars <= 30_000, 'bounded live request/text budget')
  if (cutoff !== 'c80') {
    assert.ok(!allText.includes('紫曜灯塔') && !allText.includes('玄衣客的真名是顾行'), 'future source must not enter the provider request')
  }
  if (body.task === 'retrieval.passage') documentInputs.push(...body.input ?? [])
  return fetchOriginal(input, init)
}

const index = new MemoryIndex()
async function run(name: string, query: string, validate: (result: MemorySearchResult) => void) {
  const entry: typeof checks[number] = { name, passed: false }
  checks.push(entry)
  const started = performance.now()
  await index.sync(project)
  const result = await index.search({ text: query, throughChapterId: cutoff, limit: 4 }, options)
  entry.elapsedMs = Math.round(performance.now() - started)
  entry.resultCount = result.hits.length
  entry.firstChapter = result.hits[0]?.chapterId
  entry.diagnostics = result.diagnostics
  assert.equal(result.diagnostics.semantic, 'used')
  assert.equal(result.diagnostics.rerank, 'used')
  assert.deepEqual(result.diagnostics.warnings, [])
  for (const hit of result.hits) {
    const source = project.chapters.find(chapter => chapter.id === hit.chapterId)!
    assert.equal(source.text.slice(hit.start, hit.end), hit.quote)
    if (cutoff !== 'c80') assert.notEqual(hit.chapterId, 'c80')
  }
  validate(result)
  entry.passed = true
  console.log(`PASS ${name} (${entry.elapsedMs} ms)`)
}

try {
  await run('Recover a contact arrangement with different wording', '如何通知伙伴到约好的地点接人？', result => {
    assert.equal(result.hits[0]?.chapterId, 'c2')
    assert.ok(result.hits[0]?.quote.includes('铜铃'))
    assert.equal(result.diagnostics.embeddedPassages, 2)
  })
  documentInputs = []
  await run('Reuse source vectors without disclosing later chapters', '玄衣客的真名是什么？', result => {
    assert.equal(result.diagnostics.cachedPassages, 2)
    assert.equal(documentInputs.length, 0)
  })
  project.chapters[0]!.text = project.chapters[0]!.text.replaceAll('银钥匙', '铜钥匙')
  await run('Replace an old fact and its source vector after an edit', '最初交给沈砚保管的物品是什么？', result => {
    assert.equal(result.diagnostics.embeddedPassages, 1)
    assert.equal(result.diagnostics.cachedPassages, 1)
    assert.equal(documentInputs.length, 1)
    assert.ok(documentInputs[0]!.includes('铜钥匙') && !documentInputs[0]!.includes('银钥匙'))
    assert.ok(result.hits.some(hit => hit.quote.includes('铜钥匙')))
    assert.ok(result.hits.every(hit => !hit.quote.includes('银钥匙')))
  })
  cutoff = 'c80'
  await run('Disclose the identity only after its source chapter', '玄衣客的真名是什么？', result => {
    assert.equal(result.hits[0]?.chapterId, 'c80')
    assert.equal(result.diagnostics.embeddedPassages, 1)
  })
} catch {
  // Deliberately omit raw transport/assertion details that could contain a credential or response body.
  console.error('Live memory acceptance failed; inspect the safe stage diagnostics in the report.')
  process.exitCode = 1
} finally {
  globalThis.fetch = fetchOriginal
  const report = { startedAt, finishedAt: new Date().toISOString(), syntheticOnly: true,
    embeddingModel: options.embedding!.model, dimensions: options.embedding!.dimensions,
    rerankModel: options.rerank!.model, requests, sentChars, passed: checks.length === 4 && checks.every(check => check.passed), checks }
  await mkdir('artifacts/memory-live', { recursive: true })
  await writeFile('artifacts/memory-live/report.json', JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ passed: report.passed, requests, sentChars, report: 'artifacts/memory-live/report.json' }))
}
