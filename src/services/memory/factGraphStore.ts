import type { FactGraphDocument } from '../../types/factGraph'
import { idbCompareAndSwap, idbCompareAndSwapMany, idbGet, idbGetMany, isBlobStoreAvailable } from '../blobStore'
import { assertFactGraphSupportedVersion, emptyFactGraph, FACT_GRAPH_MAX_DOCUMENT_CHARS, validateFactGraphDocument } from './factGraph'

// Keep the historical key: a second v2 key could resurrect stale v1 annotations.
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

/** Invalid known-version data can be repaired; unsupported schemas cannot. */
function checkRestoreToken(raw: string | null): void {
  if (raw === null) return
  let value: unknown
  try { value = JSON.parse(raw) } catch { return } // Explicit backup restore may repair malformed JSON.
  assertFactGraphSupportedVersion(value)
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

export interface FactGraphBackupSnapshot {
  /** Raw values are the compare-and-swap tokens, including absence. */
  raw: Map<string, string | null>
  documents: FactGraphDocument[]
}

/** No filtering by current source or disclosure: backups retain every author annotation. */
async function readGraphSnapshot(projectIds: readonly string[], validateStored: boolean): Promise<FactGraphBackupSnapshot> {
  const ids = [...projectIds]
  const keys = ids.map(storageKey)
  const stored = isBlobStoreAvailable() ? await idbGetMany(keys) : new Map<string, string | null>()
  const raw = new Map<string, string | null>()
  const documents: FactGraphDocument[] = []
  for (const [index, id] of ids.entries()) {
    const value = stored.get(keys[index]!) ?? null
    raw.set(id, value)
    // A corrupt graph fails the entire export rather than silently losing annotations.
    if (value !== null && validateStored) documents.push(parseStored(value, id))
    else checkRestoreToken(value)
  }
  return { raw, documents }
}

export async function readFactGraphsForBackup(projectIds: readonly string[]): Promise<FactGraphBackupSnapshot> {
  return readGraphSnapshot(projectIds, true)
}

/** A valid backup can repair corrupt known schemas, never an unsupported future schema. */
export async function captureFactGraphRestoreSnapshot(projectIds: readonly string[]): Promise<FactGraphBackupSnapshot> {
  return readGraphSnapshot(projectIds, false)
}

/** Novel restoration has already committed; replace all paired graphs in one IDB transaction. */
export async function restoreFactGraphsFromBackup(
  documents: readonly FactGraphDocument[], expected: FactGraphBackupSnapshot,
  canCommit: () => boolean = () => true,
): Promise<void> {
  // Recheck even caller-constructed snapshots before any write. Capture is not authority
  // to overwrite a schema this application cannot understand.
  for (const raw of expected.raw.values()) checkRestoreToken(raw)
  const seen = new Set<string>()
  const replacements = new Map(documents.map(document => {
    const snapshot = validateFactGraphDocument(document)
    if (!expected.raw.has(snapshot.projectId) || seen.has(snapshot.projectId)) throw new Error('事实关系图没有对应的恢复作品或作品重复。')
    seen.add(snapshot.projectId)
    return [snapshot.projectId, snapshot] as const
  }))
  if (!isBlobStoreAvailable()) {
    if (documents.length > 0) throw new Error('IndexedDB 不可用，无法恢复事实关系图。')
    return
  }
  const entries = [...expected.raw].map(([projectId, raw]) => {
    const document = replacements.get(projectId) ?? emptyFactGraph(projectId)
    // Never resurrect a backup's CAS token: an already open tab must reload.
    document.revision = crypto.randomUUID()
    const value = JSON.stringify(document)
    if (value.length > FACT_GRAPH_MAX_DOCUMENT_CHARS) throw new Error('事实关系图存储超过 2,400 万字符上限。')
    return { key: storageKey(projectId), expectedValue: raw, value }
  })
  if (!await idbCompareAndSwapMany(entries, canCommit)) {
    throw new Error('作品或关系图在导入期间已被其他窗口修改，本次导入未覆盖这些标注；请刷新后重试。')
  }
}
