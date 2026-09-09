import assert from 'node:assert/strict'
import { ref } from 'vue'
import { useWriterChapterContentGeneration } from '../src/composables/useWriterChapterContentGeneration'
import type {
  PromptTemplate,
  WriterChapter,
  WriterCorpusItem,
  WriterNovel,
} from '../src/types/writer'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function fakeStream() {
  const streamingContent = ref('')
  const isStreaming = ref(false)
  const requests: Array<{
    prompt: string
    options: unknown
    resolve(value: string): void
    reject(reason?: unknown): void
  }> = []
  let resets = 0
  return {
    streamingContent,
    isStreaming,
    requests,
    resetCount: () => resets,
    reset() {
      resets += 1
      streamingContent.value = ''
      isStreaming.value = false
    },
    generate(prompt: string, options?: unknown) {
      const request = deferred<string>()
      requests.push({ prompt, options, resolve: request.resolve, reject: request.reject })
      isStreaming.value = true
      return request.promise.finally(() => { isStreaming.value = false })
    },
  }
}

const prompt: PromptTemplate = {
  id: 91,
  title: '正文模板',
  category: 'content',
  content: '{章节标题}|{目标字数}|{主要人物}|{参考语料}|{前文概要}|{自定义要求}',
}

function fixture() {
  const currentNovel = ref<WriterNovel | null>({
    id: 1,
    title: '雾海纪',
    genre: 'wuxia',
    description: '灯塔熄灭后的群岛。',
  })
  const chapters = ref<WriterChapter[]>([
    {
      id: 11,
      title: '潮声',
      description: '沈砚抵达港口',
      content: '<p>旧港潮声渐近。</p>',
      status: 'draft',
    },
    {
      id: 12,
      title: '熄灯',
      description: '灯塔突然熄灭',
      content: '<p>所有航标同时消失。</p>',
      status: 'draft',
    },
    {
      id: 13,
      title: '议会',
      description: '众人参加司灯议会',
      content: '<p>第三章旧正文。</p>',
      status: 'outline',
    },
  ])
  const currentChapter = ref<WriterChapter | null>(chapters.value[0])
  const content = ref(currentChapter.value.content ?? '')
  const hasUnsavedChanges = ref(false)
  const characters = ref([{ id: 21, name: '沈砚', role: 'protagonist', personality: '克制' }])
  const worldSettings = ref([{ id: 31, title: '雾港', description: '潮雾笼罩' }])
  const corpusData = ref<WriterCorpusItem[]>([
    { id: 41, title: '航海日志', content: '灯塔、潮汐与港口航线。' },
    { id: 42, title: '议会记录', content: '司灯议会隐藏着一次倒戈。' },
  ])
  const events = ref([{ id: 51, title: '灯塔熄灭', chapter: 2 }])
  const stream = fakeStream()
  const messages: string[] = []
  const snapshots: any[] = []
  const recommendationContexts: string[] = []
  let prepareResult = true
  let prepareCalls = 0
  let selectMode: 'immediate' | 'delayed' | 'delayed-false' | 'false' | 'reject' = 'immediate'
  let selectionGate: ReturnType<typeof deferred<void>> | undefined
  let selectCalls = 0
  let persistMode: 'true' | 'false' | 'delayed-true' | 'delayed-false' | 'reject' = 'true'
  let commitGate: ReturnType<typeof deferred<boolean>> | undefined
  let persistCalls = 0

  const controller = useWriterChapterContentGeneration({
    currentNovel,
    chapters,
    currentChapter,
    content,
    hasUnsavedChanges,
    characters,
    worldSettings,
    corpusData,
    events,
    prepare: () => {
      prepareCalls += 1
      return prepareResult
    },
    selectChapter: async (chapter, selection) => {
      selectCalls += 1
      if (selectMode === 'reject') throw new Error('切章异常')
      if (selectMode === 'delayed' || selectMode === 'delayed-false') {
        selectionGate = deferred<void>()
        await selectionGate.promise
      }
      const saved = selectMode !== 'false' && selectMode !== 'delayed-false'
      selection?.onPersisted?.(saved)
      if (!saved || selection?.isCurrent?.() === false) return false
      const canonical = chapters.value.find(item => item.id === chapter.id)
      if (!canonical || selection?.isCurrent?.() === false) return false
      currentChapter.value = canonical
      content.value = canonical.content ?? ''
      return true
    },
    persist: async () => {
      persistCalls += 1
      if (persistMode === 'reject') throw new Error('存储不可用')
      let saved = persistMode !== 'false' && persistMode !== 'delayed-false'
      if (persistMode === 'delayed-true' || persistMode === 'delayed-false') {
        commitGate = deferred<boolean>()
        saved = await commitGate.promise
      }
      if (saved && currentChapter.value) {
        currentChapter.value.content = content.value
        currentChapter.value.wordCount = content.value.length
        hasUnsavedChanges.value = false
      }
      return saved
    },
    notify: {
      success: message => messages.push(`success:${message}`),
      info: notice => messages.push(`info:${typeof notice === 'string' ? notice : notice.message}`),
      warning: message => messages.push(`warning:${message}`),
      error: message => messages.push(`error:${message}`),
    },
    stream,
    buildPrompt: (snapshot) => {
      snapshots.push(snapshot)
      return {
        prompt: [
          snapshot.chapter.title,
          snapshot.config.wordCount,
          snapshot.materials.characters[0]?.name ?? '-',
          snapshot.materials.corpus[0]?.title ?? '-',
          snapshot.contextChapters.map(chapter => chapter.title).join(','),
          snapshot.prompt,
        ].join('|'),
        contextLabels: snapshot.contextChapters.map(
          chapter => `第${chapter.chapterIndex}章：${chapter.title}`,
        ),
      }
    },
    formatContent: (response, title) => `<article>${title}:${response}</article>`,
    recommend: (items, contextText) => {
      recommendationContexts.push(contextText)
      return items.map((item, index) => ({ item, score: 10 - index, matchedTerms: ['灯塔'] }))
    },
  })

  const selectPrompt = () => {
    controller.selectPrompt(prompt)
    controller.promptVariables.value.自定义要求 = '保留潮汐伏笔'
  }

  return {
    controller,
    currentNovel,
    chapters,
    currentChapter,
    content,
    hasUnsavedChanges,
    characters,
    corpusData,
    stream,
    messages,
    snapshots,
    recommendationContexts,
    selectPrompt,
    prepareCalls: () => prepareCalls,
    setPrepareResult: (value: boolean) => { prepareResult = value },
    selectCalls: () => selectCalls,
    setSelectMode: (mode: typeof selectMode) => { selectMode = mode },
    releaseSelection: () => {
      assert.ok(selectionGate)
      selectionGate.resolve()
      selectionGate = undefined
    },
    persistCalls: () => persistCalls,
    setPersistMode: (mode: typeof persistMode) => { persistMode = mode },
    releaseCommit: (saved: boolean) => {
      assert.ok(commitGate)
      commitGate.resolve(saved)
      commitGate = undefined
    },
  }
}

