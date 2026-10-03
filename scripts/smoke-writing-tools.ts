/** Selected-project evidence tools: isolation, bounded reads and SDK validation. */
import assert from 'node:assert/strict'
import { asSchema } from 'ai'
import { createWritingTools, getWritingProjectSummary, WRITING_TOOL_DESCRIPTORS } from '../src/services/writingTools'
import type { WriterNovel } from '../src/types/writer'

const novel: WriterNovel = {
  id: 41, title: '听雨剑', genre: '仙侠', description: '凌云寻找失落的剑。',
  chapterList: [
    { id: 101, title: '初入山门', description: '凌云见到师父', content: '<p>凌云抵达青云宗。</p><p>他的剑名为听雨。</p>', updatedAt: '2026-10-02T15:00:00Z' },
    { id: 102, title: '伏笔', content: `<p>${'铺垫'.repeat(2000)}听雨剑曾被师父藏于石室。${'结尾'.repeat(3000)}</p>` },
  ],
  characters: [{ id: 201, name: '凌云', personality: '谨慎', background: '青云宗弟子', avatar: 'private-avatar-must-not-leak' }],
  worldSettings: [{ id: 301, title: '青云宗', description: '宗门设有内门与外门', details: '石室位于后山' }],
  events: [{ id: 401, title: '埋下剑的伏笔', description: '师父藏剑', chapter: 2, characterIds: [201], time: '十年前' }],
  corpusData: [{ id: 501, title: '听雨剑', content: '剑身留有三道裂痕。', tags: ['伏笔'] }],
  privateField: 'private-extension-must-not-leak',
}

const tools = await createWritingTools(novel)
const execution = { toolCallId: 'writing-test', messages: [], context: {} }
async function call(name: string, input: unknown, abortSignal?: AbortSignal): Promise<any> {
  const execute = tools[name]?.execute
  assert.ok(execute, `Tool ${name} must be executable`)
  return execute(input, { ...execution, abortSignal })
}

assert.equal(WRITING_TOOL_DESCRIPTORS.length, 6)
assert.ok(WRITING_TOOL_DESCRIPTORS.every(descriptor => descriptor.readOnly))
assert.deepEqual(getWritingProjectSummary(novel), { id: 41, title: '听雨剑', chapterCount: 2, materialCount: 4 })
assert.deepEqual(Object.keys(await createWritingTools(novel, { enabledToolIds: [] })), [])
assert.deepEqual(Object.keys(await createWritingTools(novel, { enabledToolIds: ['writing_read_chapter'] })), ['writing_read_chapter'])
await assert.rejects(createWritingTools({ id: -1 }), /有效的小说/)

// Registries capture the request snapshot and do not leak unrelated extension fields.
novel.title = 'later project title'
novel.chapterList![0].content = 'later body'
novel.characters![0].background = 'later background'
const project = await call('writing_get_project', {})
assert.equal(project.title, '听雨剑')
assert.equal(project.chapterCount, 2)
project.tags.push('mutated result')
assert.deepEqual((await call('writing_get_project', {})).tags, [])
assert.ok(!JSON.stringify(project).includes('private-extension'))

const chapters = await call('writing_list_chapters', { limit: 1 })
assert.equal(chapters.total, 2)
assert.equal(chapters.items[0].id, 101)
assert.equal(chapters.nextOffset, 1)
assert.equal(chapters.items[0].reference, 'novel:41/chapter:101')
const secondPage = await call('writing_list_chapters', { offset: chapters.nextOffset, limit: 1 })
assert.equal(secondPage.items[0].id, 102)
assert.equal(secondPage.nextOffset, null)

const read = await call('writing_read_chapter', { id: 101 })
assert.equal(read.text, '凌云抵达青云宗。\n\n他的剑名为听雨。')
assert.equal(read.source.updatedAt, '2026-10-02T15:00:00Z')
assert.equal((await call('writing_read_chapter', { id: 101, section: 'description' })).text, '凌云见到师父')
assert.equal((await call('writing_read_chapter', { id: 101, format: 'raw' })).text, '<p>凌云抵达青云宗。</p><p>他的剑名为听雨。</p>')
const body = await call('writing_read_chapter', { id: 102, maxChars: 8000 })
assert.equal(body.text.length, 8000)
assert.equal(body.nextOffset, 8000)
assert.ok(body.truncated)
const tail = await call('writing_read_chapter', { id: 102, offset: body.nextOffset, maxChars: 8000 })
assert.equal(body.text + tail.text, '铺垫'.repeat(2000) + '听雨剑曾被师父藏于石室。' + '结尾'.repeat(3000))
assert.equal(tail.nextOffset, null)
assert.equal((await call('writing_read_chapter', { id: 999 })).found, false)

