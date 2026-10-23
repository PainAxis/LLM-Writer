import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'
import { useWriterChapterCrud } from '../src/composables/useWriterChapterCrud'
import { useWriterProject } from '../src/composables/useWriterProject'
import { useWriterGenerationArbiter } from '../src/composables/useWriterGenerationArbiter'
import type { WriterChapter, WriterEvent, WriterNovel } from '../src/types/writer'

function fixture() {
  const novel = ref<WriterNovel | null>({ id: 1, title: '测试小说' })
  const chapters = ref<WriterChapter[]>([
    { id: 1, title: '第一章', content: '原文', status: 'draft' },
    { id: 2, title: '第二章', content: '后文', status: 'draft' },
  ])
  const currentChapter = ref<WriterChapter | null>(chapters.value[0])
  const content = ref('原文')
  const events = ref<WriterEvent[]>([
    { id: 11, title: '删除目标章的事件', chapter: '1', extension: { retained: true } },
    { id: 12, title: '后继章节事件', chapter: 2 },
    { id: 13, title: '旧标题关联', chapter: '第二章' },
    { id: 14, title: '无法识别的旧值', chapter: '未知章节' },
  ])
  const messages: string[] = []
  const selected: number[] = []
  const attempted: Array<{ chapters: WriterChapter[]; events: WriterEvent[] }> = []
  let persistenceResult: boolean | 'throw' = true
  let confirmResult = true

  const crud = useWriterChapterCrud({
    currentNovel: novel,
    chapters,
    events,
    currentChapter,
    content,
    persist: async () => {
      attempted.push(JSON.parse(JSON.stringify({ chapters: chapters.value, events: events.value })))
      if (persistenceResult === 'throw') throw new Error('模拟持久化异常')
      return persistenceResult
    },
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
    events,
    attempted,
    messages,
    selected,
    crud,
    setPersistenceResult(value: boolean | 'throw') { persistenceResult = value },
    setConfirmResult(value: boolean) { confirmResult = value },
  }
}

const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve() }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

async function workspaceFixture(empty = false) {
  let disk: WriterNovel[] = [{ id: 1, title: '测试小说', chapterList: empty ? [] : [
    { id: 1, title: '第一章', content: '原文', status: 'draft' },
    { id: 2, title: '第二章', content: '后文', status: 'draft' },
  ] }]
  const writes: WriterNovel[][] = []
  const heldWrites = new Map<number, ReturnType<typeof deferred<void>>>()
  const project = useWriterProject({ novelStore: { worldSettings: [] }, notifyError() {}, beforeUnloadTarget: null,
    persistence: { load: () => JSON.parse(JSON.stringify(disk)), save: async value => {
      const snapshot = JSON.parse(JSON.stringify(value)) as WriterNovel[]
      writes.push(snapshot)
      await heldWrites.get(writes.length)?.promise
      disk = snapshot
    } },
  })
  await project.initNovel('1')
  const arbiter = useWriterGenerationArbiter({ checkApiReady: () => true, notifyBlocked() {} })
  const otherPending = ref(false)
  let otherWait: Promise<boolean> | null = null
  let confirmation: Promise<boolean> | null = null
  let afterPreflight: (() => void) | undefined
  let activeOwner = false
  arbiter.registerScope('otherGenerator', { reset: () => { activeOwner = false; return true } })
  arbiter.registerBarrier('otherCommit', { isPending: otherPending, wait: () => otherWait ?? true })
  const crud = useWriterChapterCrud({ ...project, persist: project.saveNovelData,
    beforeMutation: async () => { const ready = await arbiter.waitForCommits(); afterPreflight?.(); return ready },
    allowMutation: intent => project.canMutate(intent) && arbiter.resetAll()
      && !arbiter.hasPendingBarrier() && !arbiter.isWaitingForCommits() && project.allowMutation(intent),
    selectChapter: project.selectChapter, confirmDelete: () => confirmation ?? Promise.resolve(true),
    notify: { success() {}, warning() {} }, createId: () => 10,
  })
  arbiter.registerBarrier('chapterMutation', { isPending: crud.isMutating, wait: crud.waitForMutation })
  return { project, crud, arbiter, writes, disk: () => disk,
    holdWrite(index: number) { const hold = deferred<void>(); heldWrites.set(index, hold); return hold },
    holdOther() {
      const hold = deferred<boolean>(); otherPending.value = true; otherWait = hold.promise
      return (result = true) => { otherPending.value = false; hold.resolve(result); otherWait = null }
    },
    afterPreflight(callback: () => void) { afterPreflight = callback },
    holdConfirmation() { const hold = deferred<boolean>(); confirmation = hold.promise; return hold },
    claimLateOwner() { const claimed = arbiter.prepare('otherGenerator'); if (claimed) activeOwner = true; return claimed },
    ownerActive: () => activeOwner,
  }
}