async function flushUntil(predicate: () => boolean) {
  for (let turn = 0; turn < 20 && !predicate(); turn += 1) await Promise.resolve()
  assert.equal(predicate(), true)
}

async function testWorkspaceHelpersAndRecommendation() {
  const f = fixture()
  assert.equal(f.controller.open(f.chapters.value[2]), true)
  assert.deepEqual(f.controller.selectedContextChapterIds.value, [11, 12])
  f.selectPrompt()
  f.controller.selectAllMaterials('characters')
  f.controller.selectedMaterials.value.corpus.push(f.corpusData.value[0])

  assert.deepEqual(f.controller.recommendCorpusForContext(), { recommended: 2, added: 1 })
  assert.deepEqual(f.controller.selectedMaterials.value.corpus.map(item => item.id), [41, 42])
  assert.match(f.controller.promptVariables.value.参考语料, /议会记录/)
  assert.match(f.recommendationContexts[0], /雾海纪/)
  assert.match(f.recommendationContexts[0], /众人参加司灯议会/)
  f.controller.clearContextSelection()
  f.controller.selectAllContextChapters()
  f.controller.clearAllSelections()
  assert.deepEqual(f.controller.selectedContextChapterIds.value, [])
  assert.ok(Object.values(f.controller.selectedMaterials.value).every(items => items.length === 0))
  assert.ok(f.messages.includes('success:已选择所有人物'))
  assert.ok(f.messages.some(message => message.includes('新选中 1 篇')))
  console.log('✓ 协调器透传 workspace，并收口素材/上下文提示与语料推荐去重')
}