const materialPage = await call('writing_list_materials', { kind: 'characters' })
assert.equal(materialPage.items.length, 1)
assert.equal(materialPage.items[0].id, 201)
const character = await call('writing_read_material', { kind: 'characters', id: 201 })
assert.ok(character.text.includes('青云宗弟子'))
assert.ok(!character.text.includes('later background'))
assert.ok(!JSON.stringify(character).includes('private-avatar'))
const event = await call('writing_read_material', { kind: 'events', id: 401 })
assert.ok(event.text.includes('关联章号：2'))
assert.ok(event.text.includes('参与人物 ID 或姓名：201'))
assert.equal((await call('writing_read_material', { kind: 'events', id: 201 })).found, false)

const search = await call('writing_search', { query: '听雨剑', kind: 'chapter', snippetChars: 100 })
assert.equal(search.method, 'lexical')
assert.ok(search.results.some((result: any) => result.source.id === 102 && result.text.includes('听雨剑曾被师父藏于石室')))
assert.ok(search.results.every((result: any) => result.text.length <= 100 && result.source.projectId === 41 && result.source.kind === 'chapter'))
const materialSearch = await call('writing_search', { query: '裂痕' })
assert.equal(materialSearch.results[0].source.kind, 'corpus')
assert.equal(materialSearch.results[0].source.id, 501)
const outlineSearch = await call('writing_search', { query: '见到师父', kind: 'chapter' })
assert.equal(outlineSearch.results[0].source.id, 101)
assert.equal(outlineSearch.results[0].section, 'description')
assert.deepEqual((await call('writing_search', { query: '不存在的原文证据qwerty' })).results, [])

// Schema validation and direct execution both reject invented cross-project inputs.
await assert.rejects(call('writing_read_chapter', { id: 101, projectId: 999 }), /不支持的字段/)
await assert.rejects(call('writing_read_chapter', { id: 101, maxChars: 8001 }), /8000/)
await assert.rejects(call('writing_list_chapters', { offset: -1 }), /offset/)
await assert.rejects(call('writing_search', { query: '  ' }), /query/)
await assert.rejects(call('writing_read_material', { kind: 'credentials', id: 1 }), /kind/)
const schema = asSchema(tools.writing_read_chapter.inputSchema)
assert.equal((await schema.validate!({ id: 101, maxChars: 8001 })).success, false)
assert.equal((await schema.validate!({ id: 101 })).success, true)
const controller = new AbortController()
controller.abort(new DOMException('cancelled', 'AbortError'))
await assert.rejects(call('writing_search', { query: '听雨' }, controller.signal), { name: 'AbortError' })

// A cancellation arriving during a scan must stop it, not only cancel later model calls.
const scanTools = await createWritingTools({
  id: 42,
  chapterList: Array.from({ length: 100 }, (_, index) => ({ id: index + 1, title: `章${index}`, content: '目标证据'.repeat(50) })),
}, { enabledToolIds: ['writing_search'] })
const scanController = new AbortController()
const pendingScan = scanTools.writing_search.execute!({ query: '目标' }, { ...execution, abortSignal: scanController.signal })
const cancelTimer = setTimeout(() => scanController.abort(new DOMException('cancelled', 'AbortError')), 0)
try { await assert.rejects(Promise.resolve(pendingScan), { name: 'AbortError' }) }
finally { clearTimeout(cancelTimer) }

// Case-insensitive matching keeps offsets in the original text, including Unicode case expansion.
const unicodeTools = await createWritingTools({
  id: 43, chapterList: [{ id: 1, title: 'Unicode', content: `${'İ'.repeat(1000)}TARGET evidence` }],
}, { enabledToolIds: ['writing_search'] })
const unicode = await unicodeTools.writing_search.execute!({ query: 'target', snippetChars: 50 }, execution) as any
assert.ok(unicode.results[0].text.includes('TARGET evidence'))
assert.equal(unicode.results[0].offset, 1000 - Math.floor(50 / 3))

console.log('✓ Writing tools passed: selected-project isolation, source references, pagination, bounded evidence, allowlists, validation and cancellation')