async function testWorkspaceMutationBoundaries() {
  for (const action of ['create', 'delete_current'] as const) {
    const f = await workspaceFixture(action === 'create')
    const selectionWrite = f.holdWrite(2)
    f.crud.openCreate()
    f.crud.form.value.title = '第一章：约定'
    f.crud.form.value.description = '林遥交出银钥匙并约定重逢。'
    let result: boolean | 'pending' = 'pending'
    const mutation = action === 'create' ? f.crud.save() : f.crud.remove(f.project.currentChapter.value!)
    void mutation.then(value => { result = value })
    await flush()
    assert.equal(f.writes.length, 2, `${action}: internal selection reaches the real project save, never its own barrier`)
    assert.equal(f.crud.isMutating.value, true)
    assert.equal(f.arbiter.prepare('writerAgent'), false, 'Agent cannot start while internal chapter selection is held')
    let navigated = false
    const navigation = f.arbiter.waitForCommits().then(value => { navigated = value; return value })
    await flush()
    assert.equal(navigated, false)
    selectionWrite.resolve()
    await flush()
    assert.equal(result, true)
    assert.equal(await mutation, true)
    assert.equal(await navigation, true, 'external navigation still waits for the complete CRUD selection')
    assert.equal(f.crud.isMutating.value, false)
    assert.equal(f.project.currentChapter.value?.id, action === 'create' ? 10 : 2)
    assert.equal(f.crud.visible.value, action === 'create' ? false : true)
    assert.deepEqual(f.disk()[0].chapterList!.map(chapter => chapter.id), [action === 'create' ? 10 : 2])
    f.arbiter.dispose()
  }
  console.log('✓ real Project/CRUD/arbiter create and delete-fallback complete without self-wait; held selection still blocks Agent and navigation')

  for (const succeeds of [true, false]) {
    const f = await workspaceFixture(true)
    const releaseOther = f.holdOther()
    const earlierNavigation = f.arbiter.waitForCommits()
    f.crud.openCreate(); f.crud.form.value.title = '等待其他提交的新章'
    let result: boolean | 'pending' = 'pending'
    const mutation = f.crud.save().then(value => { result = value; return value })
    await flush()
    assert.equal(f.writes.length, 0)
    assert.equal(f.crud.isMutating.value, false, 'preflight cannot publish a barrier awaited by an earlier activeWait')
    releaseOther(succeeds)
    await flush()
    assert.equal(await earlierNavigation, succeeds)
    assert.equal(result, succeeds)
    assert.equal(await mutation, succeeds)
    assert.equal(f.writes.length, succeeds ? 2 : 0)
    assert.equal(f.crud.visible.value, !succeeds)
    f.arbiter.dispose()
  }
  console.log('✓ an already-active workspace wait is shared before CRUD begins; another owner failure prevents all mutation')

  const late = await workspaceFixture(true)
  let claimedInGap = false
  late.afterPreflight(() => queueMicrotask(() => { claimedInGap = late.claimLateOwner() }))
  const lateWrite = late.holdWrite(1)
  late.crud.openCreate(); late.crud.form.value.title = '同步撤销新owner'
  const lateMutation = late.crud.save()
  await flush()
  assert.equal(claimedInGap, true, 'fixture injects a real owner in the preflight resolution microtask gap')
  assert.equal(late.ownerActive(), false, 'the final synchronous claim revokes the new cancellable owner before mutation')
  assert.equal(late.crud.isMutating.value, true)
  assert.equal(late.arbiter.prepare('writerAgent'), false)
  lateWrite.resolve()
  assert.equal(await lateMutation, true)
  late.arbiter.dispose()
  console.log('✓ final synchronous claim closes the preflight-to-mutation microtask gap')

  for (const change of ['cancel', 'new_dialog', 'edit_dialog', 'form', 'chapter', 'lease'] as const) {
    const f = await workspaceFixture()
    const releaseOther = f.holdOther()
    f.crud.openCreate(); f.crud.form.value.title = '旧保存意图'
    const mutation = f.crud.save()
    await flush()
    if (change === 'cancel') f.crud.visible.value = false
    if (change === 'new_dialog') { f.crud.openCreate(); f.crud.form.value.title = '新弹窗草稿' }
    if (change === 'edit_dialog') f.crud.openEdit(f.project.chapters.value[1])
    if (change === 'form') f.crud.form.value.title = '等待期间新草稿'
    if (change === 'chapter') f.project.loadChapter(f.project.chapters.value[1])
    if (change === 'lease') { const lease = f.project.acquireApplyLease()!; assert.ok(lease); lease.releaseBeforeMutation() }
    releaseOther()
    assert.equal(await mutation, false, `${change}: stale preflight cannot commit another dialog or target`)
    assert.equal(f.writes.length, 0)
    assert.equal(f.project.chapters.value.length, 2)
    f.arbiter.dispose()
  }
  console.log('✓ preflight retains dialog/form/chapter and mutation intents; cancel, replacement and temporary leases revoke old saves')

  const pure = await workspaceFixture()
  const pureIntent = pure.project.captureMutationIntent()
  assert.equal(pure.project.canMutate(pureIntent), true)
  assert.equal(pure.project.canMutate(pureIntent), true)
  assert.equal(pure.project.allowMutation(pureIntent), true, 'pure checks cannot consume the captured mutation epoch')
  assert.equal(pure.project.canMutate(pureIntent), false, 'only the real claim advances the mutation epoch')
  const confirmation = pure.holdConfirmation()
  const lateDelete = pure.crud.remove(pure.project.chapters.value[0])
  const applyLease = pure.project.acquireApplyLease()!
  assert.ok(applyLease)
  let revokedAgent = 0
  pure.arbiter.registerScope('writerAgent', { reset: () => { revokedAgent++; applyLease.releaseBeforeMutation(); return true },
    revokeBeforeWait: () => { revokedAgent++; applyLease.releaseBeforeMutation(); return true } })
  assert.equal(pure.project.canMutate(), false)
  assert.equal(pure.project.canMutate(), false)
  assert.equal(applyLease.valid, true, 'pure checks cannot revoke a live apply lease')
  confirmation.resolve(true)
  assert.equal(await lateDelete, false)
  assert.equal(revokedAgent, 0, 'late delete confirmation is rejected BEFORE preflight can revoke the newer Agent')
  assert.equal(applyLease.valid, true)
  pure.crud.openCreate(); pure.crud.form.value.title = 'Agent保护期间的旧保存'
  assert.equal(await pure.crud.save(), false)
  assert.equal(revokedAgent, 0)
  assert.equal(applyLease.valid, true)
  assert.equal(pure.writes.length, 0)
  applyLease.releaseBeforeMutation()
  pure.arbiter.dispose()
  console.log('✓ pure intent checks preserve epochs and leases; late delete/save cannot revoke a newer pre-apply Agent')

  const resetRace = await workspaceFixture(true)
  let releaseResetBarrier: (() => void) | undefined
  resetRace.arbiter.registerScope('resetRace', { reset: () => { releaseResetBarrier = resetRace.holdOther(); return true } })
  resetRace.crud.openCreate(); resetRace.crud.form.value.title = '同步reset启动了其他提交'
  assert.equal(await resetRace.crud.save(), false)
  assert.equal(resetRace.writes.length, 0)
  assert.equal(resetRace.crud.isMutating.value, false)
  releaseResetBarrier!()
  resetRace.arbiter.dispose()
  console.log('✓ a barrier started synchronously by scope reset is rechecked before the CRUD claim')

  const writer = readFileSync(new URL('../src/views/Writer.vue', import.meta.url), 'utf8')
  const wiring = writer.slice(writer.indexOf('const chapterCrud ='), writer.indexOf('const showChapterDialog ='))
  assert.match(wiring, /beforeMutation: generationArbiter\.waitForCommits/)
  assert.match(wiring, /allowMutation: intent => canMutate\(intent\) && generationArbiter\.resetAll\(\)[\s\S]*!generationArbiter\.hasPendingBarrier\(\)[\s\S]*!generationArbiter\.isWaitingForCommits\(\)[\s\S]*&& allowMutation\(intent\)/)
  assert.match(wiring, /selectChapter: selectProjectChapter/)
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
  assert.deepEqual(remove.events.value.map(event => event.chapter), ['1', 2, '第二章', '未知章节'], '失败必须恢复事件和章节的原关联')
  assert.deepEqual(remove.attempted[0].chapters.map(chapter => chapter.id), [2])
  assert.deepEqual(remove.attempted[0].events.map(event => event.chapter), ['', 1, '1', '未知章节'], '持久化必须同时看到新章节和新事件关联')
  remove.setPersistenceResult(true)
  assert.equal(await remove.crud.remove(remove.chapters.value[0]), true)
  assert.deepEqual(remove.chapters.value.map(chapter => chapter.id), [2])
  assert.equal(remove.currentChapter.value?.id, 2)
  assert.deepEqual(remove.selected, [2])
  assert.deepEqual(remove.events.value.map(event => event.chapter), ['', 1, '1', '未知章节'])
  assert.deepEqual(remove.events.value[0].extension, { retained: true })
  assert.deepEqual(remove.attempted[1], remove.attempted[0], '删除重试不能二次偏移章号或丢掉事件')
  console.log('✓ 删除失败完整回滚，成功删除当前章后选择剩余章节')

  const thrown = fixture()
  const originalEvents = JSON.stringify(thrown.events.value)
  thrown.setPersistenceResult('throw')
  assert.equal(await thrown.crud.remove(thrown.chapters.value[1]), false)
  assert.deepEqual(thrown.chapters.value.map(chapter => chapter.id), [1, 2])
  assert.equal(JSON.stringify(thrown.events.value), originalEvents, '抛错时也须完整回滚事件和扩展字段')
  thrown.setPersistenceResult(true)
  assert.equal(await thrown.crud.remove(thrown.chapters.value[1]), true)
  assert.deepEqual(thrown.events.value.map(event => event.chapter), ['1', '', '', '未知章节'], '删除非当前章节也清理目标关联，保留未变章节')
  assert.equal(thrown.currentChapter.value?.id, 1)
  assert.deepEqual(thrown.attempted[1], thrown.attempted[0])
  console.log('✓ 删除非当前章抛错可重试，目标关联清空、保留章节关联不变')

  const cancelled = fixture()
  cancelled.setConfirmResult(false)
  assert.equal(await cancelled.crud.remove(cancelled.chapters.value[0]), false)
  assert.equal(cancelled.chapters.value.length, 2)
  assert.deepEqual(cancelled.messages, [])
  console.log('✓ 取消确认不改变章节状态')

  await testWorkspaceMutationBoundaries()

  console.log('\n=== WRITER CHAPTER CRUD TESTS PASSED ===')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
