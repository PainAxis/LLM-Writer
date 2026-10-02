import type { BookChapter, BookAnalysisTemplate, BookAnalysisData } from '@/types/bookAnalysis'

// Match a whole heading line, never a chapter reference embedded in prose.
// Chinese headings also commonly omit the space before their title.
const chapterHeading = /^(?:第[零〇一二三四五六七八九十百千万两\d]+[章节][^\r\n]*|Chapter[ \t]*\d+(?:[ \t　:：.．、\-—]+[^\r\n]*)?)$/i
const bookLines = (content: string) => content.split(/\r\n?|\n/)

export function detectBookChapters(content: string): BookChapter[] {
  const chapters: BookChapter[] = []
  let current: BookChapter | undefined
  for (const [index, line] of bookLines(content).entries()) {
    const title = line.trim()
    if (chapterHeading.test(title)) {
      current = { index: chapters.length, title, startLine: index, wordCount: 0 }
      chapters.push(current)
    } else if (current) current.wordCount += line.length
  }
  return chapters
}

function readChapter(content: string, chapters: BookChapter[], chapter: BookChapter, sourceLines?: string[]): string {
  if (chapter.startPos !== undefined) return content.slice(chapter.startPos, chapter.endPos)
  const lines = sourceLines ?? bookLines(content)
  const next = chapters.find(item => item.index === chapter.index + 1)
  return lines.slice(chapter.startLine ?? 0, next?.startLine ?? lines.length).join('\n')
}

export function readBookChapter(content: string, chapters: BookChapter[], chapter: BookChapter): string {
  return readChapter(content, chapters, chapter)
}

interface AnalysisSource {
  content: string
  chapters: BookChapter[]
  selectedChapters: number[]
  start: number
  end: number
  templates: BookAnalysisTemplate[]
  templateId: number | string
  fileName: string
  encoding: string
}

/** The preview and submission must describe the same explicit text selection. */
export function prepareBookAnalysisSelection(source: Pick<AnalysisSource, 'content' | 'chapters' | 'selectedChapters' | 'start' | 'end'>):
  Pick<BookAnalysisData, 'textToAnalyze' | 'analysisInfo' | 'chapterInfos'> {
  const { content, chapters, selectedChapters, start, end } = source
  let textToAnalyze = ''
  const chapterInfos: BookAnalysisData['chapterInfos'] = []
  if (chapters.length) {
    if (!selectedChapters.length) throw new Error('请至少选择一个章节后开始分析')
    const sourceLines = chapters.some(chapter => chapter.startPos === undefined) ? bookLines(content) : undefined
    for (const index of selectedChapters) {
      const chapter = chapters.find(item => item.index === index)
      if (!chapter) throw new Error('章节选择已失效，请重新选择要分析的章节')
      textToAnalyze += readChapter(content, chapters, chapter, sourceLines) + '\n\n'
      chapterInfos.push({ title: chapter.title, wordCount: chapter.wordCount, summary: chapter.summary || '暂无简读' })
    }
  } else {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > content.length) {
      throw new Error('请设置有效的分析字数范围')
    }
    textToAnalyze = content.slice(start - 1, end)
  }
  if (!textToAnalyze.trim()) throw new Error('所选分析范围没有正文')
  return {
    textToAnalyze,
    analysisInfo: chapters.length ? `分析章节：${chapterInfos.length}章` : `分析范围：第${start} - ${end}字`,
    chapterInfos,
  }
}

export function prepareBookAnalysis(source: AnalysisSource): BookAnalysisData {
  const template = source.templates.find(item => String(item.id) === String(source.templateId))
  if (!template) throw new Error('未找到分析模板，请检查提示词库设置。')
  return {
    ...prepareBookAnalysisSelection(source),
    template, totalWordCount: source.content.length, fileName: source.fileName, encoding: source.encoding,
  }
}

export function buildBookAnalysisPrompt(data: BookAnalysisData) {
  const { textToAnalyze, analysisInfo, chapterInfos, template, totalWordCount, fileName, encoding } = data
  return `你是一位专业的文学分析师和写作导师，请根据以下模板和要求对小说文本进行深度拆书分析。

## 分析模板信息
模板名称：${template.name}
模板描述：${template.description || '专业拆书分析'}

## 文本信息
文件名：${fileName}
编码格式：${encoding.toUpperCase()}
总字数：${totalWordCount.toLocaleString()}字
${analysisInfo}
分析文本字数：${textToAnalyze.length.toLocaleString()}字

## 章节信息
${chapterInfos.length > 0 ?
  chapterInfos.map(chapter => `- ${chapter.title}：${chapter.wordCount}字，${chapter.summary}`).join('\n') :
  '分析字数区间内容，无明确章节划分'
}

## 分析要求
${template.content}

## 待分析文本
${textToAnalyze}

请按照上述模板要求进行专业的拆书分析，输出应该结构清晰、专业详实，适合作为写作学习的参考资料。`

}
