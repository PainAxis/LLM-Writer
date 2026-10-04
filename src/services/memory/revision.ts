import type { MemoryChapterInput } from '../../types/memory'

/** Content-derived versions also catch edits whose updatedAt was not changed. */
export async function chapterRevision(chapter: Pick<MemoryChapterInput, 'title' | 'text'>): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('记忆检索需要 HTTPS 或 localhost 安全环境')
  const bytes = new TextEncoder().encode(JSON.stringify([chapter.title, chapter.text]))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
}
