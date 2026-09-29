import type { BookChapter, BookAnalysisTemplate, BookAnalysisData } from '@/types/bookAnalysis'

export function detectBookChapters(content: string): BookChapter[] {
  const chapters: BookChapter[] = []
  let current: BookChapter | undefined
  for (const [index, line] of content.split('\n').entries()) {
    if (/(第[一二三四五六七八九十百千万\d]+[章节]|Chapter\s*\d+)/i.test(line)) {
      current = { index: chapters.length, title: line.trim(), startLine: index, wordCount: 0 }
      chapters.push(current)
    } else if (current) current.wordCount += line.length
  }
  return chapters
}

export function readBookChapter(content: string, chapters: BookChapter[], chapter: BookChapter): string {
  if (chapter.startPos !== undefined) return content.slice(chapter.startPos, chapter.endPos)
  const lines = content.split('\n')
  const next = chapters.find(item => item.index === chapter.index + 1)
  return lines.slice(chapter.startLine ?? 0, next?.startLine ?? lines.length).join('\n')
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

export function prepareBookAnalysis(source: AnalysisSource): BookAnalysisData {
  const { content, chapters, selectedChapters, start, end } = source
  const template = source.templates.find(item => String(item.id) === String(source.templateId))
  if (!template) throw new Error('未找到分析模板，请检查提示词库设置。')
  let textToAnalyze = ''
  const chapterInfos: BookAnalysisData['chapterInfos'] = []
  for (const index of selectedChapters) {
    const chapter = chapters.find(item => item.index === index)
    if (!chapter) continue
    textToAnalyze += readBookChapter(content, chapters, chapter) + '\n\n'
    chapterInfos.push({ title: chapter.title, wordCount: chapter.wordCount, summary: chapter.summary || '暂无简读' })
  }
  if (!selectedChapters.length) textToAnalyze = content.slice(Math.max(0, start - 1), Math.min(content.length, end))
  return {
    textToAnalyze,
    analysisInfo: selectedChapters.length ? `分析章节：${selectedChapters.length}章` : `分析范围：第${start} - ${end}字`,
    chapterInfos, template, totalWordCount: content.length, fileName: source.fileName, encoding: source.encoding,
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
