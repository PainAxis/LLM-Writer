import { computed, ref } from 'vue'
import type { WorldSetting } from '@/stores/novel'
import { migrateEventChapters, type EventLike } from '@/utils/eventLine'
import { StorageKeys, storageGet, storageSet } from '@/utils/storage'
import { registerNovelPersistenceRetryHandler } from '@/services/novelPersistence'

export interface WriterChapter {
  id: number
  title: string
  content?: string
  wordCount?: number
  status?: string
  createdAt?: Date | string
  updatedAt?: Date | string
  [key: string]: unknown
}

type Material = Record<string, unknown>

export interface WriterNovel {
  id: number
  chapterList?: WriterChapter[]
  characters?: Material[]
  worldSettings?: WorldSetting[]
  corpusData?: Material[]
  events?: EventLike[]
  [key: string]: unknown
}

interface BeforeUnloadTarget {
  addEventListener(type: 'beforeunload', handler: (event: BeforeUnloadEvent) => void): void
  removeEventListener(type: 'beforeunload', handler: (event: BeforeUnloadEvent) => void): void
}

interface WriterProjectOptions {
  novelStore: { worldSettings: WorldSetting[] }
  notifyError: (message: string) => void
  /** 可注入事件目标；Node 下默认不注册浏览器事件。 */
  beforeUnloadTarget?: BeforeUnloadTarget | null
  persistence?: {
    load: () => WriterNovel[]
    save: (novels: WriterNovel[]) => void | Promise<void>
  }
}

