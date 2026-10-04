/** Pinned public-domain anthology. No downloaded book text is committed. */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MemoryChapterInput, MemoryProjectInput } from '../../src/types/memory'

export interface PublicMemoryProbe {
  id: string
  kind: 'recall' | 'future-exclusion' | 'unanswerable'
  query: string
  throughChapterId: string
  expected: { chapterId: string; quote: string }[]
  forbiddenQuotes?: string[]
  notes: string
}
export interface PublicMemoryManifest {
  formatVersion: 1
  label: string
  normalization: string
  sources: {
    title: string; url: string; catalogue: string; file: string; sha256: string
    bytes: number; chapters: number; utf16Chars: number; codePoints: number; hanChars: number
  }[]
  totals: { bytes: number; chapters: number; utf16Chars: number; codePoints: number; hanChars: number }
  probesSha256: string
}

export const PUBLIC_MEMORY_SOURCES = [
  {
    title: '水滸傳（七十回本，含楔子）', prefix: 'shuihu', file: 'watermargin-23863.txt',
    url: 'https://www.gutenberg.org/cache/epub/23863/pg23863.txt',
    catalogue: 'https://www.gutenberg.org/ebooks/23863', gutenbergTitle: '水滸傳',
    sha256: '9d5b723b57f462545d412593870e7f48157829777b9329350a29bc44fd654789', bytes: 1_632_003,
    expectedChapters: 71, lastNumber: 70,
  },
  {
    title: '西遊記（一百回本）', prefix: 'xiyou', file: 'journeywest-23962.txt',
    url: 'https://www.gutenberg.org/cache/epub/23962/pg23962.txt',
    catalogue: 'https://www.gutenberg.org/ebooks/23962', gutenbergTitle: '西遊記',
    sha256: 'af3c9e408c0c58595b666ed9981b6fa1e9343f4bbc78309b1cb0818c32fc1f58', bytes: 2_264_069,
    expectedChapters: 100, lastNumber: 100,
  },
] as const

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const chapterNumber = (title: string) => {
  if (title.startsWith('楔子')) return 0
  const digits = '零一二三四五六七八九'
  const number = /^第([零〇○一二三四五六七八九十百]+)回/u.exec(title)?.[1]
  if (!number) throw new Error(`Unrecognised chapter heading: ${title}`)
  if (!/[十百]/u.test(number)) return Number([...number].map(c => c === '〇' || c === '○' ? 0 : digits.indexOf(c)).join(''))
  let total = 0
  let current = 0
  for (const c of number) {
    if (c === '十' || c === '百') { total += (current || 1) * (c === '十' ? 10 : 100); current = 0 }
    else current = digits.indexOf(c)
  }
  return total + current
}

export async function readPublicMemoryCorpus(directory = 'artifacts/memory-stress/corpus'): Promise<{
  project: MemoryProjectInput; manifest: PublicMemoryManifest; probes: PublicMemoryProbe[]
}> {
  const chapters: MemoryChapterInput[] = []
  const sources: PublicMemoryManifest['sources'] = []
  for (const source of PUBLIC_MEMORY_SOURCES) {
    const bytes = await readFile(join(directory, source.file))
    if (bytes.length !== source.bytes || sha256(bytes) !== source.sha256) throw new Error(`Public corpus hash mismatch: ${source.file}`)
    const raw = bytes.toString('utf8').replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n')
    const startMarker = `*** START OF THE PROJECT GUTENBERG EBOOK ${source.gutenbergTitle} ***`
    const endMarker = `*** END OF THE PROJECT GUTENBERG EBOOK ${source.gutenbergTitle} ***`
    const start = raw.indexOf(startMarker)
    const end = raw.indexOf(endMarker)
    if (start < 0 || end <= start) throw new Error(`Missing Gutenberg boundaries: ${source.file}`)
    const body = raw.slice(start + startMarker.length, end)
    const headings = [...body.matchAll(/^[ \t\u3000]*((?:第[零〇○一二三四五六七八九十百]+回|楔子)(?:[ \t\u3000]+[^\n]*)?)[ \t]*$/gmu)]
    if (headings.length !== source.expectedChapters) throw new Error(`Unexpected chapter count: ${source.file}: ${headings.length}`)
    const bookChapters = headings.map((heading, i): MemoryChapterInput => {
      const title = heading[1]!.trim()
      const number = chapterNumber(title)
      if (number !== i + (source.prefix === 'shuihu' ? 0 : 1)) throw new Error(`Missing or duplicate chapter: ${source.file}: ${title}`)
      const text = body.slice(heading.index! + heading[0].length, headings[i + 1]?.index ?? body.length).trim()
      if (text.length < 1_000) throw new Error(`Suspiciously short chapter: ${source.file}: ${title}`)
      return { id: `${source.prefix}-${String(number).padStart(3, '0')}`, title: `${source.gutenbergTitle} · ${title}`, text }
    })
    const joined = bookChapters.map(chapter => chapter.text).join('')
    chapters.push(...bookChapters)
    sources.push({
      title: source.title, url: source.url, catalogue: source.catalogue, file: source.file,
      sha256: source.sha256, bytes: bytes.length, chapters: bookChapters.length,
      utf16Chars: joined.length, codePoints: [...joined].length, hanChars: [...joined.matchAll(/\p{Script=Han}/gu)].length,
    })
  }
  const probeBytes = await readFile(new URL('./memory-public-probes.json', import.meta.url))
  const probes = JSON.parse(probeBytes.toString('utf8')) as PublicMemoryProbe[]
  const chapterMap = new Map(chapters.map(chapter => [chapter.id, chapter]))
  const seen = new Set<string>()
  for (const probe of probes) {
    if (seen.has(probe.id) || !probe.query.trim() || !chapterMap.has(probe.throughChapterId)) throw new Error(`Invalid public probe: ${probe.id}`)
    seen.add(probe.id)
    for (const expected of probe.expected) {
      if (!expected.quote || !chapterMap.get(expected.chapterId)?.text.includes(expected.quote)) throw new Error(`Probe quote missing from actual source: ${probe.id}`)
    }
    for (const quote of probe.forbiddenQuotes ?? []) {
      const cutoff = chapters.findIndex(chapter => chapter.id === probe.throughChapterId)
      if (!quote || !chapters.slice(cutoff + 1).some(chapter => chapter.text.includes(quote)) || chapters.slice(0, cutoff + 1).some(chapter => chapter.text.includes(quote))) {
        throw new Error(`Future probe is not future-exclusive: ${probe.id}`)
      }
    }
  }
  const totals = sources.reduce((total, source) => ({
    bytes: total.bytes + source.bytes, chapters: total.chapters + source.chapters,
    utf16Chars: total.utf16Chars + source.utf16Chars, codePoints: total.codePoints + source.codePoints, hanChars: total.hanChars + source.hanChars,
  }), { bytes: 0, chapters: 0, utf16Chars: 0, codePoints: 0, hanChars: 0 })
  return {
    project: { id: 'public-domain-shuihu-xiyou-v1', title: '水滸傳 + 西遊記（雙書壓力測試合集，非單部連貫小說）', chapters, clues: [] },
    manifest: { formatVersion: 1, label: 'Two-book public-domain anthology; not one continuous million-character novel', normalization: 'Verify original UTF-8 bytes; remove BOM and Gutenberg wrapper/credits; normalize CRLF to LF; retain body line breaks and characters; trim chapter outer whitespace. Counts exclude titles and metadata.', sources, totals, probesSha256: sha256(probeBytes) },
    probes,
  }
}
