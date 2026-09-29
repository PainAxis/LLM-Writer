interface NovelListEntry {
  title: string
  description?: string
  status?: string
  genre?: string
  wordCount?: number
  chapters?: number
  chapterList?: unknown[]
  createdAt?: string | Date
  updatedAt?: string | Date
}

interface NovelListQuery {
  status: string
  genre: string
  sort: string
  keyword: string
}

const timestamp = (value: string | Date | undefined) =>
  value instanceof Date ? value.getTime() : Date.parse(value || '') || 0

/** Sorting the visible list must never reorder the persisted collection. */
export function filterNovelList<T extends NovelListEntry>(novels: T[], query: NovelListQuery): T[] {
  const keyword = query.keyword.toLowerCase()
  return novels
    .filter(
      (novel) =>
        (query.status === 'all' || novel.status === query.status) &&
        (query.genre === 'all' || novel.genre === query.genre) &&
        (!keyword ||
          novel.title.toLowerCase().includes(keyword) ||
          (novel.description || '').toLowerCase().includes(keyword))
    )
    .sort((a, b) => {
      switch (query.sort) {
        case 'updated':
          return timestamp(b.updatedAt) - timestamp(a.updatedAt)
        case 'created':
          return timestamp(b.createdAt) - timestamp(a.createdAt)
        case 'wordCount':
          return (b.wordCount || 0) - (a.wordCount || 0)
        case 'chapters':
          return (
            (b.chapterList?.length ?? b.chapters ?? 0) - (a.chapterList?.length ?? a.chapters ?? 0)
          )
        default:
          return 0
      }
    })
}