// Stored project data is JSON. Cloning on both boundaries keeps mutable editor
// objects separate from the last persisted snapshot, including nested materials.
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** Project loading, chapter edits and persistence, independent of Writer's UI. */
export function useWriterProject(options: WriterProjectOptions) {
  const persistence = options.persistence ?? {
    load: () => storageGet<WriterNovel[]>(StorageKeys.novels, []),
    save: (novels: WriterNovel[]) => storageSet(StorageKeys.novels, novels),
  }
  const currentNovel = ref<WriterNovel | null>(null)
  const chapters = ref<WriterChapter[]>([])
  const currentChapter = ref<WriterChapter | null>(null)
  const content = ref('')
  const characters = ref<Material[]>([])
  const corpusData = ref<Material[]>([])
  const events = ref<EventLike[]>([])
  const worldSettings = computed(() => options.novelStore.worldSettings)
  const contentWordCount = computed(() => content.value.replace(/<[^>]*>/g, '').length)
  const hasUnsavedChanges = ref(false)
  const isSaving = ref(false)
  const saveError = ref<string | null>(null)
  let autoSaveTimer: ReturnType<typeof setTimeout> | undefined
  let pendingSaves = 0
  let editVersion = 0
  let initializationVersion = 0
  let selectionVersion = 0
  let disposed = false
  const unloadTarget = options.beforeUnloadTarget === undefined
    ? (typeof window === 'undefined' ? null : window)
    : options.beforeUnloadTarget
  const warnBeforeUnload = (event: BeforeUnloadEvent) => {
    // 防抖计时尚未结束时，持久化后端还看不到这批编辑。
    if (hasUnsavedChanges.value || isSaving.value || saveError.value) {
      event.preventDefault()
      event.returnValue = ''
    }
  }
  unloadTarget?.addEventListener('beforeunload', warnBeforeUnload)
  const unregisterRetry = options.persistence ? () => undefined : registerNovelPersistenceRetryHandler(async () => {
    if (!(await saveCurrentChapter())) throw new Error(saveError.value ?? '小说保存失败')
  })

  function cancelAutoSave() {
    if (autoSaveTimer !== undefined) clearTimeout(autoSaveTimer)
    autoSaveTimer = undefined
  }

  function reportSaveError(error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    const message = `保存失败，编辑内容仍保留在当前页面，请重试：${detail}`
    if (saveError.value !== message) options.notifyError(message)
    saveError.value = message
    hasUnsavedChanges.value = true
  }

  function copyEditorContent() {
    if (!currentChapter.value) return
    currentChapter.value.content = content.value
    currentChapter.value.wordCount = contentWordCount.value
    currentChapter.value.updatedAt = new Date()
  }

  async function saveNovelData(): Promise<boolean> {
    if (!currentNovel.value) return true
    cancelAutoSave()
    const novelId = currentNovel.value.id
    const savedEditVersion = editVersion
    const savedContent = content.value
    pendingSaves += 1
    isSaving.value = true
    try {
      copyEditorContent()
      const totalWordCount = chapters.value.reduce((sum, chapter) => sum + (chapter.wordCount || 0), 0)
      const novelData: WriterNovel = clone({
        ...currentNovel.value,
        chapterList: chapters.value,
        characters: characters.value,
        worldSettings: options.novelStore.worldSettings,
        corpusData: corpusData.value,
        events: events.value,
        updatedAt: new Date(),
        wordCount: totalWordCount,
        chapters: chapters.value.length,
        totalWords: totalWordCount,
      })
      const novels = [...persistence.load()]
      const index = novels.findIndex(novel => novel.id === novelId)
      if (index > -1) novels[index] = novelData
      else novels.push(novelData)
      await persistence.save(novels)
      if (currentNovel.value?.id === novelId && editVersion === savedEditVersion && content.value === savedContent) {
        hasUnsavedChanges.value = false
        saveError.value = null
      }
      return true
    } catch (error) {
      reportSaveError(error)
      return false
    } finally {
      pendingSaves -= 1
      isSaving.value = pendingSaves > 0
    }
  }

  async function saveCurrentChapter(): Promise<boolean> {
    // A route/chapter change waits for this method. Include keystrokes received
    // while an earlier snapshot was being committed before allowing navigation.
    let savedVersion: number
    let savedContent: string
    do {
      savedVersion = editVersion
      savedContent = content.value
      if (!(await saveNovelData())) return false
    } while (editVersion !== savedVersion || content.value !== savedContent)
    return true
  }

  function loadChapter(chapter: WriterChapter) {
    cancelAutoSave()
    if (!chapter.status || chapter.status === 'outline') chapter.status = 'draft'
    currentChapter.value = chapter
    content.value = chapter.content || ''
  }

  async function selectChapter(chapter: WriterChapter): Promise<boolean> {
    const requestedVersion = ++selectionVersion
    if (!(await saveCurrentChapter())) return false
    if (requestedVersion !== selectionVersion || disposed) return false
    loadChapter(chapter)
    return true
  }

  async function initNovel(id: unknown): Promise<boolean> {
    const novelId = Number(typeof id === 'string' ? id : NaN)
    if (!Number.isSafeInteger(novelId) || novelId <= 0) {
      options.notifyError('缺少或无效的小说ID参数')
      return false
    }
    const requestedVersion = ++initializationVersion
    // Flush the old project before replacing any refs. On failure all editor
    // data stays available, allowing the route guard/caller to keep this page.
    if (currentNovel.value && !(await saveCurrentChapter())) return false
    if (requestedVersion !== initializationVersion || disposed) return false
    const storedNovel = persistence.load().find(novel => novel.id === novelId)
    if (!storedNovel) {
      options.notifyError('小说不存在')
      return false
    }
    const novel = clone(storedNovel)
    selectionVersion += 1
    cancelAutoSave()
    currentNovel.value = novel
    currentChapter.value = null
    content.value = ''
    characters.value = novel.characters || []
    options.novelStore.worldSettings = novel.worldSettings || []
    corpusData.value = novel.corpusData || []
    events.value = novel.events || []
    let migrated = false
    chapters.value = (novel.chapterList || []).map(chapter => {
      const status = !chapter.status || chapter.status === 'outline' ? 'draft' : chapter.status
      if (status !== chapter.status) migrated = true
      return {
        ...chapter,
        createdAt: chapter.createdAt ? new Date(chapter.createdAt) : undefined,
        updatedAt: chapter.updatedAt ? new Date(chapter.updatedAt) : undefined,
        status,
      }
    })
    if (chapters.value.length) loadChapter(chapters.value[0])
    hasUnsavedChanges.value = false
    saveError.value = null
    // All material categories and chapter refs are ready before migration writes.
    migrated = migrateEventChapters(events.value, chapters.value) || migrated
    if (migrated) return saveNovelData()
    return true
  }

  function onContentChange() {
    if (disposed || !currentChapter.value || content.value === (currentChapter.value.content || '')) return
    editVersion += 1
    hasUnsavedChanges.value = true
    cancelAutoSave()
    autoSaveTimer = setTimeout(() => { void autoSave() }, 2000)
  }

  function autoSave(): Promise<boolean> {
    return saveNovelData()
  }

  function dispose(): Promise<boolean> {
    disposed = true
    unregisterRetry()
    unloadTarget?.removeEventListener('beforeunload', warnBeforeUnload)
    initializationVersion += 1
    cancelAutoSave()
    // Capture synchronously before Vue tears down the editor; saveNovelData
    // reaches its first await only after copying refs into a detached snapshot.
    return saveCurrentChapter()
  }

  return {
    currentNovel, chapters, currentChapter, content, characters, worldSettings,
    corpusData, events, contentWordCount, hasUnsavedChanges, isSaving, saveError,
    saveNovelData, saveCurrentChapter, loadChapter, selectChapter, initNovel,
    onContentChange, autoSave, dispose,
  }
}
