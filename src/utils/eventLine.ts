/**
 * 事件线纯函数集。
 */

export interface EventLike {
  chapter?: string | number
  [key: string]: unknown
}

export interface ChapterLike {
  title?: string
  [key: string]: unknown
}

/**
 * 旧数据迁移：事件的 chapter 字段历史上存的是章节标题，
 * 而下游管线（生成上下文/思维导图/时间线排序）按章号 parseInt 解析。
 * 原位把能匹配到章节标题的值替换为「章号字符串」；无法匹配的保持原样。
 * 返回是否有改动，由调用方决定是否持久化。
 */
export function migrateEventChapters(events: EventLike[], chapters: ChapterLike[]): boolean {
  let changed = false
  for (const event of events) {
    if (!event.chapter) continue
    const value = String(event.chapter).trim()
    const asNumber = parseInt(value, 10)
    if (Number.isFinite(asNumber) && String(asNumber) === value) continue
    const index = chapters.findIndex((chapter) => chapter.title === value)
    if (index > -1) {
      event.chapter = String(index + 1)
      changed = true
    }
  }
  return changed
}

/** Keep event links attached to chapter identities when the chapter order changes.
 * Numeric legacy links retain their value type; recognized title links become
 * chapter numbers. Deleted targets are unlinked, while unknown legacy values
 * and all extension fields are preserved. Neither input collection is mutated.
 */
export function remapEventChapters<T extends EventLike>(
  events: readonly T[],
  previousChapters: readonly (ChapterLike & { id: number })[],
  nextChapters: readonly (ChapterLike & { id: number })[],
): T[] {
  const nextNumbers = new Map(nextChapters.map((chapter, index) => [chapter.id, index + 1]))
  return events.map(event => {
    if (event.chapter === undefined || event.chapter === '') return event
    const number = Number(event.chapter)
    const previous = Number.isInteger(number)
      ? number > 0 && number <= previousChapters.length ? previousChapters[number - 1] : undefined
      : typeof event.chapter === 'string'
        ? previousChapters.find(chapter => chapter.title === String(event.chapter).trim())
        : undefined
    if (!previous) return event
    const nextNumber = nextNumbers.get(previous.id)
    const chapter = nextNumber === undefined ? ''
      : typeof event.chapter === 'number' ? nextNumber : String(nextNumber)
    return chapter === event.chapter ? event : { ...event, chapter }
  })
}
