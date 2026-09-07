/**
 * Actual DOCX package parsing, TXT decoding, stale-read cancellation and local
 * chapter coverage. The DOM shim covers Mammoth's generated HTML only; actual
 * browser upload and rendering remain part of the UI smoke check.
 * Run: node --import tsx scripts/smoke-book-import.ts
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { DOMParser } from '@xmldom/xmldom'
import { createBookImporter, readBookFile, splitBookLocally, type BookFile } from '../src/utils/bookImport'

Object.defineProperty(globalThis, 'DOMParser', { value: DOMParser, configurable: true })

const bytesFile = (name: string, data: Uint8Array): BookFile => ({
  name,
  arrayBuffer: async () => Uint8Array.from(data).buffer,
})
const textFile = (name: string, content: string) => bytesFile(name, new TextEncoder().encode(content))
const fixture = async (name: string) => bytesFile(name, await readFile(new URL(`./fixtures/${name}`, import.meta.url)))

const utf8 = await readBookFile(textFile('novel.TXT', '\uFEFF第一章\r\n正文\r结尾'))
assert.equal(utf8.content, '第一章\n正文\n结尾')
assert.equal(utf8.encoding, 'utf-8')
const gbk = await readBookFile(bytesFile('novel.txt', Uint8Array.from([0xd6, 0xd0, 0xb9, 0xfa, 0xba, 0xdc, 0xba, 0xc3])), 'gbk')
assert.equal(gbk.content, '中国很好')
assert.equal(gbk.encoding, 'gbk')
console.log('✓ TXT: UTF-8 BOM, line endings and GBK decode correctly')

const docx = await readBookFile(await fixture('book-import.docx'), 'gbk')
assert.equal(docx.format, 'docx')
assert.equal(docx.encoding, null, 'DOCX must not inherit the TXT encoding')
assert.equal(docx.content, '第一章 初见\n\n正文第一段。\n显式换行。\t制表符后。\n\n第二段 & <script>只是文字</script>\n\n角色\t描述\n阿青\t旅人\n\n第二章 重逢\n\n最后一段。')
console.log('✓ DOCX: actual OOXML package preserves paragraphs, breaks, tabs, table cells and escaped text')

await assert.rejects(readBookFile(await fixture('book-import-invalid.docx')), /DOCX 解析失败/)
await assert.rejects(readBookFile(bytesFile('truncated.docx', (await readFile(new URL('./fixtures/book-import.docx', import.meta.url))).subarray(0, 100))), /DOCX 解析失败/)
await assert.rejects(readBookFile(textFile('fake.docx', 'Not a ZIP archive')), /DOCX 解析失败/)
await assert.rejects(readBookFile(await fixture('book-import-empty.docx')), /没有可导入的正文/)
await assert.rejects(readBookFile(textFile('empty.txt', ' \n\t ')), /没有可导入的正文/)
await assert.rejects(readBookFile(textFile('novel.pdf', 'unsupported')), /仅支持/)
await assert.rejects(readBookFile(bytesFile('gbk-as-utf8.txt', Uint8Array.from([0xd6, 0xd0]))), /其他编码/)
await assert.rejects(readBookFile(bytesFile('invalid-gbk.txt', Uint8Array.from([0x81])), 'gbk'), /其他编码/)
await assert.rejects(readBookFile(textFile('binary.txt', 'a\0b')), /其他编码/)
await assert.rejects(readBookFile({ name: 'unreadable.txt', arrayBuffer: async () => { throw new Error('I/O error') } }), /文件读取失败/)
console.log('✓ Invalid format, corruption, empty documents, encoding and read errors reject explicitly')

const importer = createBookImporter()
let resolveOld!: (buffer: ArrayBuffer) => void
const oldRead = importer.read({ name: 'slow.txt', arrayBuffer: () => new Promise(resolve => { resolveOld = resolve }) }, 'utf-8')
const latest = await importer.read(textFile('latest.txt', '最新内容'), 'utf-8')
resolveOld(new TextEncoder().encode('旧内容').buffer)
assert.equal(await oldRead, null, 'A late older read cannot replace the latest successful import')
assert.equal(latest?.content, '最新内容')

let resolveRemoved!: (buffer: ArrayBuffer) => void
const removedRead = importer.read({ name: 'removed.txt', arrayBuffer: () => new Promise(resolve => { resolveRemoved = resolve }) }, 'utf-8')
importer.cancel()
resolveRemoved(new TextEncoder().encode('已移除').buffer)
assert.equal(await removedRead, null, 'Removing a file invalidates pending imports')

let rejectOld!: (error: Error) => void
const oldFailure = importer.read({ name: 'old-error.txt', arrayBuffer: () => new Promise((_resolve, reject) => { rejectOld = reject }) }, 'utf-8')
await importer.read(textFile('latest.txt', '有效内容'), 'utf-8')
rejectOld(new Error('late failure'))
assert.equal(await oldFailure, null, 'Stale errors must not affect the latest import')
console.log('✓ Overlapping uploads, removal and stale errors cannot commit obsolete results')

const longText = '没有标题的正文。\n'.repeat(12000)
const chapters = splitBookLocally(longText)
assert.ok(chapters.length > 20, 'Local splitting must not truncate books at twenty chapters')
assert.equal(chapters.map(chapter => longText.slice(chapter.startPos, chapter.endPos)).join(''), longText)
assert.equal(chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0), longText.length)
assert.ok(chapters.every(chapter => chapter.summary === ''), 'Local splitting must not invent AI summaries')
assert.equal(chapters.at(-1)?.endPos, longText.length)
assert.deepEqual(splitBookLocally(''), [])
assert.equal(splitBookLocally('短篇')[0]?.endPos, 2)
const withEmoji = splitBookLocally('字'.repeat(2999) + '😀' + '余'.repeat(4000))
assert.equal(withEmoji[0]?.endPos, 3001, 'Length-based boundaries must not split surrogate pairs')
console.log('✓ Local splitting covers the entire text and respects character boundaries')

console.log('\n=== ALL BOOK IMPORT TESTS PASSED ===')
