import { decodeHTML } from 'entities/decode'

const knownTags = new Set('p div h1 h2 h3 h4 h5 h6 blockquote pre ul ol li dl dt dd table thead tbody tfoot tr td th figure figcaption section article header footer main aside address center details summary span strong b em i u s strike del ins sub sup a code kbd mark small big font ruby rt rp br hr img wbr script style'.split(' '))
const voidTags = new Set(['br', 'hr', 'img', 'wbr'])
const paragraphTags = new Set('p div h1 h2 h3 h4 h5 h6 blockquote pre table figure figcaption section article header footer main aside address center details summary'.split(' '))
const lineTags = new Set('ul ol li dl dt dd thead tbody tfoot tr'.split(' '))
const hiddenTags = new Set(['script', 'style'])
// Quoted attribute values can contain >; a tag name must end at a real delimiter.
const tagPattern = /<(\/?)([a-z][a-z0-9]*)(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi
interface ContentTag { start: number; end: number; name: string; closing: boolean; matched: boolean; partner?: number }

/** Convert stored editor HTML to text without interpreting literal text as arbitrary tags.
 * Paragraphs retain blank-line boundaries, <br> retains one line break, and entities
 * are decoded once after markup removal. Plain-text records keep their literal entities.
 */
export function stripWriterHtml(content: string): string {
  const markupContent = content.replace(/<!--[\s\S]*?-->/g, '')
  const tags: ContentTag[] = []
  const opened = new Map<string, number[]>()
  for (const match of markupContent.matchAll(tagPattern)) {
    const name = match[2].toLowerCase()
    if (!knownTags.has(name)) continue
    const index = tags.length
    const tag: ContentTag = { start: match.index!, end: match.index! + match[0].length, name, closing: match[1] === '/', matched: voidTags.has(name) }
    tags.push(tag)
    if (tag.matched) continue
    if (tag.closing) {
      const partner = opened.get(name)?.pop()
      if (partner !== undefined) {
        tag.matched = true
        tag.partner = partner
        tags[partner].matched = true
        tags[partner].partner = index
      }
    } else {
      const pending = opened.get(name) ?? []
      pending.push(index)
      opened.set(name, pending)
    }
  }
  // A bare <林>, a<b or unmatched <b> in an old plain-text record is prose.
  if (!tags.some(tag => tag.matched)) return content.trim()

  const chunks: string[] = []
  let trailingLines = 0
  let cursor = 0
  let previousBlock = false
  const append = (value: string) => {
    if (!value) return
    chunks.push(value)
    let lines = 0
    for (let index = value.length - 1; index >= 0 && value[index] === '\n'; index--) lines++
    trailingLines = lines === value.length ? trailingLines + lines : lines
  }
  const boundary = (lines: number) => {
    if (chunks.length && trailingLines < lines) append('\n'.repeat(lines - trailingLines))
  }
  const trimCellSeparator = () => {
    while (chunks.length) {
      const last = chunks[chunks.length - 1]
      const trimmed = last.replace(/\t+$/, '')
      if (trimmed === last) break
      if (trimmed) { chunks[chunks.length - 1] = trimmed; break }
      chunks.pop()
    }
    trailingLines = 0
    for (let index = chunks.length - 1; index >= 0; index--) {
      const tail = chunks[index]
      let lines = 0
      for (let position = tail.length - 1; position >= 0 && tail[position] === '\n'; position--) lines++
      trailingLines += lines
      if (lines !== tail.length) break
    }
  }
  for (const tag of tags) {
    if (!tag.matched || tag.start < cursor) continue
    const block = paragraphTags.has(tag.name) || lineTags.has(tag.name)
    const text = markupContent.slice(cursor, tag.start)
    // Pretty-print indentation between blocks is not a visible extra paragraph.
    if (text.trim() || (!previousBlock && !block)) append(text)
    if (hiddenTags.has(tag.name) && !tag.closing && tag.partner !== undefined) {
      cursor = tags[tag.partner].end
      previousBlock = false
      continue
    }
    if (tag.name === 'br') append('\n')
    else if (tag.name === 'hr') boundary(2)
    else if (paragraphTags.has(tag.name)) boundary(2)
    else if (lineTags.has(tag.name)) {
      if (tag.closing && tag.name === 'tr') trimCellSeparator()
      boundary(1)
    }
    else if (tag.closing && (tag.name === 'td' || tag.name === 'th')) append('\t')
    cursor = tag.end
    previousBlock = block
  }
  append(markupContent.slice(cursor))
  return decodeHTML(chunks.join('')).trim()
}

/** Shared Chinese-writing metric: visible Unicode characters excluding whitespace. */
export function countWriterWords(content: string): number {
  return countWriterPlainText(stripWriterHtml(content))
}

/** Raw AI output is plain text even when its prose resembles paired HTML tags. */
export function countWriterPlainText(text: string): number {
  return Array.from(text.replace(/\s/gu, '')).length
}

export function escapeWriterText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Streamed plain text uses line breaks rather than reinterpreting its literal markup. */
export function plainTextToWriterHtml(text: string): string {
  return `<p>${escapeWriterText(text).replace(/\r\n?/g, '\n').replace(/\n/g, '<br/>')}</p>`
}

export function formatGeneratedBody(rawContent: string): string {
  return formatGeneratedContent(rawContent, '')
}

export function formatGeneratedContent(rawContent: string, chapterTitle: string): string {
  const formatted = rawContent.trim()
  const heading = chapterTitle && !formatted.includes(chapterTitle) ? `<h3>${escapeWriterText(chapterTitle)}</h3>` : ''
  const body = formatted
    .split(/\r?\n/)
    .filter(paragraph => paragraph.trim())
    .map(paragraph => {
      const trimmed = paragraph.trim()
      if (/^#{1,6}\s+/.test(trimmed) || (chapterTitle && trimmed === chapterTitle)) {
        return `<h3>${escapeWriterText(trimmed.replace(/^#{1,6}\s+/, ''))}</h3>`
      }
      if (trimmed.startsWith('"') || trimmed.startsWith('“') || trimmed.startsWith('「')) {
        return `<p class="dialogue">${escapeWriterText(trimmed)}</p>`
      }
      return `<p>${escapeWriterText(trimmed)}</p>`
    })
    .join('')
  return heading + body
}
