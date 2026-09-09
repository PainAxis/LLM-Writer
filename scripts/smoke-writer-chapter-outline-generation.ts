import assert from 'node:assert/strict'
import { ref } from 'vue'
import { useWriterChapterOutlineGeneration } from '../src/composables/useWriterChapterOutlineGeneration'
import type { WriterChapter, WriterNovel } from '../src/types/writer'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function fakeStream() {
  const streamingContent = ref('')
  const isStreaming = ref(false)
  const requests: Array<{
    prompt: string
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
    generate(prompt: string) {
      const request = deferred<string>()
      requests.push({ prompt, resolve: request.resolve, reject: request.reject })
      isStreaming.value = true
      return request.promise.finally(() => { isStreaming.value = false })
    },
  }
}

function fixture() {
  const currentNovel = ref<WriterNovel | null>({
    id: 1,
    title: '雾海纪',
    genre: 'wuxia',
    description: '灯塔熄灭后的群岛。',
  })
  const chapters = ref<WriterChapter[]>([
    { id: 1, title: '潮汐', description: '众人抵达港口', wordCount: 1200 },
    { id: 2, title: '熄灯', description: '灯塔突然熄灭', wordCount: 900 },
  ])
  const stream = fakeStream()
  const messages: string[] = []
  const persistRequests: Array<ReturnType<typeof deferred<boolean>>> = []
  let delayedPersistence = false
  let persistenceResult = true
  let persistCalls = 0
  const singleInputs: unknown[] = []
  const batchInputs: unknown[] = []

  const controller = useWriterChapterOutlineGeneration({
    currentNovel,
    chapters,
    ensureApiReady: () => true,
    persist: async () => {
      persistCalls += 1
      if (!delayedPersistence) return persistenceResult
      const request = deferred<boolean>()
      persistRequests.push(request)
      return request.promise
    },
    buildSinglePrompt: input => {
      singleInputs.push(input)
      return `单章|${input.form.title}|${input.customPrompt ?? '默认'}|${input.chapters.length}`
    },
    buildBatchPrompt: input => {
      batchInputs.push(input)
      return `批量|${input.form.count}|${input.customPrompt ?? '默认'}|${input.chapters.length}`
    },
    parseBatchResponse: response => response === '两个章节'
      ? [
          { title: '', description: '第一段' },
          { title: '第四章', description: '第二段' },
        ]
      : [],
    notify: {
      success: message => messages.push(`success:${message}`),
      warning: message => messages.push(`warning:${message}`),
      error: message => messages.push(`error:${message}`),
    },
    stream,
    createId: () => 2,
    now: () => new Date('2026-09-08T01:02:03.000Z'),
  })

  return {
    controller,
    currentNovel,
    chapters,
    stream,
    messages,
    singleInputs,
    batchInputs,
    persistCalls: () => persistCalls,
    delayPersistence() { delayedPersistence = true },
    setPersistenceResult(value: boolean) { persistenceResult = value },
    releasePersistence(value: boolean) {
      const request = persistRequests.shift()
      assert.ok(request)
      request.resolve(value)
    },
    rejectPersistence(reason: unknown) {
      const request = persistRequests.shift()
      assert.ok(request)
      request.reject(reason)
    },
  }
}