async function testSnapshotSurvivesDelayedChapterSelection() {
  const f = fixture()
  f.controller.open(f.chapters.value[2])
  f.selectPrompt()
  f.controller.generateConfig.value.wordCount = 3333
  f.controller.selectAllMaterials('characters')
  f.controller.selectedMaterials.value.corpus.push(f.corpusData.value[0])
  f.setSelectMode('delayed')

  const generation = f.controller.generateChapterContentWithDialog()
  assert.equal(f.controller.isSelectingChapter.value, true)
  assert.equal(f.controller.isBusy.value, true)
  assert.equal(f.controller.isExpectedChapterSelection(f.chapters.value[2]), true)
  assert.equal(f.controller.isExpectedChapterSelection(f.chapters.value[1]), false)
  assert.equal(f.controller.waitForIdle(), generation)
  assert.equal(await f.controller.generateChapterContentWithDialog(), false, '等待切章时必须拒绝双击')
  assert.equal(f.prepareCalls(), 1)
  assert.equal(f.stream.requests.length, 0)

  f.controller.generateConfig.value.wordCount = 777
  f.characters.value[0].name = '后来改名'
  f.releaseSelection()
  await flushUntil(() => f.stream.requests.length === 1)
  assert.equal(f.currentChapter.value?.id, 13)
  assert.equal(f.controller.isExpectedChapterSelection(f.chapters.value[2]), false)
  assert.equal(f.snapshots[0].config.wordCount, 3333)
  assert.equal(f.snapshots[0].materials.characters[0].name, '沈砚')
  assert.match(f.stream.requests[0].prompt, /议会\|3333\|沈砚\|航海日志/)
  assert.equal(f.controller.visible.value, false)

  f.stream.requests[0].resolve('完整正文')
  assert.equal(await generation, true)
  assert.equal(f.content.value, '<article>议会:完整正文</article>')
  assert.equal(f.currentChapter.value?.status, 'draft')
  assert.equal(f.persistCalls(), 1)
  assert.ok(f.messages.includes('success:正文生成成功'))
  console.log('✓ 先冻结快照、后等待持久化切章，双击与后续表单修改不污染请求')
}

async function testSelectionFailureCloseAndReject() {
  const failed = fixture()
  failed.controller.open(failed.chapters.value[2])
  failed.selectPrompt()
  failed.setSelectMode('delayed-false')
  const failedAction = failed.controller.generateChapterContentWithDialog()
  const failedBarrier = failed.controller.waitForSelection()
  await flushUntil(() => failed.selectCalls() === 1)
  failed.releaseSelection()
  assert.equal(await failedBarrier, false, '当前 selection 的保存失败必须阻止后续动作')
  assert.equal(await failedAction, false)
  assert.equal(failed.stream.requests.length, 0)
  assert.equal(failed.persistCalls(), 0)

  const closed = fixture()
  closed.controller.open(closed.chapters.value[2])
  closed.selectPrompt()
  closed.setSelectMode('delayed')
  const stale = closed.controller.generateChapterContentWithDialog()
  closed.controller.visible.value = false
  assert.equal(closed.controller.isBusy.value, true, '已撤销 intent 仍须等待切章内的保存 settle')
  assert.equal(closed.controller.isExpectedChapterSelection(closed.chapters.value[2]), false)
  assert.equal(closed.controller.open(closed.chapters.value[1]), false)
  const selectionBarrier = closed.controller.waitForSelection()
  assert.equal(closed.controller.waitForCommit(), selectionBarrier)
  assert.equal(closed.controller.waitForIdle(), selectionBarrier)
  await flushUntil(() => closed.selectCalls() === 1)
  closed.releaseSelection()
  assert.equal(await selectionBarrier, true, '被撤销的 selection false 不应阻止随后导航')
  assert.equal(await stale, false)
  assert.equal(closed.controller.isBusy.value, false)
  assert.equal(closed.currentChapter.value?.id, 11)
  assert.equal(closed.stream.requests.length, 0)

  const cancelledFailure = fixture()
  cancelledFailure.controller.open(cancelledFailure.chapters.value[2])
  cancelledFailure.selectPrompt()
  cancelledFailure.setSelectMode('delayed-false')
  const cancelledAction = cancelledFailure.controller.generateChapterContentWithDialog()
  cancelledFailure.controller.visible.value = false
  const cancelledBarrier = cancelledFailure.controller.waitForSelection()
  await flushUntil(() => cancelledFailure.selectCalls() === 1)
  cancelledFailure.releaseSelection()
  assert.equal(await cancelledBarrier, false, '撤销 intent 不能掩盖真实的保存失败')
  assert.equal(await cancelledAction, false)
  assert.equal(cancelledFailure.currentChapter.value?.id, 11)

  const rejected = fixture()
  rejected.controller.open(rejected.chapters.value[2])
  rejected.selectPrompt()
  rejected.setSelectMode('reject')
  const unhandledRejections: unknown[] = []
  const recordUnhandledRejection = (reason: unknown) => { unhandledRejections.push(reason) }
  process.on('unhandledRejection', recordUnhandledRejection)
  const originalConsoleError = console.error
  console.error = () => undefined
  try {
    assert.equal(await rejected.controller.generateChapterContentWithDialog(), false)
    await new Promise<void>(resolve => setImmediate(resolve))
  } finally {
    console.error = originalConsoleError
    process.off('unhandledRejection', recordUnhandledRejection)
  }
  assert.deepEqual(rejected.messages, ['error:正文生成失败: 切章异常'])
  assert.deepEqual(unhandledRejections, [])
  assert.equal(rejected.controller.isBusy.value, false)
  console.log('✓ 切章失败/关闭/异常均使 launch 安全失效，且异常规范化为 false')
}

