import { computed, ref, watch, type Ref } from 'vue'
import type {
  WriterChapter,
  WriterCharacter,
  WriterCharacterForm,
  WriterCorpusForm,
  WriterCorpusItem,
  WriterEvent,
  WriterEventForm,
  WriterNovel,
  WriterWorldSetting,
  WriterWorldSettingForm,
} from '@/types/writer'
import { generateUniqueId } from '@/utils/id'

export type WriterMaterialKind = 'character' | 'worldSetting' | 'corpus' | 'event'

export interface WriterMaterialDeleteRequest {
  kind: WriterMaterialKind
  itemId: number
  itemTitle: string
  title: string
  message: string
}

interface WriterNovelContext {
  novel: WriterNovel
  novelId: number
  epoch: number
}

interface WriterMaterialNotifications {
  success(message: string): unknown
  warning(message: string): unknown
}

interface WriterMaterialCrudOptions {
  currentNovel: Readonly<Ref<WriterNovel | null>>
  chapters: Readonly<Ref<WriterChapter[]>>
  currentChapter: Readonly<Ref<WriterChapter | null>>
  characters: Ref<WriterCharacter[]>
  worldSettings: Readonly<Ref<WriterWorldSetting[]>>
  corpusData: Ref<WriterCorpusItem[]>
  events: Ref<WriterEvent[]>
  saveNovelData: () => Promise<boolean>
  confirmDelete: (request: WriterMaterialDeleteRequest) => Promise<boolean>
  notify: WriterMaterialNotifications
  createId?: () => number
  now?: () => Date
}

const createCharacterForm = (): WriterCharacterForm => ({
  id: null,
  name: '',
  role: 'supporting',
  gender: 'male',
  age: 25,
  appearance: '',
  personality: '',
  background: '',
  tags: [],
  avatar: '',
})

const createWorldForm = (): WriterWorldSettingForm => ({
  id: null,
  title: '',
  description: '',
  category: 'setting',
  details: '',
})

const createCorpusForm = (): WriterCorpusForm => ({
  id: null,
  title: '',
  type: 'description',
  category: '',
  content: '',
  tags: [],
})

const createEventForm = (): WriterEventForm => ({
  id: null,
  title: '',
  description: '',
  chapter: '',
  characterIds: [],
  time: '',
  importance: 'normal',
})

/**
 * Character/world/corpus/event dialog state and non-AI CRUD operations.
 *
 * Forms are deliberately kept outside the project arrays until persistence
 * succeeds. Mutations use a short optimistic transaction so saveNovelData can
 * serialize the candidate, then roll back the visible list on failure. The
 * form and dialog remain intact, making the same draft safe to retry.
 */
