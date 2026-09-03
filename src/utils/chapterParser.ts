export interface ParsedChapter {
  title: string
  description: string
}

type ParseStrategy = (response: string) => ParsedChapter[] | null

/** 提取 "标题：xxx" / "大纲：xxx" 字段，兼容全角冒号 */
function extractTitleOutlineFields(lines: string[]): { title?: string; description?: string } {
  let title: string | undefined
  let description: string | undefined

  for (const raw of lines) {
    const trimmed = raw.trim()
    if (trimmed.match(/^标题[：:]/)) {
      title = trimmed.replace(/^标题[：:]/, '').trim()
    } else if (trimmed.match(/^大纲[：:]/)) {
      description = trimmed.replace(/^大纲[：:]/, '').trim()
    } else if (description && !trimmed.match(/^(标题|大纲)/)) {
      description += '\n' + trimmed
    } else if (!description && !trimmed.match(/^(标题|大纲)/) && trimmed.length > 0) {
      description = trimmed
    }
  }

  return { title, description }
}

/** 策略1: 按 "章节X：" 标记分割 */
export function parseByChapterNumber(response: string): ParsedChapter[] | null {
  const chapters: ParsedChapter[] = []

  const chapterRegex = /章节(\d+)[：:\s]*[\r\n]/gi
  const matches: Array<{ index: number; number: number; fullMatch: string }> = []
  let match: RegExpExecArray | null

  while ((match = chapterRegex.exec(response)) !== null) {
    matches.push({
      index: match.index,
      number: parseInt(match[1]),
      fullMatch: match[0],
    })
  }

  if (matches.length === 0) {
    // 宽松匹配
    const blocks = response.split(/章节\d+[：:]/i).filter((block) => block.trim())
    if (blocks.length <= 1) return null

    blocks.forEach((block, index) => {
      if (index === 0 && !block.includes('标题')) return

      const lines = block.split('\n').filter((line) => line.trim())
      const fields = extractTitleOutlineFields(lines)
      const title = fields.title ?? `第${index}章`
      const description = fields.description ?? ''
      if (title && description) chapters.push({ title, description })
    })
  } else {
    // 精确匹配处理
    for (let i = 0; i < matches.length; i++) {
      const current = matches[i]
      const next = matches[i + 1]

      const startIndex = current.index + current.fullMatch.length
      const endIndex = next ? next.index : response.length
      const block = response.substring(startIndex, endIndex).trim()

      const lines = block.split('\n').filter((line) => line.trim())
      const fields = extractTitleOutlineFields(lines)
      const title = fields.title ?? `第${current.number}章`
      const description = fields.description ?? ''
      if (title && description) chapters.push({ title, description })
    }
  }

  return chapters.length > 0 ? chapters : null
}

/** 策略2: 按标题/大纲字段分割 */
export function parseByTitleAndOutline(response: string): ParsedChapter[] | null {
  const chapters: ParsedChapter[] = []
  const lines = response.split('\n')
  let currentChapter: ParsedChapter | null = null

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.match(/^标题[：:]/)) {
      if (currentChapter && currentChapter.title && currentChapter.description) {
        chapters.push(currentChapter)
      }
      currentChapter = {
        title: trimmed.replace(/^标题[：:]/, '').trim(),
        description: '',
      }
    } else if (trimmed.match(/^大纲[：:]/)) {
      if (currentChapter) {
        currentChapter.description = trimmed.replace(/^大纲[：:]/, '').trim()
      }
    } else if (currentChapter && currentChapter.description && trimmed && !trimmed.match(/^(标题|大纲|章节)/)) {
      currentChapter.description += '\n' + trimmed
    }
  }

  if (currentChapter && currentChapter.title && currentChapter.description) {
    chapters.push(currentChapter)
  }

  return chapters.length > 0 ? chapters : null
}

/** 策略3: 按 "第X章" 格式分割 */
export function parseByChapterFormat(response: string): ParsedChapter[] | null {
  const chapters: ParsedChapter[] = []
  const chapterRegex = /第\d+章[：:\s]*([^\n]+)/g
  let match: RegExpExecArray | null
  const matches: Array<{ index: number; title: string; fullMatch: string }> = []

  while ((match = chapterRegex.exec(response)) !== null) {
    matches.push({
      index: match.index,
      title: match[1].trim(),
      fullMatch: match[0],
    })
  }

  if (matches.length === 0) return null

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i]
    const next = matches[i + 1]

    const startIndex = current.index + current.fullMatch.length
    const endIndex = next ? next.index : response.length
    const content = response.substring(startIndex, endIndex).trim()

    if (content) {
      chapters.push({ title: current.title, description: content })
    }
  }

  return chapters.length > 0 ? chapters : null
}

/** 策略4: 按空行分段分割 */
export function parseByParagraphs(response: string): ParsedChapter[] | null {
  const paragraphs = response.split(/\n\s*\n/).filter((p) => p.trim())
  if (paragraphs.length < 2) return null

  const chapters: ParsedChapter[] = []

  for (const paragraph of paragraphs) {
    const lines = paragraph.split('\n').filter((l) => l.trim())
    if (lines.length < 2) continue

    const title = lines[0].trim()
    const description = lines.slice(1).join('\n').trim()

    if (title && description && title.length < 100) {
      chapters.push({ title, description })
    }
  }

  return chapters.length > 0 ? chapters : null
}

/** 策略5: 智能标题模式分割 */
export function parseByTitlePattern(response: string): ParsedChapter[] | null {
  const chapters: ParsedChapter[] = []
  const lines = response.split('\n').filter((line) => line.trim())

  let currentTitle = ''
  let currentDescription = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    const isTitleLike =
      (line.length < 50 &&
        (line.includes('章') || line.includes('第') || line.match(/^\d+[\.\、]/)) &&
        !line.includes('：') &&
        !line.includes(':')) ||
      ((i === 0 || lines[i - 1].trim() === '') && line.length < 30 && line.length > 3)

    if (isTitleLike && currentDescription.length > 20) {
      if (currentTitle && currentDescription) {
        chapters.push({ title: currentTitle, description: currentDescription.trim() })
      }
      currentTitle = line
      currentDescription = ''
    } else if (currentTitle) {
      currentDescription += (currentDescription ? '\n' : '') + line
    } else {
      currentTitle = line
    }
  }

  if (currentTitle && currentDescription) {
    chapters.push({ title: currentTitle, description: currentDescription.trim() })
  }

  return chapters.length > 0 ? chapters : null
}

/**
 * 依次尝试多种解析策略解析 AI 返回的章节列表。
 * 所有策略失败时回退为单个默认章节。
 */
export function parseChapterResponse(response: string): ParsedChapter[] {
  const strategies: Array<{ name: string; run: ParseStrategy }> = [
    { name: 'parseByChapterNumber', run: parseByChapterNumber },
    { name: 'parseByTitleAndOutline', run: parseByTitleAndOutline },
    { name: 'parseByChapterFormat', run: parseByChapterFormat },
    { name: 'parseByParagraphs', run: parseByParagraphs },
    { name: 'parseByTitlePattern', run: parseByTitlePattern },
  ]

  for (const strategy of strategies) {
    const result = strategy.run(response)
    if (result && result.length > 0) {
      return result
    }
  }

  console.warn('所有解析策略都失败，创建默认章节')
  return [
    {
      title: 'AI生成章节',
      description: response.substring(0, 300) + (response.length > 300 ? '...' : ''),
    },
  ]
}