async function testUserEditCancelsAndCanRestartImmediately() {
  const f = fixture()
  f.controller.open(f.chapters.value[0])
  f.selectPrompt()
  const stale = f.controller.generateChapterContentWithDialog()
  assert.equal(f.stream.requests.length, 1)

  const original = f.content.value
  f.content.value = '<p>用户在生成期间编辑</p>'
  f.content.value = original
  assert.equal(f.controller.isBusy.value, false)
  assert.ok(f.messages.includes('warning:正文已在生成期间发生修改，已保留当前编辑内容'))

  // The old fake transport deliberately ignores reset and remains pending.
  f.controller.open(f.chapters.value[0])
  f.selectPrompt()
  const current = f.controller.generateChapterContentWithDialog()
  assert.equal(f.stream.requests.length, 2, '旧 transport 未结算也不能锁死重新生成')
  f.stream.requests[0].resolve('迟到旧结果')
  assert.equal(await stale, false)
  assert.equal(f.content.value, original)
  f.stream.requests[1].resolve('新的完整结果')
  assert.equal(await current, true)
  assert.equal(f.content.value, '<article>潮声:新的完整结果</article>')
  assert.equal(f.persistCalls(), 1)

  const explicit = fixture()
  explicit.controller.open(explicit.chapters.value[0])
  explicit.selectPrompt()
  const cancelled = explicit.controller.generateChapterContentWithDialog()
  assert.equal(explicit.controller.cancel(), true)
  explicit.controller.open(explicit.chapters.value[0])
  explicit.selectPrompt()
  const restarted = explicit.controller.generateChapterContentWithDialog()
  assert.equal(explicit.stream.requests.length, 2)
  explicit.stream.requests[0].resolve('显式取消后的旧结果')
  assert.equal(await cancelled, false)
  explicit.stream.requests[1].resolve('显式取消后的新结果')
  assert.equal(await restarted, true)
  assert.equal(explicit.content.value, '<article>潮声:显式取消后的新结果</article>')
  console.log('✓ 编辑或显式 cancel 作废旧请求，迟到结果隔离且可立即重启')
}

