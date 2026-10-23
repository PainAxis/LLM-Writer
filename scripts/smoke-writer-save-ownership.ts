import assert from 'node:assert/strict'
import { useWriterProject, type WriterNovel } from '../src/composables/useWriterProject'
import type { StorageSetOptions } from '../src/utils/storage'
import { createWriterPersistenceGate } from '../src/composables/writerPersistenceGate'
import { useWriterChapterCrud } from '../src/composables/useWriterChapterCrud'
import { useWriterMaterialCrud } from '../src/composables/useWriterMaterialCrud'
import { useWriterGenerationArbiter } from '../src/composables/useWriterGenerationArbiter'
import { ref, watch } from 'vue'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const seed = (): WriterNovel[] => [{ id: 1, title: '甲', chapterList: [{ id: 10, title: '一', status: 'draft', content: '原文' }, { id: 11, title: '二', status: 'draft', content: '次章' }] }]
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function fixture() {
  let disk = seed()
  const pending: Array<{ novels: WriterNovel[]; options?: StorageSetOptions; done: ReturnType<typeof deferred<void>> }> = []
  const errors: string[] = []
  const project = useWriterProject({ novelStore: { worldSettings: [] }, notifyError: message => errors.push(message), beforeUnloadTarget: null,
    persistence: { rejectsBeforeCommit: true, load: () => clone(disk), save: (novels, options) => {
      const done = deferred<void>()
      pending.push({ novels: clone(novels), options, done })
      return done.promise
    } },
  })
  assert.equal(await project.initNovel('1'), true)
  return { project, pending, errors, commit(index: number, acknowledge = true) {
    disk = clone(pending[index].novels)
    pending[index].options?.onCommit?.({ committed: true })
    if (acknowledge) pending[index].done.resolve()
  }, disk: () => disk }
}
function append(f: Awaited<ReturnType<typeof fixture>>) {
  const lease = f.project.acquireApplyLease()!
  assert.ok(lease)
  assert.equal(lease.markApplied(), true)
  assert.equal(lease.markApplied(), false)
  f.project.content.value += '追加'
  f.project.onContentChange()
  const handle = f.project.beginSaveCurrentChapter({ applyLease: lease })
  return { lease, handle }
}