async function testSingleSuccess() {
  const f = fixture()
  const prompt = { id: 1, title: '自定义', category: 'chapter', content: '内容' }
  f.controller.openSingle()
  f.controller.singleForm.value.title = '第三章'
  assert.equal(f.controller.useSinglePrompt(prompt, '  强化反转  '), true)
  const generation = f.controller.generateSingle()
  assert.equal(f.stream.requests[0].prompt, '单章|第三章|  强化反转  |2')
  f.stream.requests[0].resolve('大纲：港口议会发生倒戈')
  assert.equal(await generation, true)
  assert.deepEqual(f.chapters.value.map(chapter => chapter.id), [1, 2, 3])
  assert.equal(f.chapters.value[2].title, '第三章')
  assert.equal(f.chapters.value[2].description, '港口议会发生倒戈')
  assert.equal(
    (f.chapters.value[2].createdAt as Date).toISOString(),
    '2026-09-08T01:02:03.000Z',
  )
  assert.equal(f.controller.singleVisible.value, false)
  assert.equal(f.controller.singleForm.value.title, '')
  assert.equal(f.controller.singleSelectedPrompt.value, null)
  assert.deepEqual(f.messages, ['success:使用自定义提示词生成单章成功'])
  console.log('✓ 单章生成使用快照与唯一 ID，成功保存后完整重置对话框')
}

async function testPersistenceRollback() {
  const f = fixture()
  f.controller.openSingle()
  f.controller.singleForm.value.title = '保存失败章'
  f.setPersistenceResult(false)
  const generation = f.controller.generateSingle()
  f.stream.requests[0].resolve('大纲：不会落盘')
  assert.equal(await generation, false)
  assert.deepEqual(f.chapters.value.map(chapter => chapter.id), [1, 2])
  assert.equal(f.controller.singleVisible.value, true)
  assert.equal(f.controller.singleForm.value.title, '保存失败章')
  assert.equal(f.controller.isGenerating.value, false)
  assert.deepEqual(f.messages, ['error:生成的章节尚未保存，请重试'])
  console.log('✓ 保存失败按插入对象回滚章节，同时保留可重试表单')
}

async function testCommitLockAndDeferredReset() {
  const f = fixture()
  f.delayPersistence()
  f.controller.openSingle()
  f.controller.singleForm.value.title = '事务中的章节'
  const generation = f.controller.generateSingle()
  f.stream.requests[0].resolve('大纲：事务内容')
  for (let turn = 0; turn < 10 && !f.controller.isCommitting.value; turn += 1) {
    await Promise.resolve()
  }
  assert.equal(f.controller.isCommitting.value, true)
  assert.equal(f.chapters.value.length, 3)
  const pendingCommit = f.controller.waitForCommit()
  assert.equal(pendingCommit, generation)
  assert.equal(f.controller.cancel(), false)
  assert.equal(f.controller.resetSingle(), false)
  f.controller.singleVisible.value = false
  assert.equal(f.controller.singleVisible.value, true)
  assert.equal(await f.controller.generateSingle(), false)
  f.releasePersistence(true)
  assert.equal(await pendingCommit, true)
  assert.equal(await generation, true)
  assert.equal(f.controller.isCommitting.value, false)
  assert.equal(f.controller.singleVisible.value, false)
  assert.equal(f.controller.singleForm.value.title, '')
  console.log('✓ 不可取消的保存阶段锁定操作，完成后执行延迟 reset')
}

async function testDraftAndNovelRaces() {
  const edited = fixture()
  const prompt = { id: 2, title: '模板', category: 'chapter', content: '内容' }
  edited.controller.openSingle()
  edited.controller.singleForm.value.title = '原标题'
  edited.controller.useSinglePrompt(prompt, '旧渲染内容')
  edited.controller.singleForm.value.plotRequirement = '用户后来修改'
  assert.equal(edited.controller.singleSelectedPrompt.value, null)
  edited.controller.useSinglePrompt(prompt, '重新渲染内容')
  edited.chapters.value[0].description = '外部修改了章节上下文'
  assert.equal(edited.controller.singleSelectedPrompt.value, null)

  edited.controller.useSinglePrompt(prompt, '小说信息变更前的内容')
  edited.currentNovel.value!.title = '用户原地修改了小说标题'
  assert.equal(edited.controller.singleSelectedPrompt.value, null)

  const generation = edited.controller.generateSingle()
  edited.controller.singleForm.value.title = '生成期间的新标题'
  edited.stream.requests[0].resolve('大纲：迟到结果')
  assert.equal(await generation, false)
  assert.equal(edited.persistCalls(), 0)
  assert.equal(edited.chapters.value.length, 2)

  const reloaded = fixture()
  reloaded.controller.openSingle()
  reloaded.controller.singleForm.value.title = '旧小说请求'
  const stale = reloaded.controller.generateSingle()
  reloaded.currentNovel.value = { id: 1, title: '同 ID 的重新加载小说' }
  reloaded.stream.requests[0].resolve('大纲：不能串入')
  assert.equal(await stale, false)
  assert.equal(reloaded.chapters.value.length, 2)
  assert.equal(reloaded.controller.singleVisible.value, false)
  assert.deepEqual(reloaded.messages, [])
  console.log('✓ 表单/章节上下文变化作废 prompt 与请求，同 ID 小说重载也隔离迟到结果')
}

