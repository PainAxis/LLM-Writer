import { ref, type Ref } from 'vue'
import type { WriterChapter, WriterChapterForm, WriterNovel } from '@/types/writer'

interface WriterChapterCrudNotifications {
  success(message: string): void
  warning(message: string): void
}

interface UseWriterChapterCrudOptions {
  currentNovel: Readonly<Ref<WriterNovel | null>>
  chapters: Ref<WriterChapter[]>
  currentChapter: Ref<WriterChapter | null>
  content: Ref<string>
  persist(): Promise<boolean>
  selectChapter(chapter: WriterChapter): Promise<boolean>
  confirmDelete(chapter: WriterChapter): Promise<boolean>
  notify: WriterChapterCrudNotifications
  createId?: () => number
  now?: () => Date
}

const emptyChapterForm = (): WriterChapterForm => ({
  title: '',
  description: '',
  status: 'draft',
})

/**
 * Owns chapter metadata dialog state and persistence-safe CRUD operations.
 *
 * AI outline generation deliberately stays outside this composable. Failed
 * writes keep the form draft open, while optimistic list changes are rolled
 * back so the editor never exposes data that was not persisted.
 */
export function useWriterChapterCrud(options: UseWriterChapterCrudOptions) {
  const visible = ref(false)
  const form = ref<WriterChapterForm>(emptyChapterForm())
  const editingChapter = ref<WriterChapter | null>(null)
  let pendingCreateId: number | null = null

  const createId = options.createId ?? (() => Date.now())
  const now = options.now ?? (() => new Date())

  function openCreate(): void {
    editingChapter.value = null
    pendingCreateId = null
    form.value = emptyChapterForm()
    visible.value = true
  }

  function openEdit(chapter: WriterChapter): void {
    editingChapter.value = chapter
    pendingCreateId = null
    form.value = {
      title: chapter.title,
      description: chapter.description || '',
      status: chapter.status || 'draft',
    }
    visible.value = true
  }

  async function save(): Promise<boolean> {
    const title = form.value.title.trim()
    if (!title) {
      options.notify.warning('请输入章节标题')
      return false
    }

    const novelId = options.currentNovel.value?.id
    if (novelId == null) return false

    const list = options.chapters.value
    const selectedBefore = options.currentChapter.value
    const isNew = !editingChapter.value
    let index = editingChapter.value
      ? list.findIndex(chapter => chapter.id === editingChapter.value?.id)
      : -1
    const original = index >= 0 ? list[index] : null
    const timestamp = now()

    if (isNew && pendingCreateId == null) pendingCreateId = createId()

    const sourceChapter = original ?? editingChapter.value
    const candidate: WriterChapter = sourceChapter
      ? {
          ...sourceChapter,
          title,
          description: form.value.description,
          status: form.value.status,
          updatedAt: timestamp,
        }
      : {
          id: pendingCreateId!,
          title,
          description: form.value.description,
          content: '',
          wordCount: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
          status: form.value.status,
        }

    // A failed create may already exist after persistence succeeded but chapter
    // selection failed. Reuse that draft instead of appending a duplicate.
    if (index < 0) index = list.findIndex(chapter => chapter.id === candidate.id)
    const replaced = index >= 0 ? list[index] : null
    if (index >= 0) list[index] = candidate
    else {
      index = list.length
      list.push(candidate)
    }
    if (selectedBefore?.id === candidate.id) options.currentChapter.value = candidate

    let persisted = false
    try {
      persisted = await options.persist()
    } catch {
      persisted = false
    }

    if (!persisted) {
      if (replaced) list[index] = replaced
      else list.splice(index, 1)
      if (selectedBefore?.id === candidate.id) options.currentChapter.value = selectedBefore
      return false
    }
    if (options.currentNovel.value?.id !== novelId) return false

    if (isNew && !(await options.selectChapter(candidate))) return false

    editingChapter.value = candidate
    pendingCreateId = null
    visible.value = false
    options.notify.success(isNew ? '章节创建成功' : '章节信息已更新')
    return true
  }

  async function remove(chapter: WriterChapter): Promise<boolean> {
    const novelId = options.currentNovel.value?.id
    if (novelId == null || !(await options.confirmDelete(chapter))) return false
    if (options.currentNovel.value?.id !== novelId) return false

    const list = options.chapters.value
    const index = list.findIndex(item => item.id === chapter.id)
    if (index < 0) return false

    const selectedBefore = options.currentChapter.value
    const contentBefore = options.content.value
    const [removed] = list.splice(index, 1)
    if (selectedBefore?.id === chapter.id) {
      options.currentChapter.value = null
      options.content.value = ''
    }

    let persisted = false
    try {
      persisted = await options.persist()
    } catch {
      persisted = false
    }

    if (!persisted) {
      list.splice(index, 0, removed)
      options.currentChapter.value = selectedBefore
      options.content.value = contentBefore
      return false
    }
    if (options.currentNovel.value?.id !== novelId) return false

    if (!options.currentChapter.value && list.length && !(await options.selectChapter(list[0]))) {
      return false
    }
    options.notify.success('章节已删除')
    return true
  }

  return {
    visible,
    form,
    editingChapter,
    openCreate,
    openEdit,
    save,
    remove,
  }
}
