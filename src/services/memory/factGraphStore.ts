import type { FactGraphDocument } from '../../types/factGraph'
import { idbCompareAndSwap, idbGet } from '../blobStore'
import { emptyFactGraph, FACT_GRAPH_MAX_DOCUMENT_CHARS, validateFactGraphDocument } from './factGraph'

function storageKey(projectId: string): string {
  emptyFactGraph(projectId)
  return `memory-fact-graph:v1:${projectId}`
}

function parseStored(raw: string, projectId: string): FactGraphDocument {
  if (raw.length > FACT_GRAPH_MAX_DOCUMENT_CHARS) throw new Error('事实关系图存储超过 2,400 万字符上限；原有数据已保留。')
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error('事实关系图存储已损坏；原有数据已保留，请恢复存储数据后重试。') }
  const document = validateFactGraphDocument(value, projectId)
  if (!document.revision.trim()) throw new Error('事实关系图存储缺少版本；原有数据已保留，请恢复存储数据后重试。')
  return document
}

export async function readFactGraph(projectId: string): Promise<FactGraphDocument> {
  const raw = await idbGet(storageKey(projectId))
  return raw === null ? emptyFactGraph(projectId) : parseStored(raw, projectId)
}

/** Compare-and-swap prevents concurrent tabs from silently losing author annotations. */
export async function saveFactGraph(document: FactGraphDocument, expectedRevision: string | null): Promise<FactGraphDocument> {
  // Capture validated caller data before the first await.
  const snapshot = validateFactGraphDocument(document)
  if (expectedRevision !== null && (typeof expectedRevision !== 'string' || !expectedRevision.trim())) {
    throw new Error('关系图保存需要有效的已读取版本。')
  }
  const key = storageKey(snapshot.projectId)
  const before = await idbGet(key)
  const current = before === null ? null : parseStored(before, snapshot.projectId)
  if ((current?.revision ?? null) !== expectedRevision) throw new Error('关系图已在其他窗口修改，请刷新关系图后重试；本次修改未覆盖已保存数据。')
  snapshot.revision = crypto.randomUUID()
  const serialized = JSON.stringify(snapshot)
  if (serialized.length > FACT_GRAPH_MAX_DOCUMENT_CHARS) throw new Error('事实关系图存储超过 2,400 万字符上限；原有数据已保留。')
  if (!await idbCompareAndSwap(key, before, serialized)) {
    throw new Error('关系图已在其他窗口修改，请刷新关系图后重试；本次修改未覆盖已保存数据。')
  }
  return validateFactGraphDocument(snapshot)
}
