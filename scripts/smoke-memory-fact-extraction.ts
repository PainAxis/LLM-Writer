import assert from 'node:assert/strict'
import { MemoryIndex } from '../src/services/memory/engine'
import { buildFactExtractionPrompt, extractFactRelations, parseFactExtractionResponse } from '../src/services/memory/factExtraction'
import type { FactExtractionInput } from '../src/services/memory/factExtraction'
import type { MemoryProjectInput } from '../src/types/memory'

const quote = '沈砚把银钥匙藏在渡口，阿宁看见了银钥匙。'
const project: MemoryProjectInput = {
  id: 'extract-A', title: 'Do not transmit the book title', clues: [],
  chapters: [
    { id: 'early', title: 'Do not transmit the chapter title', text: `${quote}\n未选择的原文不应外发。` },
    { id: 'future', title: '不外发的揭晓章', text: '玄衣客的真名是顾行，钥匙的秘密至此揭晓。' },
  ],
}
const index = new MemoryIndex()
const stats = await index.sync(project)
const input: FactExtractionInput = {
  project, stats, throughChapterId: 'early',
  evidence: [{ chapterId: 'early', sourceRevision: stats.chapters[0]!.revision, start: 0, end: quote.length, quote }],
}
const proposal = {
  source: { type: 'person', label: '沈砚' }, target: { type: 'object', label: '银钥匙' },
  predicate: '可能保管', origin: 'inferred', evidence: [1],
}
const response = (value: unknown) => JSON.stringify({ relations: [value] })
const payload = buildFactExtractionPrompt(input)
const transmitted = JSON.parse(payload.prompt.split('SOURCE_EXCERPTS_JSON\n')[1]!)
assert.deepEqual(transmitted, { sources: [{ reference: 1, quote }] })
for (const forbidden of ['玄衣客', '顾行', '未选择的原文', project.title, project.chapters[0]!.title, 'sourceRevision']) {
  assert.ok(!payload.prompt.includes(forbidden), `Unexpected outbound information: ${forbidden}`)
}
let calls = 0
const result = await extractFactRelations(input, async request => {
  calls++
  assert.equal(request.prompt, payload.prompt)
  assert.ok(!request.signal.aborted)
  return response(proposal)
})
assert.equal(calls, 1)
assert.equal(result[0]!.createdBy, 'model')
assert.equal(result[0]!.authorConfirmed, false)
assert.equal(result[0]!.origin, 'inferred')
assert.deepEqual(result[0]!.evidence, input.evidence)
assert.equal(parseFactExtractionResponse(response({ ...proposal, origin: 'explicit' }), input)[0]!.authorConfirmed, false)
assert.deepEqual(parseFactExtractionResponse('{"relations":[]}', input), [])
console.log('✓ Selected disclosed excerpts alone reach the transport; exact anchors and unconfirmed provenance belong to the application')

for (const invalid of [
  { ...proposal, authorConfirmed: true },
  { ...proposal, createdBy: 'author' },
  { ...proposal, evidence: [0] }, { ...proposal, evidence: [2] }, { ...proposal, evidence: [1, 1] },
  { ...proposal, evidence: ['1'] }, { ...proposal, evidence: [] },
  { ...proposal, origin: 'confirmed' },
  { ...proposal, source: { type: 'person', label: '顾行' } },
  { ...proposal, source: { type: 'unknown', label: '沈砚' } },
  { ...proposal, source: { type: 'person', label: '沈砚', alias: '顾行' } },
  { ...proposal, predicate: 'x'.repeat(201) },
]) assert.throws(() => parseFactExtractionResponse(response(invalid), input))
for (const raw of ['not JSON', `\x60\x60\x60json\n${response(proposal)}\n\x60\x60\x60`, 'x'.repeat(64_001), JSON.stringify({ relations: Array(17).fill(proposal) })]) {
  assert.throws(() => parseFactExtractionResponse(raw, input))
}
console.log('✓ Untrusted output cannot choose revisions, forge author confirmation, invent labels or exceed response bounds')

let blockedCalls = 0
for (const invalidInput of [
  { ...input, throughChapterId: 'missing' },
  { ...input, evidence: [{ chapterId: 'future', sourceRevision: stats.chapters[1]!.revision, start: 0, end: project.chapters[1]!.text.length, quote: project.chapters[1]!.text }] },
  { ...input, evidence: [{ ...input.evidence[0]!, sourceRevision: 'a'.repeat(64) }] },
  { ...input, evidence: [{ ...input.evidence[0]!, start: 1 }] },
  { ...input, evidence: [] },
]) {
  await assert.rejects(extractFactRelations(invalidInput, async () => { blockedCalls++; return response(proposal) }))
}
assert.equal(blockedCalls, 0)
const edited = structuredClone(project)
edited.chapters[0]!.title += '修订'
const editedStats = await index.sync(edited)
assert.throws(() => buildFactExtractionPrompt({ ...input, project: edited, stats: editedStats }))
console.log('✓ Future, stale, missing and malformed source references fail before any external request')

const controller = new AbortController()
await assert.rejects(extractFactRelations({ ...input, signal: controller.signal }, async () => {
  controller.abort()
  return response(proposal) // A provider may ignore abort and return late.
}), /已取消/)
await assert.rejects(extractFactRelations(input, async () => { throw new Error('provider-secret-key and raw manuscript') }), error => {
  assert.ok(error instanceof Error)
  assert.ok(!error.message.includes('provider-secret-key'))
  assert.ok(!error.message.includes('raw manuscript'))
  return true
})
console.log('✓ Late cancelled responses are discarded; provider diagnostics do not leak into displayed errors')
console.log('Fact extraction source contract passed (deterministic transport; no paid API calls)')