async function main() {
  // Deterministic two-second autosave clock; no real-time sleeps.
  const realSet = globalThis.setTimeout
  const realClear = globalThis.clearTimeout
  const timers = new Map<number, () => void>()
  let timerId = 0
  globalThis.setTimeout = ((callback: () => void, ms: number) => {
    assert.equal(ms, 2000)
    timers.set(++timerId, callback)
    return timerId
  }) as unknown as typeof setTimeout
  globalThis.clearTimeout = ((id: number) => { timers.delete(id) }) as unknown as typeof clearTimeout
  try {
    const validation = await fixture()
    const validationLease = validation.project.acquireApplyLease()!
    assert.equal(await validation.project.saveCurrentChapter(), false)
    assert.equal(await validation.project.autoSave(), false)
    assert.equal(validation.pending.length, 0, 'manual/autosave cannot commit underneath pre-apply validation')
    assert.equal(validationLease.releaseBeforeMutation(), true)
    const f = await fixture()
    const { lease, handle } = append(f)
    const promise = handle.settled
    const header = f.project.saveCurrentChapter()
    const auto = f.project.autoSave()
    const disposal = f.project.dispose()
    assert.equal(f.project.beginSaveCurrentChapter({ applyLease: lease }), handle)
    assert.equal(f.pending.length, 1)
    assert.equal(f.project.allowMutation(), false)
    handle.markUnknown()
    assert.equal(handle.state, 'unknown')
    assert.equal(handle.initialCommit, 'unknown')
    assert.equal(handle.settled, promise)
    assert.equal(f.project.beginSaveCurrentChapter({ applyLease: lease, retry: true }), handle)
    assert.equal(f.pending.length, 1)
    let settled = false
    void promise.then(() => { settled = true })
    await tick()
    assert.equal(settled, false, 'held commit is unknown, not false')
    f.commit(0, false)
    assert.equal(handle.initialCommit, 'committed', 'receipt is available before delayed acknowledgement')
    await tick()
    assert.equal(settled, false, 'held acknowledgement retains attribution and pending barrier')
    f.pending[0].done.resolve()
    assert.deepEqual(await promise, { status: 'clean', initialCommit: 'committed', lastSnapshotCommit: 'committed', catchUpFailed: false, hasUnsavedChanges: false })
    assert.deepEqual(await Promise.all([header, auto, disposal]), [true, true, true])
    assert.equal(lease.releaseIfClean(), true)
    assert.equal(f.project.isMutationBlocked.value, false)
    assert.equal(f.pending.length, 1)
    console.log('✓ held commit/ack, concurrent header/autosave/dispose/retry join one owned handle')

    const c = await fixture()
    const saved = append(c)
    c.commit(0, false)
    c.project.content.value += '作者后续编辑'
    c.project.onContentChange()
    for (const [id, callback] of [...timers]) { timers.delete(id); callback() }
    assert.equal(c.pending.length, 1, 'two-second timer joins, not duplicates the initial append')
    c.pending[0].done.resolve()
    await tick()
    assert.equal(c.pending.length, 2, 'only real author input produces one catch-up snapshot')
    c.pending[1].done.reject(new Error('后续保存失败'))
    const failed = await saved.handle.settled
    assert.deepEqual(failed, { status: 'failed', initialCommit: 'committed', lastSnapshotCommit: 'not_committed', catchUpFailed: true, hasUnsavedChanges: true })
    assert.equal(c.disk()[0].chapterList![0].content, '原文追加')
    assert.equal(saved.lease.releaseIfClean(), false)
    assert.equal(await c.project.autoSave(), false)
    assert.equal(await c.project.saveCurrentChapter(), false)
    assert.equal(c.pending.length, 2, 'generic recovery calls cannot silently dispatch')
    const originalPromise = saved.handle.settled
    const retry = c.project.beginSaveCurrentChapter({ applyLease: saved.lease, retry: true })
    assert.equal(retry, saved.handle)
    assert.notEqual(retry.settled, originalPromise)
    assert.equal(retry.initialCommit, 'committed')
    assert.equal(c.pending.length, 3)
    c.commit(2)
    assert.equal((await retry.settled).status, 'clean')
    assert.equal(saved.lease.releaseIfClean(), true)
    assert.equal(c.disk()[0].chapterList![0].content, '原文追加作者后续编辑')
    console.log('✓ initial commit remains immutable through catch-up failure and explicit same-handle save-only retry')

    const d = await fixture()
    const failedAppend = append(d)
    d.pending[0].done.reject(new Error('初始保存失败'))
    assert.equal((await failedAppend.handle.settled).initialCommit, 'not_committed')
    d.project.content.value += '继续编辑'
    d.project.onContentChange()
    for (const [id, callback] of [...timers]) { timers.delete(id); callback() }
    assert.equal(await d.project.dispose(), false)
    assert.equal(d.pending.length, 1, 'recovery never auto-retries after edit/timer/disposal')
    const r = d.project.beginSaveCurrentChapter({ applyLease: failedAppend.lease, retry: true })
    assert.equal(r, failedAppend.handle)
    d.commit(1)
    const repaired = await r.settled
    assert.equal(repaired.status, 'clean')
    assert.equal(repaired.initialCommit, 'not_committed', 'original attempt knowledge never rewritten by retry')
    assert.equal(repaired.lastSnapshotCommit, 'committed')
    console.log('✓ definite failure preserves first attempt knowledge and has no implicit retries')

    const late = await fixture()
    const original = append(late)
    late.project.currentNovel.value = { id: 2, title: '新工作区' }
    late.project.currentChapter.value = { id: 20, title: '新章', content: '新正文' }
    late.project.content.value = '新正文修改'
    late.project.hasUnsavedChanges.value = true
    late.project.saveError.value = '新工作区自己的错误'
    late.commit(0)
    await original.handle.settled
    assert.equal(late.project.hasUnsavedChanges.value, true)
    assert.equal(late.project.saveError.value, '新工作区自己的错误')
    assert.equal(original.handle.projectId, 1)
    assert.equal(original.handle.chapterId, 10)
    assert.equal(original.lease.releaseIfClean(), false)
    console.log('✓ late receipt belongs to original target and cannot clear newer workspace dirty/error state')

    const gate = createWriterPersistenceGate({ target: () => ({ projectId: 1, chapterId: 10 }), canAcquire: () => true })
    const chapter = ref(seed()[0].chapterList!)
    const novel = ref<WriterNovel | null>(seed()[0])
    const selected = ref(chapter.value[0])
    const body = ref('原文')
    const confirm = deferred<boolean>()
    let saves = 0
    const crud = useWriterChapterCrud({ currentNovel: novel, chapters: chapter, currentChapter: selected, content: body, events: ref([]),
      persist: async () => { saves++; return true }, selectChapter: async () => true, confirmDelete: () => confirm.promise,
      notify: { warning() {}, success() {} }, captureMutationIntent: gate.captureMutationIntent, allowMutation: gate.allowMutation })
    const deletion = crud.remove(chapter.value[0])
    const guard = gate.acquireApplyLease()!
    guard.releaseBeforeMutation()
    confirm.resolve(true)
    assert.equal(await deletion, false)
    assert.equal(chapter.value.length, 2)
    assert.equal(saves, 0)
    const material = useWriterMaterialCrud({ currentNovel: novel, chapters: chapter, currentChapter: selected, characters: ref([]), worldSettings: ref([]), corpusData: ref([]), events: ref([]),
      saveNovelData: async () => { saves++; return true }, confirmDelete: async () => true, notify: { warning() {}, success() {} },
      captureMutationIntent: gate.captureMutationIntent, allowMutation: gate.allowMutation })
    const file = deferred<string>()
    const importing = material.importCorpusFile({ text: () => file.promise })
    assert.equal(material.isMutating.value, true)
    const guard2 = gate.acquireApplyLease()!
    guard2.releaseBeforeMutation()
    file.resolve(JSON.stringify([{ id: 30, title: '导入', content: '内容' }]))
    assert.equal(await importing, false)
    assert.equal(material.isMutating.value, false)
    assert.equal(saves, 0)
    const intent = gate.captureMutationIntent()
    const pre = gate.acquireApplyLease()!
    gate.noteAuthorEdit()
    assert.equal(pre.markApplied(), false)
    assert.equal(gate.allowMutation(intent), false)
    console.log('✓ delayed delete/import intents remain revoked after lease cancellation; pre-apply text edit revokes append')

    const holdSave = deferred<boolean>()
    const barrierCrud = useWriterChapterCrud({ currentNovel: novel, chapters: chapter, currentChapter: selected, content: body, events: ref([]),
      persist: () => holdSave.promise, selectChapter: async () => true, confirmDelete: async () => true,
      notify: { warning() {}, success() {} } })
    barrierCrud.openEdit(chapter.value[0])
    barrierCrud.form.value.title = '待保存标题'
    const chapterSaving = barrierCrud.save()
    assert.equal(barrierCrud.isMutating.value, true)
    const chapterWaiting = barrierCrud.waitForMutation()
    let chapterFinished = false
    void chapterWaiting.then(() => { chapterFinished = true })
    await tick()
    assert.equal(chapterFinished, false)
    holdSave.resolve(false)
    assert.equal(await chapterSaving, false)
    assert.equal(await chapterWaiting, false)
    assert.equal(barrierCrud.isMutating.value, false)
    assert.equal(chapter.value[0].title, '一', 'chapter barrier includes complete rollback')

    const materialSave = deferred<boolean>()
    const characters = ref<import('../src/types/writer').WriterCharacter[]>([])
    const materialBarrier = useWriterMaterialCrud({ currentNovel: novel, chapters: chapter, currentChapter: selected, characters, worldSettings: ref([]), corpusData: ref([]), events: ref([]),
      saveNovelData: () => materialSave.promise, confirmDelete: async () => true, notify: { warning() {}, success() {} } })
    const generated = materialBarrier.importGeneratedCharacters([{ id: 40, name: '生成角色', tags: [] }])
    assert.equal(materialBarrier.isMutating.value, true, 'generated import cannot clear finally before its save settles')
    const materialWaiting = materialBarrier.waitForMutation()
    materialSave.resolve(false)
    assert.equal(await generated, false)
    assert.equal(await materialWaiting, false)
    assert.equal(materialBarrier.isMutating.value, false)
    assert.equal(characters.value.length, 0, 'material barrier includes complete rollback')
    console.log('✓ chapter and generated-material mutation barriers remain held through persistence and rollback')

    for (const kind of ['character', 'title', 'status', 'delete', 'delete_current'] as const) {
      const structural = await fixture()
      const p = structural.project
      if (kind === 'delete_current') p.chapters.value.splice(1)
      const first = p.saveNovelData()
      let mutation: Promise<boolean>
      if (kind === 'character') {
        const m = useWriterMaterialCrud({ currentNovel: p.currentNovel, chapters: p.chapters, currentChapter: p.currentChapter,
          characters: p.characters, worldSettings: p.worldSettings, corpusData: p.corpusData, events: p.events,
          saveNovelData: p.saveNovelData, confirmDelete: async () => true, notify: { warning() {}, success() {} },
          captureMutationIntent: p.captureMutationIntent, allowMutation: p.allowMutation })
        mutation = m.importGeneratedCharacters([{ id: 70, name: '保存期间角色', tags: [] }])
      } else if (kind === 'status') {
        assert.equal(p.allowMutation(), true)
        p.currentChapter.value!.status = 'completed'
        mutation = p.saveNovelData()
      } else {
        const c = useWriterChapterCrud({ currentNovel: p.currentNovel, chapters: p.chapters, currentChapter: p.currentChapter,
          content: p.content, events: p.events, persist: p.saveNovelData, selectChapter: p.selectChapter,
          confirmDelete: async () => true, notify: { warning() {}, success() {} },
          captureMutationIntent: p.captureMutationIntent, allowMutation: p.allowMutation })
        if (kind === 'title') { c.openEdit(p.currentChapter.value!); c.form.value.title = '保存期间改标题'; mutation = c.save() }
        else mutation = c.remove(p.chapters.value[kind === 'delete_current' ? 0 : 1])
      }
      await tick()
      assert.equal(structural.pending.length, 2, `${kind} keeps its own ordinary snapshot result`)
      structural.commit(0)
      structural.commit(1)
      assert.equal(await first, true)
      assert.equal(await mutation, true)
      const savedNovel = structural.disk()[0]
      if (kind === 'character') assert.equal(savedNovel.characters!.length, 1)
      if (kind === 'title') assert.equal(savedNovel.chapterList![0].title, '保存期间改标题')
      if (kind === 'status') assert.equal(savedNovel.chapterList![0].status, 'completed')
      if (kind === 'delete') assert.equal(savedNovel.chapterList!.length, 1)
      if (kind === 'delete_current') assert.equal(savedNovel.chapterList!.length, 0)
      assert.equal(p.hasUnsavedChanges.value, false)
    }
    console.log('✓ ordinary character/title/status/current and non-current chapter mutations retain independent snapshot results')

    const rollback = await fixture()
    const rp = rollback.project
    const rm = useWriterMaterialCrud({ currentNovel: rp.currentNovel, chapters: rp.chapters, currentChapter: rp.currentChapter,
      characters: rp.characters, worldSettings: rp.worldSettings, corpusData: rp.corpusData, events: rp.events,
      saveNovelData: rp.saveNovelData, confirmDelete: async () => true, notify: { warning() {}, success() {} } })
    const rc = useWriterChapterCrud({ currentNovel: rp.currentNovel, chapters: rp.chapters, currentChapter: rp.currentChapter,
      content: rp.content, events: rp.events, persist: rp.saveNovelData, selectChapter: rp.selectChapter,
      confirmDelete: async () => true, notify: { warning() {}, success() {} } })
    const committedMaterial = rm.importGeneratedCharacters([{ id: 80, name: '已保存角色', tags: [] }])
    rc.openEdit(rp.currentChapter.value!)
    rc.form.value.title = '后续失败标题'
    const failedTitle = rc.save()
    assert.equal(rollback.pending.length, 2)
    rollback.commit(0)
    rollback.pending[1].done.reject(new Error('第二项未提交'))
    assert.equal(await committedMaterial, true)
    assert.equal(await failedTitle, false)
    assert.equal(rp.characters.value.length, 1)
    assert.equal(rollback.disk()[0].characters!.length, 1)
    assert.equal(rp.currentChapter.value!.title, '一')
    assert.equal(rp.currentChapter.value, rp.chapters.value[0], 'failed same-ID replacement restores canonical original')
    const failedDelete = rc.remove(rp.currentChapter.value!)
    await tick()
    rollback.pending[2].done.reject(new Error('删除未提交'))
    assert.equal(await failedDelete, false)
    assert.equal(rp.currentChapter.value!.id, 10)
    assert.equal(rp.content.value, '原文')
    assert.equal(rp.chapters.value.length, 2)
    assert.equal(rp.characters.value.length, 1, 'later chapter rollback cannot undo a different committed CRUD')
    console.log('✓ ordinary committed CRUD is not rolled back by another save failure; current-chapter delete restores exact refs')


    const navigation = await fixture()
    let navigationLease: ReturnType<typeof navigation.project.acquireApplyLease> = null
    const changing = navigation.project.selectChapter(navigation.project.chapters.value[1], { onPersisted(saved) {
      assert.equal(saved, true)
      navigationLease = navigation.project.acquireApplyLease()
      assert.ok(navigationLease)
    } })
    navigation.commit(0)
    assert.equal(await changing, false, 'new ApplyLease between save and navigation continuation blocks target replacement')
    assert.equal(navigation.project.currentChapter.value!.id, 10)
    assert.equal(navigation.project.loadChapter(navigation.project.chapters.value[1]), false)
    assert.equal(navigation.project.currentChapter.value!.id, 10)
    navigationLease!.releaseBeforeMutation()
    const reinitializing = navigation.project.initNovel('1')
    const stopAcquire = watch(navigation.project.isSaving, saving => {
      if (!saving) navigationLease = navigation.project.acquireApplyLease()
    }, { flush: 'sync' })
    navigation.commit(1)
    assert.equal(await reinitializing, false)
    stopAcquire()
    assert.ok(navigationLease)
    navigationLease!.releaseBeforeMutation()
    console.log('✓ public chapter load and awaited selection/reinitialization reject a newly acquired apply owner')

    let legacyDisk = seed()
    let legacyWrites = 0
    const legacy = useWriterProject({ novelStore: { worldSettings: [] }, notifyError() {}, beforeUnloadTarget: null,
      persistence: { load: () => clone(legacyDisk), save: async novels => {
        legacyWrites++; legacyDisk = clone(novels); throw new Error('committed but lost acknowledgement, no observer support')
      } } })
    await legacy.initNovel('1')
    const legacyLease = legacy.acquireApplyLease()!
    legacyLease.markApplied()
    legacy.content.value += 'legacy追加'
    legacy.onContentChange()
    const unknown = legacy.beginSaveCurrentChapter({ applyLease: legacyLease })
    const uncertain = await unknown.settled
    assert.equal(uncertain.status, 'unknown')
    assert.equal(uncertain.initialCommit, 'unknown')
    assert.equal(uncertain.lastSnapshotCommit, 'unknown')
    assert.equal(legacyDisk[0].chapterList![0].content, '原文legacy追加')
    assert.equal(legacy.beginSaveCurrentChapter({ applyLease: legacyLease, retry: true }), unknown)
    assert.equal(await legacy.saveCurrentChapter(), false)
    assert.equal(await legacy.autoSave(), false)
    assert.equal(await legacy.dispose(), false)
    assert.equal(legacyWrites, 1)
    assert.equal(legacyLease.releaseIfClean(), false)
    console.log('✓ unsupported legacy receipt-free rejection stays unknown even when the test oracle saw a commit')

    const gap = await fixture()
    const gapSave = append(gap)
    const firstSettlement = gapSave.handle.settled
    gap.commit(0)
    assert.equal((await firstSettlement).status, 'clean')
    // Simulate raw editor assignment preceding its delayed onChange event.
    gap.project.content.value += '确认完成与界面释放之间的编辑'
    assert.equal(gapSave.lease.releaseIfClean(), false, 'release atomically checks the actual editor fingerprint')
    const gapJoin = gap.project.beginSaveCurrentChapter({ applyLease: gapSave.lease })
    assert.equal(gapJoin, gapSave.handle)
    assert.notEqual(gapJoin.settled, firstSettlement)
    assert.equal(gap.pending.length, 2)
    gap.project.onContentChange()
    gap.commit(1)
    assert.equal((await gapJoin.settled).status, 'clean')
    assert.equal(gapSave.lease.releaseIfClean(), true)
    assert.equal(gap.disk()[0].chapterList![0].content, '原文追加确认完成与界面释放之间的编辑')
    console.log('✓ a real edit after clean acknowledgement continues the same token before atomic lease release')

    const undo = await fixture()
    const undoSave = append(undo)
    undo.commit(0)
    const undoSettlement = undoSave.handle.settled
    assert.equal((await undoSettlement).status, 'clean')
    const originalHtml = undo.project.content.value
    undo.project.content.value += '临时输入'
    undo.project.onContentChange()
    const undoTimer = timerId
    undo.project.content.value = originalHtml
    undo.project.onContentChange()
    assert.equal(undo.project.hasUnsavedChanges.value, true)
    assert.equal(undoSave.lease.releaseIfClean(), false)
    const reconciled = undo.project.beginSaveCurrentChapter({ applyLease: undoSave.lease })
    assert.equal(reconciled, undoSave.handle)
    assert.notEqual(reconciled.settled, undoSettlement)
    assert.equal((await reconciled.settled).hasUnsavedChanges, false)
    assert.equal(undo.project.hasUnsavedChanges.value, false)
    assert.equal(undo.pending.length, 1, 'exact Undo of a post-clean edit needs no second physical save')
    assert.equal(timers.has(undoTimer), false, 'exact-saved reconciliation also cancels its now-redundant autosave timer')
    assert.equal(undoSave.lease.releaseIfClean(), true)
    console.log('✓ exact post-clean Undo restores only its proven clean snapshot and releases without rewriting')

    const navigationAfterAck = await fixture()
    const acknowledged = append(navigationAfterAck)
    const navigationArbiter = useWriterGenerationArbiter({ checkApiReady: () => true, notifyBlocked() {} })
    const uiAcknowledgement = acknowledged.handle.settled.then(result => result.status === 'clean' && acknowledged.lease.releaseIfClean())
    navigationArbiter.registerBarrier('agentCommit', {
      isPending: navigationAfterAck.project.isMutationBlocked, wait: () => uiAcknowledgement,
    })
    const leaving = (async () => {
      assert.equal(await navigationArbiter.waitForCommits(), true)
      assert.equal(await navigationAfterAck.project.saveCurrentChapter(), true)
      assert.equal(await navigationAfterAck.project.dispose(), true)
    })()
    navigationAfterAck.commit(0)
    await leaving
    assert.equal(await navigationAfterAck.project.autoSave(), true)
    assert.equal(await navigationAfterAck.project.saveNovelData(), true)
    navigationArbiter.dispose()
    assert.equal(navigationAfterAck.pending.length, 1, 'clean released Agent does not create causal navigation/dispose duplicates')

    const editsAfterRelease = await fixture()
    const released = append(editsAfterRelease)
    editsAfterRelease.commit(0)
    await released.handle.settled
    assert.equal(released.lease.releaseIfClean(), true)
    editsAfterRelease.project.content.value += '释放后作者编辑'
    editsAfterRelease.project.onContentChange()
    const laterText = editsAfterRelease.project.saveCurrentChapter()
    assert.equal(editsAfterRelease.pending.length, 2, 'new author edit retains ordinary save behavior')
    editsAfterRelease.commit(1)
    assert.equal(await laterText, true)
    editsAfterRelease.project.currentNovel.value!.title = '释放后项目改名'
    const laterMetadata = editsAfterRelease.project.saveNovelData()
    assert.equal(editsAfterRelease.pending.length, 3, 'full project mutation is never mistaken for unchanged Agent snapshot')
    editsAfterRelease.commit(2)
    assert.equal(await laterMetadata, true)
    assert.equal(editsAfterRelease.disk()[0].title, '释放后项目改名')
    assert.equal(editsAfterRelease.disk()[0].chapterList![0].content, '原文追加释放后作者编辑')
    console.log('✓ released clean Agent snapshot is reused by navigation/dispose; later text and metadata still save normally')



  } finally {
    globalThis.setTimeout = realSet
    globalThis.clearTimeout = realClear
  }
}
await main()
