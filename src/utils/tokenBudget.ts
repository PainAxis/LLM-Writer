/**
 * Token 估算与上下文截断预算工具。
 * 将散落在各处的"截多少"决策集中登记于此，替代裸 slice 魔法数字；
 * 估算公式与计费服务保持同一来源，供上下文管理（contextPolicy）复用。
 */

/** 粗略估算 token 数量（1个中文字符 ≈ 1.5 token） */
export function estimateTokens(text: string): number {
  if (!text) return 0

  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length
  const englishWords = (text.match(/[a-zA-Z]+/g) ?? []).length
  const otherChars = text.length - chineseChars - englishWords

  return Math.ceil(chineseChars * 1.5 + englishWords * 1.3 + otherChars * 0.5)
}

// ---- 截断预算登记表：所有上下文截断的额度在此集中声明 ----

/** 章节生成时携带的"前文内容参考"最大字符数 */
export const PREVIOUS_CONTENT_MAX_CHARS = 500

/** 参考章节内容截取（开头/结尾各保留的字符数） */
export const CHAPTER_EXCERPT_MAX_CHARS = 500

/** 章节生成上下文中携带的最近章节数 */
export const RECENT_CHAPTERS_FOR_CONTEXT = 2

/** 事件线上下文中携带的最近事件数 */
export const RECENT_EVENTS_FOR_CONTEXT = 3

/** 取文本开头 maxChars 字符（超出部分从尾部丢弃） */
export function trimTextFromStart(text: string, maxChars: number): string {
  if (!text || text.length <= maxChars) return text ?? ''
  return text.slice(0, maxChars)
}

/** 取文本末尾 maxChars 字符（超出部分从头部丢弃） */
export function trimTextFromEnd(text: string, maxChars: number): string {
  if (!text || text.length <= maxChars) return text ?? ''
  return text.slice(-maxChars)
}

/** 取列表末尾 count 项 */
export function takeLastItems<T>(items: T[] | undefined | null, count: number): T[] {
  if (!items || items.length <= count) return items ? [...items] : []
  return items.slice(-count)
}
