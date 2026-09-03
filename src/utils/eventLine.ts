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
