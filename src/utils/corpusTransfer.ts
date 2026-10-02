import type { WriterCorpusItem } from '@/types/writer'

/** Accept the old standalone corpus array and the current portable envelope. */
export function parseCorpus(input: unknown): WriterCorpusItem[] {
  const items = Array.isArray(input) ? input
    : input && typeof input === 'object' && 'format' in input && input.format === 'llm-writer-corpus'
      && 'version' in input && input.version === 1 && 'items' in input ? input.items : null
  if (!Array.isArray(items)) throw new Error('请选择语料数组或 LLM-Writer 语料文件')
  return items.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`第 ${index + 1} 条语料格式错误`)
    const item = value as Record<string, unknown>
    if (typeof item.id !== 'number' || !Number.isSafeInteger(item.id) || item.id <= 0
      || typeof item.content !== 'string'
      || (!item.content.trim() && !(typeof item.title === 'string' && item.title.trim()))) {
      throw new Error(`第 ${index + 1} 条语料需要有效 ID、文本内容和非空标题或内容`)
    }
    for (const field of ['title', 'type', 'category']) {
      if (item[field] !== undefined && typeof item[field] !== 'string') throw new Error(`第 ${index + 1} 条语料的 ${field} 必须是文本`)
    }
    if (item.tags !== undefined && (!Array.isArray(item.tags) || !item.tags.every(tag => typeof tag === 'string'))) {
      throw new Error(`第 ${index + 1} 条语料的标签必须是文本数组`)
    }
    for (const field of ['createdAt', 'updatedAt']) {
      if (item[field] !== undefined && typeof item[field] !== 'string' && typeof item[field] !== 'number') {
        throw new Error(`第 ${index + 1} 条语料的日期格式错误`)
      }
    }
    return { ...item, id: item.id, content: item.content,
      title: typeof item.title === 'string' && item.title.trim() ? item.title : item.content.trim().slice(0, 32),
    }
  })
}

/** Append without overwriting existing records or discarding extension metadata. */
export function mergeCorpus(existing: readonly WriterCorpusItem[], imported: readonly WriterCorpusItem[]): WriterCorpusItem[] {
  const ids = new Set([...existing, ...imported].map(item => item.id))
  const used = new Set(existing.map(item => item.id))
  let next = 1
  return [...existing, ...imported.map(item => {
    let id = item.id
    if (used.has(id)) {
      while (ids.has(next) || used.has(next)) next++
      id = next++
    }
    used.add(id)
    return { ...item, id, tags: item.tags ? [...item.tags] : undefined }
  })]
}

export function createCorpusExport(items: readonly WriterCorpusItem[]) {
  return { format: 'llm-writer-corpus', version: 1, items }
}
