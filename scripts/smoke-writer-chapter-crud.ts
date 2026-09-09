import assert from 'node:assert/strict'
import { ref } from 'vue'
import { useWriterChapterCrud } from '../src/composables/useWriterChapterCrud'
import type { WriterChapter, WriterNovel } from '../src/types/writer'

function fixture() {
  const novel = ref<WriterNovel | null>({ id: 1, title: '测试小说' })
  const chapters = ref<WriterChapter[]>([
    { id: 1, title: '第一章', content: '原文', status: 'draft' },
    { id: 2, title: '第二章', content: '后文', status: 'draft' },
  ])
  const currentChapter = ref<WriterChapter | null>(chapters.value[0])
  const content = ref('原文')
  const messages: string[] = []
  const selected: number[] = []
  let persistenceResult = true
  let confirmResult = true

  const crud = useWriterChapterCrud({
    currentNovel: novel,
    chapters,
    currentChapter,
    content,
    persist: async () => persistenceResult,
    selectChapter: async chapter => {
      selected.push(chapter.id)
      currentChapter.value = chapter
      content.value = chapter.content || ''
      return true
    },
    confirmDelete: async () => confirmResult,
    notify: {
      success: message => messages.push(message),
      warning: message => messages.push(`warning:${message}`),
    },
    createId: () => 100,
    now: () => new Date('2026-01-02T03:04:05Z'),
  })

  return {
    novel,
    chapters,
    currentChapter,
    content,
    messages,
    selected,
    crud,
    setPersistenceResult(value: boolean) { persistenceResult = value },
    setConfirmResult(value: boolean) { confirmResult = value },
  }
}

async function main() {
  const create = fixture()
  create.crud.openCreate()
  create.crud.form.value.title = '新章节'
  create.crud.form.value.description = '新大纲'
  create.setPersistenceResult(false)
  assert.equal(await create.crud.save(), false)
  assert.equal(create.crud.visible.value, true)
  assert.equal(create.chapters.value.length, 2, '失败的新建不能在列表留下幽灵章节')
  assert.equal(create.crud.form.value.title, '新章节', '失败后保留表单草稿')
  create.setPersistenceResult(true)
  assert.equal(await create.crud.save(), true)
  assert.deepEqual(create.chapters.value.map(chapter => chapter.id), [1, 2, 100])
  assert.deepEqual(create.selected, [100])
  assert.deepEqual(create.messages, ['章节创建成功'])
  console.log('✓ 新建失败保留草稿且不遗留幽灵项，重试复用同一 ID')

  const edit = fixture()
  edit.crud.openEdit(edit.chapters.value[0])
  edit.crud.form.value.title = '改名'
  edit.setPersistenceResult(false)
  assert.equal(await edit.crud.save(), false)
  assert.equal(edit.chapters.value[0].title, '第一章')
  assert.equal(edit.currentChapter.value?.title, '第一章')
  assert.equal(edit.crud.form.value.title, '改名')
  edit.setPersistenceResult(true)
  assert.equal(await edit.crud.save(), true)
  assert.equal(edit.chapters.value[0].title, '改名')
  assert.equal(edit.currentChapter.value?.title, '改名')
  console.log('✓ 编辑失败回滚列表但保留草稿，重试后同步当前章节')

  const remove = fixture()
  remove.setPersistenceResult(false)
  assert.equal(await remove.crud.remove(remove.chapters.value[0]), false)
  assert.deepEqual(remove.chapters.value.map(chapter => chapter.id), [1, 2])
  assert.equal(remove.currentChapter.value?.id, 1)
  assert.equal(remove.content.value, '原文')
  remove.setPersistenceResult(true)
  assert.equal(await remove.crud.remove(remove.chapters.value[0]), true)
  assert.deepEqual(remove.chapters.value.map(chapter => chapter.id), [2])
  assert.equal(remove.currentChapter.value?.id, 2)
  assert.deepEqual(remove.selected, [2])
  console.log('✓ 删除失败完整回滚，成功删除当前章后选择剩余章节')

  const cancelled = fixture()
  cancelled.setConfirmResult(false)
  assert.equal(await cancelled.crud.remove(cancelled.chapters.value[0]), false)
  assert.equal(cancelled.chapters.value.length, 2)
  assert.deepEqual(cancelled.messages, [])
  console.log('✓ 取消确认不改变章节状态')

  console.log('\n=== WRITER CHAPTER CRUD TESTS PASSED ===')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