export function useWriterMaterialCrud(options: WriterMaterialCrudOptions) {
  const showCharacterDialog = ref(false)
  const showWorldDialog = ref(false)
  const showCorpusDialog = ref(false)
  const showEventDialog = ref(false)

  const characterForm = ref<WriterCharacterForm>(createCharacterForm())
  const worldForm = ref<WriterWorldSettingForm>(createWorldForm())
  const corpusForm = ref<WriterCorpusForm>(createCorpusForm())
  const eventForm = ref<WriterEventForm>(createEventForm())

  const editingCharacter = ref<WriterCharacter | null>(null)
  const editingWorldSetting = ref<WriterWorldSetting | null>(null)
  const editingCorpus = ref<WriterCorpusItem | null>(null)
  const editingEvent = ref<WriterEvent | null>(null)

  const isMutatingCharacter = ref(false)
  const isMutatingWorldSetting = ref(false)
  const isMutatingCorpus = ref(false)
  const isMutatingEvent = ref(false)
  let pendingMutation: Promise<boolean> | null = null

  let novelEpoch = 0
  let characterNovelContext: WriterNovelContext | null = null
  let worldNovelContext: WriterNovelContext | null = null
  let corpusNovelContext: WriterNovelContext | null = null
  let eventNovelContext: WriterNovelContext | null = null

  watch(options.currentNovel, (novel, previousNovel) => {
    if (novel === previousNovel) return
    novelEpoch += 1
    characterNovelContext = null
    worldNovelContext = null
    corpusNovelContext = null
    eventNovelContext = null
    editingCharacter.value = null
    editingWorldSetting.value = null
    editingCorpus.value = null
    editingEvent.value = null
    showCharacterDialog.value = false
    showWorldDialog.value = false
    showCorpusDialog.value = false
    showEventDialog.value = false
  }, { flush: 'sync' })

  const captureNovelContext = (): WriterNovelContext | null => {
    const novel = options.currentNovel.value
    return novel ? { novel, novelId: novel.id, epoch: novelEpoch } : null
  }
  const isCurrentNovel = (context: WriterNovelContext | null) => Boolean(
    context
    && context.epoch === novelEpoch
    && options.currentNovel.value === context.novel
    && options.currentNovel.value.id === context.novelId,
  )
  const isAnyMaterialMutation = () => (
    isMutatingCharacter.value
    || isMutatingWorldSetting.value
    || isMutatingCorpus.value
    || isMutatingEvent.value
  )
  const isMutating = computed(isAnyMaterialMutation)
  const now = () => options.now?.() ?? new Date()

  const allocateId = (items: Array<{ id: number }>) => {
    let id = (options.createId ?? generateUniqueId)()
    while (items.some(item => item.id === id)) id += 1
    return id
  }

  const performPersistence = async (context: WriterNovelContext, rollback: () => void) => {
    let saved: boolean
    try {
      saved = await options.saveNovelData()
    } catch {
      rollback()
      return false
    }
    if (!saved) {
      rollback()
      return false
    }
    // A successful save belongs to the exact project instance that launched
    // it. Returning to the same ID (or even the same object) after navigating
    // away must not close a newly opened dialog or emit a stale notification.
    return isCurrentNovel(context)
  }

  const persistMutation = (context: WriterNovelContext, rollback: () => void) => {
    const request = performPersistence(context, rollback)
    pendingMutation = request
    void request.then(
      () => { if (pendingMutation === request) pendingMutation = null },
      () => { if (pendingMutation === request) pendingMutation = null },
    )
    return request
  }

  const waitForMutation = () => pendingMutation ?? Promise.resolve(true)

  const addCharacter = () => {
    editingCharacter.value = null
    characterForm.value = createCharacterForm()
    characterNovelContext = captureNovelContext()
    showCharacterDialog.value = true
  }

  const editCharacter = (character: WriterCharacter) => {
    editingCharacter.value = character
    characterForm.value = {
      ...createCharacterForm(),
      ...character,
      id: character.id,
      // The tag editor mutates its array in place. Do not leak those edits
      // into the list when the user cancels the dialog.
      tags: [...(character.tags ?? [])],
      age: (character.age ?? 25) as number,
    }
    characterNovelContext = captureNovelContext()
    showCharacterDialog.value = true
  }

  const saveCharacter = async () => {
    if (!characterForm.value.name.trim()) {
      options.notify.warning('请输入角色姓名')
      return false
    }
    const context = characterNovelContext
    if (!context || !isCurrentNovel(context) || isAnyMaterialMutation()) return false
    isMutatingCharacter.value = true
    try {
      const collection = options.characters.value
      const editing = editingCharacter.value
      const isNew = editing === null
      const targetId = isNew
        ? (characterForm.value.id ?? allocateId(collection))
        : editing.id
      if (isNew && characterForm.value.id === null) characterForm.value.id = targetId
      if (isNew && !characterForm.value.createdAt) characterForm.value.createdAt = now()
      const candidate: WriterCharacter = {
        ...characterForm.value,
        id: targetId,
        tags: [...characterForm.value.tags],
      }
      if (!isCurrentNovel(context)) return false
      const index = collection.findIndex(item => item.id === targetId)
      if (!isNew && index < 0) return false
      const previous = index > -1 ? collection[index] : null
      if (index > -1) collection.splice(index, 1, candidate)
      else collection.push(candidate)
      const optimistic = collection[index > -1 ? index : collection.length - 1]
      const rollback = () => {
        const candidateIndex = collection.findIndex(item => item === optimistic)
        if (candidateIndex < 0) return
        if (previous) collection.splice(candidateIndex, 1, previous)
        else collection.splice(candidateIndex, 1)
      }
      if (!(await persistMutation(context, rollback))) return false
      options.notify.success(isNew ? '角色创建成功' : '角色信息已更新')
      editingCharacter.value = null
      showCharacterDialog.value = false
      return true
    } finally {
      isMutatingCharacter.value = false
    }
  }

  const deleteCharacter = async (character: WriterCharacter) => {
    const context = captureNovelContext()
    if (!context || !isCurrentNovel(context) || isAnyMaterialMutation()) return false
    let confirmed = false
    try {
      confirmed = await options.confirmDelete({
        kind: 'character', itemId: character.id, itemTitle: character.name,
        title: '确认删除', message: `确定要删除角色《${character.name}》吗？`,
      })
    } catch {
      return false
    }
    // Confirmation yields control; another resource may have started a full
    // project save while the modal was open, so acquire the global lock again.
    if (!confirmed || !isCurrentNovel(context) || isAnyMaterialMutation()) return false
    isMutatingCharacter.value = true
    try {
      const collection = options.characters.value
      const index = collection.findIndex(item => item.id === character.id)
      if (index < 0) return false
      const [removed] = collection.splice(index, 1)
      const rollback = () => {
        if (!collection.some(item => item.id === removed.id)) {
          collection.splice(Math.min(index, collection.length), 0, removed)
        }
      }
      if (!(await persistMutation(context, rollback))) return false
      options.notify.success('角色已删除')
      return true
    } finally {
      isMutatingCharacter.value = false
    }
  }

  const importGeneratedCharacters = async (items: readonly WriterCharacter[]) => {
    const context = captureNovelContext()
    if (!context || !isCurrentNovel(context) || isAnyMaterialMutation()) return false
    if (items.length === 0) return true

    isMutatingCharacter.value = true
    try {
      const collection = options.characters.value
      const reservedIds = new Set(collection.map(item => item.id))
      const candidates: WriterCharacter[] = items.map((item) => {
        let id = item.id
        if (reservedIds.has(id)) {
          id = (options.createId ?? generateUniqueId)()
          while (reservedIds.has(id)) id += 1
        }
        reservedIds.add(id)
        return { ...item, id, tags: [...(item.tags ?? [])] }
      })
      if (!isCurrentNovel(context)) return false
      collection.push(...candidates)
      const imported = new Set(collection.slice(-candidates.length))
      const rollback = () => {
        for (let index = collection.length - 1; index >= 0; index -= 1) {
          if (imported.has(collection[index])) collection.splice(index, 1)
        }
      }
      return persistMutation(context, rollback)
    } finally {
      isMutatingCharacter.value = false
    }
  }

  const addWorldSetting = () => {
    editingWorldSetting.value = null
    worldForm.value = createWorldForm()
    worldNovelContext = captureNovelContext()
    showWorldDialog.value = true
  }

  const editWorldSetting = (setting: WriterWorldSetting) => {
    editingWorldSetting.value = setting
    worldForm.value = {
      ...createWorldForm(),
      ...setting,
      id: setting.id,
      category: setting.category ?? 'setting',
    }
    worldNovelContext = captureNovelContext()
    showWorldDialog.value = true
  }

  const saveWorldSetting = async () => {
    if (!worldForm.value.title.trim()) {
      options.notify.warning('请输入设定标题')
      return false
    }
    const context = worldNovelContext
    if (!context || !isCurrentNovel(context) || isAnyMaterialMutation()) return false
    isMutatingWorldSetting.value = true
    try {
      const collection = options.worldSettings.value
      const editing = editingWorldSetting.value
      const isNew = editing === null
      const targetId = isNew
        ? (worldForm.value.id ?? allocateId(collection))
        : editing.id
      if (isNew && worldForm.value.id === null) worldForm.value.id = targetId
      if (isNew && !worldForm.value.createdAt) worldForm.value.createdAt = now()
      const candidate: WriterWorldSetting = { ...worldForm.value, id: targetId }
      if (!isCurrentNovel(context)) return false
      const index = collection.findIndex(item => item.id === targetId)
      if (!isNew && index < 0) return false
      const previous = index > -1 ? collection[index] : null
      if (index > -1) collection.splice(index, 1, candidate)
      else collection.push(candidate)
      const optimistic = collection[index > -1 ? index : collection.length - 1]
      const rollback = () => {
        const candidateIndex = collection.findIndex(item => item === optimistic)
        if (candidateIndex < 0) return
        if (previous) collection.splice(candidateIndex, 1, previous)
        else collection.splice(candidateIndex, 1)
      }
      if (!(await persistMutation(context, rollback))) return false
      options.notify.success(isNew ? '设定创建成功' : '设定信息已更新')
      editingWorldSetting.value = null
      showWorldDialog.value = false
      return true
    } finally {
      isMutatingWorldSetting.value = false
    }
  }

  const deleteWorldSetting = async (setting: WriterWorldSetting) => {
    const context = captureNovelContext()
    if (!context || !isCurrentNovel(context) || isAnyMaterialMutation()) return false
    let confirmed = false
    try {
      confirmed = await options.confirmDelete({
        kind: 'worldSetting', itemId: setting.id, itemTitle: setting.title,
        title: '确认删除', message: `确定要删除设定《${setting.title}》吗？`,
      })
    } catch {
      return false
    }
    if (!confirmed || !isCurrentNovel(context) || isAnyMaterialMutation()) return false
    isMutatingWorldSetting.value = true
    try {
      const collection = options.worldSettings.value
      const index = collection.findIndex(item => item.id === setting.id)
      if (index < 0) return false
      const [removed] = collection.splice(index, 1)
      const rollback = () => {
        if (!collection.some(item => item.id === removed.id)) {
          collection.splice(Math.min(index, collection.length), 0, removed)
        }
      }
      if (!(await persistMutation(context, rollback))) return false
      options.notify.success('设定已删除')
      return true
    } finally {
      isMutatingWorldSetting.value = false
    }
  }

  const duplicateWorldSetting = async (setting: WriterWorldSetting) => {
    const context = captureNovelContext()
    if (!context || !isCurrentNovel(context) || isAnyMaterialMutation()) return false
    isMutatingWorldSetting.value = true
    try {
      const collection = options.worldSettings.value
      const candidate: WriterWorldSetting = {
        ...setting,
        id: allocateId(collection),
        title: `${setting.title} (副本)`,
        createdAt: now(),
        generated: false,
      }
      if (!isCurrentNovel(context)) return false
      collection.push(candidate)
      const optimistic = collection[collection.length - 1]
      const rollback = () => {
        const index = collection.findIndex(item => item === optimistic)
        if (index > -1) collection.splice(index, 1)
      }
      if (!(await persistMutation(context, rollback))) return false
      options.notify.success('设定已复制')
      return true
    } finally {
      isMutatingWorldSetting.value = false
    }
  }

  const importGeneratedWorldSettings = async (items: readonly WriterWorldSetting[]) => {
    const context = captureNovelContext()
    if (!context || !isCurrentNovel(context) || isAnyMaterialMutation()) return false
    if (items.length === 0) return true

    isMutatingWorldSetting.value = true
    try {
      const collection = options.worldSettings.value
      const reservedIds = new Set(collection.map(item => item.id))
      const candidates: WriterWorldSetting[] = items.map((item) => {
        let id = item.id
        if (reservedIds.has(id)) {
          id = (options.createId ?? generateUniqueId)()
          while (reservedIds.has(id)) id += 1
        }
        reservedIds.add(id)
        return { ...item, id }
      })
      if (!isCurrentNovel(context)) return false
      collection.push(...candidates)
      const imported = new Set(collection.slice(-candidates.length))
      const rollback = () => {
        for (let index = collection.length - 1; index >= 0; index -= 1) {
          if (imported.has(collection[index])) collection.splice(index, 1)
        }
      }
      return persistMutation(context, rollback)
    } finally {
      isMutatingWorldSetting.value = false
    }
  }

  const addCorpus = () => {
    editingCorpus.value = null
    corpusForm.value = createCorpusForm()
    corpusNovelContext = captureNovelContext()
    showCorpusDialog.value = true
  }

  const editCorpus = (corpus: WriterCorpusItem) => {
    editingCorpus.value = corpus
    corpusForm.value = {
      ...createCorpusForm(),
      ...corpus,
      id: corpus.id,
      tags: [...(corpus.tags ?? [])],
    }
    corpusNovelContext = captureNovelContext()
    showCorpusDialog.value = true
  }

  const saveCorpus = async () => {
    if (!corpusForm.value.title.trim()) {
      options.notify.warning('请输入语料标题')
      return false
    }
    const context = corpusNovelContext
    if (!context || !isCurrentNovel(context) || isAnyMaterialMutation()) return false
    isMutatingCorpus.value = true
    try {
      const collection = options.corpusData.value
      const editing = editingCorpus.value
      const isNew = editing === null
      const targetId = isNew
        ? (corpusForm.value.id ?? allocateId(collection))
        : editing.id
      if (isNew && corpusForm.value.id === null) corpusForm.value.id = targetId
      if (isNew && !corpusForm.value.createdAt) corpusForm.value.createdAt = now()
      const candidate: WriterCorpusItem = {
        ...corpusForm.value,
        id: targetId,
        tags: [...corpusForm.value.tags],
      }
      if (!isCurrentNovel(context)) return false
      const index = collection.findIndex(item => item.id === targetId)
      if (!isNew && index < 0) return false
      const previous = index > -1 ? collection[index] : null
      if (index > -1) collection.splice(index, 1, candidate)
      else collection.push(candidate)
      const optimistic = collection[index > -1 ? index : collection.length - 1]
      const rollback = () => {
        const candidateIndex = collection.findIndex(item => item === optimistic)
        if (candidateIndex < 0) return
        if (previous) collection.splice(candidateIndex, 1, previous)
        else collection.splice(candidateIndex, 1)
      }
      if (!(await persistMutation(context, rollback))) return false
      options.notify.success(isNew ? '语料创建成功' : '语料信息已更新')
      editingCorpus.value = null
      showCorpusDialog.value = false
      return true
    } finally {
      isMutatingCorpus.value = false
    }
  }

  const deleteCorpus = async (corpus: WriterCorpusItem) => {
    const context = captureNovelContext()
    if (!context || !isCurrentNovel(context) || isAnyMaterialMutation()) return false
    let confirmed = false
    try {
      confirmed = await options.confirmDelete({
        kind: 'corpus', itemId: corpus.id, itemTitle: corpus.title ?? '',
        title: '确认删除', message: `确定要删除语料《${corpus.title ?? ''}》吗？`,
      })
    } catch {
      return false
    }
    if (!confirmed || !isCurrentNovel(context) || isAnyMaterialMutation()) return false
    isMutatingCorpus.value = true
    try {
      const collection = options.corpusData.value
      const index = collection.findIndex(item => item.id === corpus.id)
      if (index < 0) return false
      const [removed] = collection.splice(index, 1)
      const rollback = () => {
        if (!collection.some(item => item.id === removed.id)) {
          collection.splice(Math.min(index, collection.length), 0, removed)
        }
      }
      if (!(await persistMutation(context, rollback))) return false
      options.notify.success('语料已删除')
      return true
    } finally {
      isMutatingCorpus.value = false
    }
  }

  const addEvent = () => {
    const currentIndex = options.chapters.value.findIndex(
      chapter => chapter.id === options.currentChapter.value?.id,
    )
    editingEvent.value = null
    eventForm.value = {
      ...createEventForm(),
      chapter: currentIndex > -1 ? String(currentIndex + 1) : '',
      time: now().toISOString().slice(0, 16),
    }
    eventNovelContext = captureNovelContext()
    showEventDialog.value = true
  }

  const editEvent = (event: WriterEvent) => {
    editingEvent.value = event
    eventForm.value = {
      ...createEventForm(),
      ...event,
      id: event.id,
      chapter: event.chapter === undefined ? '' : String(event.chapter),
      characterIds: [...(event.characterIds ?? [])],
    }
    eventNovelContext = captureNovelContext()
    showEventDialog.value = true
  }

  const saveEvent = async () => {
    if (!eventForm.value.title.trim()) {
      options.notify.warning('请输入事件标题')
      return false
    }
    const context = eventNovelContext
    if (!context || !isCurrentNovel(context) || isAnyMaterialMutation()) return false
    isMutatingEvent.value = true
    try {
      const collection = options.events.value
      const editing = editingEvent.value
      const isNew = editing === null
      const targetId = isNew
        ? (eventForm.value.id ?? allocateId(collection))
        : editing.id
      if (isNew && eventForm.value.id === null) eventForm.value.id = targetId
      if (isNew && !eventForm.value.createdAt) eventForm.value.createdAt = now()
      const candidate: WriterEvent = {
        ...eventForm.value,
        id: targetId,
        characterIds: [...eventForm.value.characterIds],
      }
      if (!isCurrentNovel(context)) return false
      const index = collection.findIndex(item => item.id === targetId)
      if (!isNew && index < 0) return false
      const previous = index > -1 ? collection[index] : null
      if (index > -1) collection.splice(index, 1, candidate)
      else collection.push(candidate)
      const optimistic = collection[index > -1 ? index : collection.length - 1]
      const rollback = () => {
        const candidateIndex = collection.findIndex(item => item === optimistic)
        if (candidateIndex < 0) return
        if (previous) collection.splice(candidateIndex, 1, previous)
        else collection.splice(candidateIndex, 1)
      }
      if (!(await persistMutation(context, rollback))) return false
      options.notify.success(isNew ? '事件创建成功' : '事件信息已更新')
      editingEvent.value = null
      showEventDialog.value = false
      return true
    } finally {
      isMutatingEvent.value = false
    }
  }

  const deleteEvent = async (event: WriterEvent) => {
    const context = captureNovelContext()
    if (!context || !isCurrentNovel(context) || isAnyMaterialMutation()) return false
    let confirmed = false
    try {
      confirmed = await options.confirmDelete({
        kind: 'event', itemId: event.id, itemTitle: event.title,
        title: '确认删除', message: `确定要删除事件《${event.title}》吗？`,
      })
    } catch {
      return false
    }
    if (!confirmed || !isCurrentNovel(context) || isAnyMaterialMutation()) return false
    isMutatingEvent.value = true
    try {
      const collection = options.events.value
      const index = collection.findIndex(item => item.id === event.id)
      if (index < 0) return false
      const [removed] = collection.splice(index, 1)
      const rollback = () => {
        if (!collection.some(item => item.id === removed.id)) {
          collection.splice(Math.min(index, collection.length), 0, removed)
        }
      }
      if (!(await persistMutation(context, rollback))) return false
      options.notify.success('事件已删除')
      return true
    } finally {
      isMutatingEvent.value = false
    }
  }

  return {
    showCharacterDialog, showWorldDialog, showCorpusDialog, showEventDialog,
    characterForm, worldForm, corpusForm, eventForm,
    editingCharacter, editingWorldSetting, editingCorpus, editingEvent,
    isMutating, isMutatingCharacter, isMutatingWorldSetting, isMutatingCorpus, isMutatingEvent,
    waitForMutation,
    addCharacter, editCharacter, saveCharacter, deleteCharacter, importGeneratedCharacters,
    addWorldSetting, editWorldSetting, saveWorldSetting, deleteWorldSetting, duplicateWorldSetting,
    importGeneratedWorldSettings,
    addCorpus, editCorpus, saveCorpus, deleteCorpus,
    addEvent, editEvent, saveEvent, deleteEvent,
  }
}
