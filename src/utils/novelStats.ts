import type { WriterChapter, WriterNovel } from '@/types/writer'
import { countWriterWords } from './writerContent'

const validCount = (value: number | undefined) => Number.isFinite(value) && value! >= 0 ? value! : 0

export function getChapterWordCount(chapter: Pick<WriterChapter, 'content' | 'wordCount'>): number {
  return typeof chapter.content === 'string' ? countWriterWords(chapter.content) : validCount(chapter.wordCount)
}

/** Derive display/export totals from chapters; retain aggregate-only legacy records. */
export function getNovelWordStats(novel: Pick<WriterNovel, 'chapterList' | 'wordCount' | 'totalWords' | 'chapters'>) {
  const chapters = novel.chapterList?.length ?? validCount(novel.chapters)
  const total = novel.chapterList
    ? novel.chapterList.reduce((sum, chapter) => sum + getChapterWordCount(chapter), 0)
    : validCount(novel.wordCount ?? novel.totalWords)
  return { wordCount: total, totalWords: total, chapters, avgWordsPerChapter: chapters ? Math.round(total / chapters) : 0 }
}