async function testPersistenceFailureAndCommitBarrier() {
  const failed = fixture()
  failed.controller.open(failed.chapters.value[0])
  failed.selectPrompt()
  failed.setPersistMode('false')
  const failure = failed.controller.generateChapterContentWithDialog()
  failed.stream.requests[0].resolve('已生成但未保存')
  assert.equal(await failure, false)
  assert.equal(failed.content.value, '<article>潮声:已生成但未保存</article>')
  assert.equal(failed.hasUnsavedChanges.value, true)
  assert.equal(failed.currentChapter.value?.status, 'draft')
  assert.equal(failed.messages.some(message => message === 'success:正文生成成功'), false)

  const pending = fixture()
  pending.controller.open(pending.chapters.value[0])
  pending.selectPrompt()
  pending.setPersistMode('delayed-true')
  const generation = pending.controller.generateChapterContentWithDialog()
  pending.stream.requests[0].resolve('等待落盘')
  await flushUntil(() => pending.controller.isCommitting.value)
  const commitBarrier = pending.controller.waitForCommit()
  assert.equal(commitBarrier, generation, 'commit barrier 必须等待完整 action 收尾')
  assert.equal(pending.controller.cancel(), false)
  assert.equal(pending.controller.reset(), false)
  assert.equal(pending.controller.isCommitting.value, true)
  assert.equal(await pending.controller.generateChapterContentWithDialog(), false)
  pending.releaseCommit(true)
  assert.equal(await commitBarrier, true, 'cancel 不得撤销不可取消的提交 action')
  assert.equal(await generation, true)
  assert.equal(pending.controller.isCommitting.value, false)
  assert.equal(pending.controller.targetChapter.value, null, 'commit 后执行延迟 workspace reset')
  assert.equal(pending.content.value, '<article>潮声:等待落盘</article>')
  assert.equal(pending.messages.some(message => message === 'success:正文生成成功'), true)
  console.log('✓ 保存失败保留正文；提交阶段 cancel 为 no-op，reset 延迟且 barrier 等到完整收尾')
}

async function testRejectedPersistenceAndProjectRaces() {
  const rejected = fixture()
  rejected.controller.open(rejected.chapters.value[0])
  rejected.selectPrompt()
  rejected.setPersistMode('reject')
  const failed = rejected.controller.generateChapterContentWithDialog()
  rejected.stream.requests[0].resolve('无法落盘正文')
  assert.equal(await failed, false)
  assert.equal(rejected.content.value, '<article>潮声:无法落盘正文</article>')
  assert.deepEqual(rejected.messages, ['error:正文生成失败: 存储不可用'])

  const changedBeforeStart = fixture()
  changedBeforeStart.controller.open(changedBeforeStart.chapters.value[0])
  changedBeforeStart.selectPrompt()
  const staleSnapshot = changedBeforeStart.controller.createSnapshot()
  assert.ok(staleSnapshot)
  changedBeforeStart.currentNovel.value!.title = '快照创建后原地改名'
  assert.equal(await changedBeforeStart.controller.generateContentWithPrompt(staleSnapshot), false)
  assert.equal(changedBeforeStart.stream.requests.length, 0)
  assert.equal(changedBeforeStart.persistCalls(), 0)
  assert.ok(changedBeforeStart.messages.includes(
    'warning:章节生成上下文已失效，请重新打开生成对话框',
  ))

  const reloaded = fixture()
  reloaded.controller.open(reloaded.chapters.value[0])
  reloaded.selectPrompt()
  const staleNovel = reloaded.controller.generateChapterContentWithDialog()
  reloaded.currentNovel.value = { id: 1, title: '同 ID 重载后的小说' }
  reloaded.stream.requests[0].resolve('旧小说迟到结果')
  assert.equal(await staleNovel, false)
  assert.equal(reloaded.persistCalls(), 0)

  const changedMetadata = fixture()
  changedMetadata.controller.open(changedMetadata.chapters.value[0])
  changedMetadata.selectPrompt()
  const stalePrompt = changedMetadata.controller.generateChapterContentWithDialog()
  changedMetadata.currentNovel.value!.title = '原对象内修改标题'
  changedMetadata.stream.requests[0].resolve('旧提示词迟到结果')
  assert.equal(await stalePrompt, false)
  assert.equal(changedMetadata.persistCalls(), 0)

  const deleted = fixture()
  deleted.controller.open(deleted.chapters.value[0])
  deleted.selectPrompt()
  const staleChapter = deleted.controller.generateChapterContentWithDialog()
  deleted.currentChapter.value = null
  deleted.content.value = ''
  deleted.stream.requests[0].resolve('已删除章节迟到结果')
  assert.equal(await staleChapter, false)
  assert.equal(deleted.content.value, '')
  assert.equal(deleted.persistCalls(), 0)
  console.log('✓ 过期快照、persist reject、同 ID 重载、元数据修改与删章均隔离迟到结果')
}

async function main() {
  await testWorkspaceHelpersAndRecommendation()
  await testSnapshotSurvivesDelayedChapterSelection()
  await testSelectionFailureCloseAndReject()
  await testUserEditCancelsAndCanRestartImmediately()
  await testPersistenceFailureAndCommitBarrier()
  await testRejectedPersistenceAndProjectRaces()
  console.log('\n=== WRITER CHAPTER CONTENT GENERATION TESTS PASSED ===')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
