import { ref } from 'vue'
import { storageGet, storageSet, StorageKeys } from '@/utils/storage'
import { applyMindMapEdits } from '@/utils/mindmapEditing'
import { generateUniqueId } from '@/utils/id'
import type { WriterNovel } from '@/types/writer'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

/** Transactional map edits: fresh-source check, awaited persistence, stable retry identities. */
export function useMindMapDraft(
  persistence = {
    load: (): WriterNovel[] => storageGet<WriterNovel[]>(StorageKeys.novels, []),
    save: (novels: WriterNovel[]): void | Promise<void> => storageSet(StorageKeys.novels, novels),
  }
) {
  const editing = ref(false)
  const dirty = ref(false)
  const saving = ref(false)
  let source: WriterNovel | null = null
  let pendingFingerprint = ''
  let saveTime: string | undefined
  const newIds = new Map<string, number>()

  function begin(novel: WriterNovel) {
    if (saving.value) return
    source = clone(novel)
    pendingFingerprint = ''
    saveTime = undefined
    newIds.clear()
    editing.value = true
    dirty.value = false
  }
  function markDirty() {
    if (editing.value && !saving.value) dirty.value = true
  }
  function cancel() {
    if (saving.value) return
    editing.value = false
    dirty.value = false
    source = null
    pendingFingerprint = ''
    saveTime = undefined
    newIds.clear()
  }
  function prepare(data: unknown) {
    if (!source || !editing.value) throw new Error('请先开启导图编辑')
    return applyMindMapEdits(source, data, {
      now: (saveTime ??= new Date().toISOString()),
      createId: (nodeId) => {
        if (!newIds.has(nodeId)) {
          const used = new Set([
            ...newIds.values(),
            ...[
              source!.chapterList,
              source!.characters,
              source!.worldSettings,
              source!.events,
              source!.corpusData,
            ].flatMap((items) => (items ?? []).map((item) => item.id)),
          ])
          let id = generateUniqueId()
          while (used.has(id)) id++
          newIds.set(nodeId, id)
        }
        return newIds.get(nodeId)!
      },
    })
  }
  async function save(data: unknown): Promise<WriterNovel> {
    if (saving.value) throw new Error('正在保存导图')
    const candidate = prepare(data).novel
    const novels = persistence.load()
    const index = novels.findIndex((novel) => novel.id === source?.id)
    const current = novels[index]
    if (!current) throw new Error('小说已删除，请重新选择作品')
    const fingerprint = JSON.stringify(current)
    if (fingerprint !== JSON.stringify(source) && fingerprint !== pendingFingerprint) {
      throw new Error('小说已在其他位置修改，请取消编辑并重新加载后再修改')
    }
    const next = [...novels]
    next[index] = candidate
    pendingFingerprint = JSON.stringify(candidate)
    saving.value = true
    try {
      await persistence.save(next)
      return clone(candidate)
    } finally {
      saving.value = false
    }
  }
  return { editing, dirty, saving, begin, markDirty, cancel, prepare, save }
}
