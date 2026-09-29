export interface BookChapter {
  index: number
  title: string
  wordCount: number
  startLine?: number
  startPos?: number
  endPos?: number
  summary?: string
}

export interface BookAnalysisTemplate {
  id: number | string
  name: string
  description?: string
  content: string
}

export interface BookAnalysisData {
  textToAnalyze: string
  analysisInfo: string
  chapterInfos: Array<{ title: string; wordCount: number; summary: string }>
  template: BookAnalysisTemplate
  totalWordCount: number
  fileName: string
  encoding: string
}