async function testRejectedPersistenceIsNormalized() {
  const f = fixture()
  f.delayPersistence()
  f.controller.openSingle()
  f.controller.singleForm.value.title = '异常保存章'
  const generation = f.controller.generateSingle()
  f.stream.requests[0].resolve('大纲：等待保存')
  for (let turn = 0; turn < 10 && !f.controller.isCommitting.value; turn += 1) {
    await Promise.resolve()
  }
  const pendingCommit = f.controller.waitForCommit()
  f.rejectPersistence(new Error('storage unavailable'))
  assert.equal(await pendingCommit, false)
  assert.equal(await generation, false)
  assert.deepEqual(f.chapters.value.map(chapter => chapter.id), [1, 2])
  assert.deepEqual(f.messages, ['error:生成的章节尚未保存，请重试'])
  console.log('✓ waitForCommit 等待完整事务，并将持久化 reject 规范化为 false')
}

async function testRestartAfterUnsettledCancellation() {
  const f = fixture()
  f.controller.openSingle()
  f.controller.singleForm.value.title = '旧请求'
  const stale = f.controller.generateSingle()
  f.controller.cancel()

  f.controller.singleForm.value.title = '新请求'
  const current = f.controller.generateSingle()
  assert.equal(f.stream.requests.length, 2)
  f.stream.requests[0].resolve('大纲：迟到的旧请求')
  assert.equal(await stale, false)
  f.stream.requests[1].resolve('大纲：当前请求')
  assert.equal(await current, true)
  assert.equal(f.chapters.value.at(-1)?.title, '新请求')
  assert.equal(f.chapters.value.at(-1)?.description, '当前请求')
  console.log('✓ 已取消的底层请求尚未结算时仍可立即开始新请求')
}

async function testBatchGeneration() {
  const f = fixture()
  f.controller.openBatch()
  f.controller.batchForm.value.count = 3
  const generation = f.controller.generateBatch()
  assert.equal(f.stream.requests[0].prompt, '批量|3|默认|2')
  f.stream.requests[0].resolve('两个章节')
  assert.equal(await generation, true)
  assert.deepEqual(f.chapters.value.map(chapter => chapter.id), [1, 2, 3, 4])
  assert.deepEqual(f.chapters.value.slice(2).map(chapter => chapter.title), ['AI生成章节 3', '第四章'])
  assert.deepEqual(f.messages, [
    'warning:期望生成3个章节，实际解析出2个章节',
    'success:成功生成2个章节大纲',
  ])
  assert.equal(f.batchInputs.length, 1)
  console.log('✓ 批量生成统一解析、数量告警、回退标题和事务提交')
}

async function main() {
  await testSingleSuccess()
  await testPersistenceRollback()
  await testCommitLockAndDeferredReset()
  await testDraftAndNovelRaces()
  await testRejectedPersistenceIsNormalized()
  await testRestartAfterUnsettledCancellation()
  await testBatchGeneration()
  console.log('\n=== WRITER CHAPTER OUTLINE GENERATION TESTS PASSED ===')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
