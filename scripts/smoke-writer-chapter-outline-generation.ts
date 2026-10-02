import assert from 'node:assert/strict'
import { ref } from 'vue'
import { useWriterChapterOutlineGeneration } from '../src/composables/useWriterChapterOutlineGeneration'
import { useWriterProject } from '../src/composables/useWriterProject'
import { parseChapterResponse } from '../src/utils/chapterParser'
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
    parseBatchResponse: parseChapterResponse,
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
  f.stream.requests[0].resolve(batchResponse(3))
  assert.equal(await generation, true)
  assert.deepEqual(f.chapters.value.map(chapter => chapter.id), [1, 2, 3, 4, 5])
  assert.deepEqual(f.chapters.value.slice(2).map(chapter => chapter.title), ['新章1', '新章2', '新章3'])
  assert.deepEqual(f.messages, ['success:成功生成3个章节大纲'])
  assert.equal(f.batchInputs.length, 1)
  console.log('✓ 批量生成真实解析结果完整匹配数量后才提交')
}

function batchResponse(count: number) {
  return Array.from({ length: count }, (_, index) => `章节${index + 1}：\n标题：新章${index + 1}\n大纲：事件${index + 1}`).join('\n\n')
}

function testStrictParserFormatsAndFailure() {
  assert.deepEqual(parseChapterResponse(batchResponse(2)), [
    { title: '新章1', description: '事件1' }, { title: '新章2', description: '事件2' },
  ])
  assert.deepEqual(parseChapterResponse('第一章 归来\n主角返乡。\n\n第二章：夜访\n大纲：追查失踪案。'), [
    { title: '归来', description: '主角返乡。' }, { title: '夜访', description: '追查失踪案。' },
  ])
  assert.deepEqual(parseChapterResponse('第一章归来\n主角返乡。\n\n第二章夜访\n追查失踪案。'), [
    { title: '归来', description: '主角返乡。' }, { title: '夜访', description: '追查失踪案。' },
  ])
  assert.equal(parseChapterResponse(`以下是三个章节的大纲：\n${batchResponse(3)}`).length, 3)
  assert.equal(parseChapterResponse(`以下是三个章节的大纲：\n\n\`\`\`text\n${batchResponse(3)}\n\`\`\``).length, 3)
  assert.equal(parseChapterResponse('Here are two chapter outlines:\n```markdown\nChapter 1: Arrival\nOutline: Meet.\nChapter 2: Choices\nOutline: Decide.\n```').length, 2)
  assert.deepEqual(parseChapterResponse('章节1：标题：行内标题\n大纲：具体事件。'), [
    { title: '行内标题', description: '具体事件。' },
  ])
  assert.deepEqual(parseChapterResponse('Chapter 1: Arrival\nOutline: Meet the guard.\n\nChapter 2\nTitle: Choices\nOutline:\nFind the clue.\n\nChoose a side.'), [
    { title: 'Arrival', description: 'Meet the guard.' },
    { title: 'Choices', description: 'Find the clue.\n\nChoose a side.' },
  ])
  assert.deepEqual(parseChapterResponse('```text\r\n## 章节1：\r\n**标题：**归来\r\n**大纲：**主角返乡。\r\n```'), [
    { title: '归来', description: '主角返乡。' },
  ])
  assert.deepEqual(parseChapterResponse('Title: Arrival\nOutline: Return home.\n\n标题：夜访\n大纲：追查失踪案。'), [
    { title: 'Arrival', description: 'Return home.' }, { title: '夜访', description: '追查失踪案。' },
  ])
  assert.deepEqual(parseChapterResponse('1. 归来\n主角返乡。\n\n2. 夜访\n追查失踪案。'), [
    { title: '归来', description: '主角返乡。' }, { title: '夜访', description: '追查失踪案。' },
  ])
  const longOutline = '完整的具体情节。'.repeat(100)
  assert.equal(parseChapterResponse(`章节1：\n标题：完整章\n大纲：${longOutline}`)[0].description, longOutline)
  for (const invalid of [
    '', '抱歉，无法生成章节大纲。' + '请补充背景。'.repeat(100),
    '抱歉，无法完成这个请求。\n\n请补充主角背景。\n以及故事矛盾。',
    '普通标题\n普通说明\n\n另一段\n另一段说明',
    '章节1：\n大纲：缺少标题', '标题：缺少大纲\n普通正文',
    `${batchResponse(1)}\n\n章节2：\n标题：缺少正文`,
    `${batchResponse(1)}\n\n${batchResponse(1)}`,
  ]) assert.deepEqual(parseChapterResponse(invalid), [], 'Malformed/refusal output cannot become an invented or partial chapter')
  console.log('✓ 中英文明确结构、markdown与多行大纲完整解析，拒绝任意段落/拒绝/不完整块')
}

