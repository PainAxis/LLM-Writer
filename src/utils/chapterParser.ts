export interface ParsedChapter {
  title: string
  description: string
}

interface ChapterHeading {
  index: number
  title: string
  number: string
}

const chineseNumber = '[0-9一二三四五六七八九十百千万零〇两]+'
const chapterHeading = new RegExp(
  `^(?:章节\\s*(${chineseNumber})|第\\s*(${chineseNumber})\\s*章|Chapter\\s+(\\d+))(?:(?:\\s*[：:.．—-]\\s*|\\s+)(.*))?$`,
  'i',
)

/** Markdown decoration is permitted around explicit labels, never used to invent a title. */
function structuralLine(line: string): string {
  return line.trim().replace(/^#{1,6}\s+/, '').replace(/\*\*/g, '')
}

/** Permit short introductions to chapter blocks, without treating prose as chapter data. */
function isPrefaceLine(line: string): boolean {
  const text = structuralLine(line)
  if (!text) return true
  if (text.length > 160 || /抱歉|无法|不能|缺少|sorry|unable|cannot/i.test(text)) return false
  return /^(?:以下(?:是|为)|这里是|这是).*(?:章节|章).*大纲[：:。.]?$/.test(text)
    || /^(?:Here (?:are|is)|Below (?:are|is)|These are) .*(?:chapter outlines|outlines for .*chapters)[：:.]?$/i.test(text)
    || /^(?:章节大纲|Chapter outlines)[：:]?$/i.test(text)
}

function responseLines(response: string): string[] {
  const text = response.replace(/\r\n?/g, '\n').trim()
  const lines = text.split('\n')
  const fenceStart = lines.findIndex(line => /^```[^`]*$/.test(line.trim()))
  if (fenceStart >= 0 && lines.slice(0, fenceStart).every(isPrefaceLine)
    && lines[lines.length - 1].trim() === '```') {
    lines.pop()
    lines.splice(fenceStart, 1)
  }
  return lines
}

function titleField(line: string): RegExpMatchArray | null {
  return structuralLine(line).match(/^(?:标题|(?:Chapter\s+)?Title)\s*[：:]\s*(.*)$/i)
}

function outlineField(line: string): RegExpMatchArray | null {
  return structuralLine(line).match(/^(?:大纲|(?:Chapter\s+)?Outline)\s*[：:]\s*(.*)$/i)
}

function headings(lines: string[], numbered = false): ChapterHeading[] {
  const found: ChapterHeading[] = []
  lines.forEach((line, index) => {
    const match = numbered
      ? structuralLine(line).match(/^(\d+)[.．、)]\s*(.+)$/)
      : structuralLine(line).match(chapterHeading)
    const compactChinese = numbered ? null : structuralLine(line).match(new RegExp(`^第\\s*(${chineseNumber})\\s*章([^：:.．—-\\s].*)$`))
    if (!match && !compactChinese) return
    found.push({
      index,
      number: match ? (numbered ? match[1] : (match[1] ?? match[2] ?? match[3])) : compactChinese![1],
      title: (match ? (numbered ? match[2] : match[4] ?? '') : compactChinese![2]).trim(),
    })
  })
  return found
}

/** Every block must be complete. A partial block must not disappear from the saved result. */
function parseBlock(lines: string[], headingTitle = ''): ParsedChapter | null {
  const inlineTitle = titleField(headingTitle)
  let title = inlineTitle ? inlineTitle[1].trim() : headingTitle
  let hasTitleField = Boolean(inlineTitle)
  let hasOutlineField = false
  const body: string[] = []
  for (const line of lines) {
    const titleMatch = titleField(line)
    const outlineMatch = outlineField(line)
    if (titleMatch) {
      if (hasTitleField || hasOutlineField || body.some(part => part.trim())) return null
      hasTitleField = true
      title = titleMatch[1].trim()
    } else if (outlineMatch) {
      if (hasOutlineField || body.some(part => part.trim())) return null
      hasOutlineField = true
      body.push(outlineMatch[1])
    } else {
      body.push(line)
    }
  }
  const description = body.join('\n').trim()
  // Field-based blocks need an explicit outline label; titled chapter headings can use prose.
  if (!title || !description || (!hasOutlineField && (!headingTitle || hasTitleField))) return null
  return { title, description }
}

function parseHeadings(lines: string[], found: ChapterHeading[]): ParsedChapter[] | null {
  if (!found.length || !lines.slice(0, found[0].index).every(isPrefaceLine)) return null
  const chapters: ParsedChapter[] = []
  const numbers = new Set<string>()
  for (let index = 0; index < found.length; index += 1) {
    const heading = found[index]
    if (numbers.has(heading.number)) return null
    numbers.add(heading.number)
    const next = found[index + 1]
    const chapter = parseBlock(lines.slice(heading.index + 1, next?.index), heading.title)
    if (!chapter) return null
    chapters.push(chapter)
  }
  return chapters
}

/** Explicit Chinese or English numbered chapter headings. */
export function parseByChapterNumber(response: string): ParsedChapter[] | null {
  const lines = responseLines(response)
  return parseHeadings(lines, headings(lines))
}

/** Repeated 标题/大纲 or Title/Outline pairs, including multiline outlines. */
export function parseByTitleAndOutline(response: string): ParsedChapter[] | null {
  const lines = responseLines(response)
  const starts = lines.flatMap((line, index) => titleField(line) ? [index] : [])
  if (!starts.length || !lines.slice(0, starts[0]).every(isPrefaceLine)) return null
  const chapters: ParsedChapter[] = []
  for (let index = 0; index < starts.length; index += 1) {
    const chapter = parseBlock(lines.slice(starts[index], starts[index + 1]))
    if (!chapter) return null
    chapters.push(chapter)
  }
  return chapters
}

export function parseByChapterFormat(response: string): ParsedChapter[] | null {
  return parseByChapterNumber(response)
}

/** Numbered title headings are structural; arbitrary paragraph pairs are not. */
export function parseByTitlePattern(response: string): ParsedChapter[] | null {
  const lines = responseLines(response)
  return parseHeadings(lines, headings(lines, true))
}

export function parseByParagraphs(response: string): ParsedChapter[] | null {
  return parseByTitleAndOutline(response) ?? parseByTitlePattern(response)
}

/** Only explicit, complete chapter structures are accepted; callers retain failed raw responses. */
export function parseChapterResponse(response: string): ParsedChapter[] {
  const lines = responseLines(response)
  const found = headings(lines)
  if (found.length) return parseHeadings(lines, found) ?? []
  if (lines.some(line => titleField(line) || outlineField(line))) {
    return parseByTitleAndOutline(response) ?? []
  }
  return parseByTitlePattern(response) ?? []
}