async function testBatchFailureRetainsRawAndCanRetry() {
  for (const response of [
    '抱歉，缺少故事背景，无法生成章节大纲。' + '请补充主角背景和故事矛盾。'.repeat(40),
    batchResponse(2),
    `${batchResponse(2)}\n\n章节3：\n标题：没有大纲`,
  ]) {
    const f = fixture()
    f.controller.openBatch()
    f.controller.batchForm.value.plotRequirement = '保留用户要求'
    const generation = f.controller.generateBatch()
    f.stream.requests[0].resolve(response)
    assert.equal(await generation, false)
    assert.equal(f.persistCalls(), 0)
    assert.equal(f.chapters.value.length, 2)
    assert.equal(f.controller.batchVisible.value, true)
    assert.equal(f.controller.batchForm.value.plotRequirement, '保留用户要求')
    assert.equal(f.controller.streamingContent.value, response, 'The complete final response is retained without truncation')
    assert.ok(f.controller.batchError.value)
    assert.equal(f.messages.some(message => message.startsWith('success:')), false)
    if (response === batchResponse(2)) assert.match(f.controller.batchError.value, /期望生成3个章节，实际解析出2个章节/)
    const retry = f.controller.generateBatch()
    assert.equal(f.controller.batchError.value, '')
    f.stream.requests[1].resolve(batchResponse(3))
    assert.equal(await retry, true)
    assert.equal(f.persistCalls(), 1)
  }
  console.log('✓ 解析失败/数量不符不落盘，保留完整原文与可重试表单')
}

async function testRelevantContextChangesInvalidatePermanently() {
  const edits: Array<(chapters: WriterChapter[]) => void> = [
    chapters => { chapters[0].title = '修改标题'; chapters[0].title = '潮汐' },
    chapters => { chapters[0].description = '修改大纲'; chapters[0].description = '众人抵达港口' },
    chapters => { chapters.reverse(); chapters.reverse() },
    chapters => { chapters[0].id = 99; chapters[0].id = 1 },
  ]
  for (const edit of edits) {
    const f = fixture()
    f.controller.openBatch()
    const generation = f.controller.generateBatch()
    edit(f.chapters.value)
    f.stream.requests[0].resolve(batchResponse(3))
    assert.equal(await generation, false)
    assert.equal(f.persistCalls(), 0)
    assert.equal(f.chapters.value.length, 2)
  }
  console.log('✓ 章节身份、顺序、标题与大纲真实变更永久取消旧结果，改回也不能恢复')
}

async function testRealAutosaveDuringBatchGeneration() {
  let stored: WriterNovel[] = [{ id: 1, title: '小说', chapterList: [
    { id: 11, title: '前章', description: '既有大纲', content: '<p>旧正文</p>', wordCount: 3, status: 'draft' },
  ] }]
  let saves = 0
  const project = useWriterProject({
    novelStore: { worldSettings: [] }, notifyError: message => assert.fail(message), beforeUnloadTarget: null,
    persistence: { load: () => stored, save: async novels => { stored = novels; saves += 1 } },
  })
  await project.initNovel('1')
  const stream = fakeStream()
  const messages: string[] = []
  const controller = useWriterChapterOutlineGeneration({
    currentNovel: project.currentNovel, chapters: project.chapters, ensureApiReady: () => true,
    persist: project.saveNovelData, buildSinglePrompt: () => '单章请求', buildBatchPrompt: () => '生成三章',
    parseBatchResponse: parseChapterResponse, stream,
    notify: { success: message => messages.push(message), warning: message => messages.push(message), error: message => messages.push(message) },
  })
  try {
    project.content.value = '<p>刚刚补写的新正文。</p>'
    project.onContentChange()
    controller.openBatch()
    controller.useBatchPrompt({ id: 1, title: '已填充模板', category: 'outline', content: '模板' }, '用户的生成要求')
    const generation = controller.generateBatch()
    await new Promise(resolve => setTimeout(resolve, 2100))
    assert.ok(saves > 0, 'Exercise the real two-second editor autosave while the AI request is outstanding')
    assert.ok(project.chapters.value[0].wordCount! > 3)
    assert.equal(project.chapters.value[0].content, '<p>刚刚补写的新正文。</p>')
    assert.ok(controller.batchSelectedPrompt.value, 'Autosave metadata cannot invalidate the prepared outline prompt')
    stream.requests[0].resolve(batchResponse(3))
    assert.equal(await generation, true)
    assert.equal(project.chapters.value.length, 4)
    assert.equal(stored[0].chapterList!.length, 4)
    assert.equal(stored[0].chapterList![0].content, '<p>刚刚补写的新正文。</p>')
    assert.equal(messages.length, 1)
  } finally {
    controller.reset()
    await project.dispose()
  }
  console.log('✓ 真实正文2秒自动保存更新字数/正文/时间不再丢失批量章节结果')
}

async function main() {
  await testSingleSuccess()
  await testPersistenceRollback()
  await testCommitLockAndDeferredReset()
  await testDraftAndNovelRaces()
  await testRejectedPersistenceIsNormalized()
  await testRestartAfterUnsettledCancellation()
  await testBatchGeneration()
  testStrictParserFormatsAndFailure()
  await testBatchFailureRetainsRawAndCanRetry()
  await testRelevantContextChangesInvalidatePermanently()
  await testRealAutosaveDuringBatchGeneration()
  console.log('\n=== WRITER CHAPTER OUTLINE GENERATION TESTS PASSED ===')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
