import assert from 'node:assert/strict'
import { ref } from 'vue'
import { useWriterContinue } from '../src/composables/useWriterContinue'
import { createAIRequestScope, isAIRequestCancelled } from '../src/utils/aiRequestScope'
import type { GenerateOptions, StreamCallback } from '../src/types/api'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function fakeStream() {
  const isStreaming = ref(false)
  const streamingContent = ref('')
  const streamingType = ref('')
  const pending: Array<{
    prompt: string
    options: GenerateOptions
    callback: StreamCallback | null
    signal: AbortSignal
    resolve: (value: string) => void
  }> = []
  const scope = createAIRequestScope((prompt, options, callback) => {
    const result = deferred<string>()
    pending.push({ prompt, options, callback, signal: options.signal!, resolve: result.resolve })
    return result.promise
  }, state => {
    isStreaming.value = state.isStreaming
    streamingContent.value = state.streamingContent
    streamingType.value = state.streamingType
  })
  return { ...scope, isStreaming, streamingContent, streamingType, pending } as any
}

function fixture() {
  const stream = fakeStream()
  const messages: string[] = []
  const currentNovel = ref<any>({ id: 1, title: '测试小说', genre: 'fantasy', description: '简介' })
  const currentChapter = ref<any>({ id: 11, title: '第一章', description: '大纲' })
  const content = ref(`<p>${'已有正文'.repeat(15)}</p>`)
  const characters = ref<any[]>([{ id: 1, name: '阿宁', personality: '果断' }])
  const hasUnsavedChanges = ref(false)
  let saveResult = true
  let saveCount = 0
  let saveOperation = async () => saveResult
  const controller = useWriterContinue({
    currentNovel,
    currentChapter,
    content,
    characters,
    hasUnsavedChanges,
    ensureApiReady: () => true,
    saveCurrentChapter: () => { saveCount += 1; return saveOperation() },
    describeGenre: () => '玄幻小说',
    notify: {
      success: message => messages.push(`success:${message}`),
      warning: message => messages.push(`warning:${message}`),
      error: message => messages.push(`error:${message}`),
    },
    writeText: async text => { messages.push(`copy:${text}`) },
    stream,
  })
  return {
    controller, stream, messages, currentChapter, content, hasUnsavedChanges,
    setSaveResult: (value: boolean) => {
      saveResult = value
      saveOperation = async () => saveResult
    },
    setSavePromise: (value: Promise<boolean>) => { saveOperation = () => value },
    saveCount: () => saveCount,
  }
}

async function main() {
  const generated = fixture()
  generated.controller.open()
  assert.equal(generated.controller.visible.value, true)
  assert.equal(generated.controller.canStart.value, true)
  assert.doesNotMatch(generated.controller.currentText.value, /<p>/)
  generated.controller.form.value.direction = '让主角发现线索'
  generated.controller.form.value.wordCount = 800
  const starting = generated.controller.start()
  const request = generated.stream.pending[0]
  assert.match(request.prompt, /小说类型：玄幻小说/)
  assert.match(request.prompt, /阿宁：果断/)
  assert.match(request.prompt, /续写长度约800字/)
  assert.match(request.prompt, /续写方向：让主角发现线索/)
  request.callback?.('续写', '续写正文')
  request.resolve('续写正文')
  await starting
  assert.equal(generated.controller.streamingContent.value, '续写正文')
  assert.deepEqual(generated.messages, ['success:续写完成'])
  console.log('✓ 续写生成使用纯文本上下文、人物信息、方向和字数')

  const retry = fixture()
  retry.controller.open()
  retry.controller.streamingContent.value = '第一段\n“对话”'
  retry.setSaveResult(false)
  await retry.controller.append()
  const afterFirstApply = retry.content.value
  assert.match(afterFirstApply, /<p>第一段<\/p><p class="dialogue">“对话”<\/p>/)
  assert.doesNotMatch(afterFirstApply, /<h3>/, '续写正文不能插入空标题')
  assert.equal(retry.hasUnsavedChanges.value, true)
  assert.equal(retry.controller.visible.value, true)
  retry.setSaveResult(true)
  await retry.controller.append()
  assert.equal(retry.content.value, afterFirstApply, '保存重试不能重复追加正文')
  assert.equal(retry.saveCount(), 2)
  assert.equal(retry.controller.visible.value, false)
  assert.deepEqual(retry.messages, ['success:续写内容已追加到文章'])
  console.log('✓ 续写追加保存失败可重试，正文只应用一次')

  const guardedCommit = fixture()
  guardedCommit.controller.open()
  guardedCommit.controller.form.value.direction = '保留到保存结束'
  guardedCommit.controller.streamingContent.value = '等待保存的续写'
  const saveGate = deferred<boolean>()
  guardedCommit.setSavePromise(saveGate.promise)
  const appending = guardedCommit.controller.append()
  const waiting = guardedCommit.controller.waitForCommit()
  assert.strictEqual(guardedCommit.controller.append(), appending, '重复追加应复用同一个事务')
  assert.strictEqual(waiting, appending, 'waitForCommit 应等待完整追加事务')
  assert.equal(guardedCommit.controller.isCommitting.value, true)
  assert.equal(guardedCommit.controller.reset(), false)
  guardedCommit.controller.visible.value = false
  assert.equal(guardedCommit.controller.visible.value, true, '保存期间直接关闭应被延迟')
  assert.equal(guardedCommit.controller.cancelAndClose(), false)
  assert.equal(guardedCommit.controller.form.value.direction, '保留到保存结束')
  assert.equal(guardedCommit.controller.streamingContent.value, '等待保存的续写')
  await Promise.resolve()
  assert.equal(guardedCommit.saveCount(), 1, '重复追加不能并发保存')
  let waitSettled = false
  void waiting.then(() => { waitSettled = true })
  await Promise.resolve()
  assert.equal(waitSettled, false, '路由等待不能越过未完成的保存')
  saveGate.resolve(true)
  assert.equal(await appending, true)
  assert.equal(await waiting, true)
  assert.equal(guardedCommit.controller.isCommitting.value, false)
  assert.equal(guardedCommit.controller.visible.value, false)
  assert.equal(guardedCommit.controller.form.value.direction, '')
  assert.equal(guardedCommit.controller.streamingContent.value, '')
  assert.match(guardedCommit.content.value, /等待保存的续写/, '延迟重置不能撤销已应用正文')
  console.log('✓ 续写提交不可取消，重复点击复用事务并延迟重置和关闭')

  const rejectedCommit = fixture()
  rejectedCommit.controller.open()
  rejectedCommit.controller.streamingContent.value = '保存失败后重试'
  const rejectedSave = deferred<boolean>()
  rejectedCommit.setSavePromise(rejectedSave.promise)
  const rejectedAppend = rejectedCommit.controller.append()
  const rejectedWait = rejectedCommit.controller.waitForCommit()
  await Promise.resolve()
  assert.equal(rejectedCommit.controller.reset(), false)
  assert.equal(rejectedCommit.controller.cancelAndClose(), false)
  rejectedSave.reject(new Error('存储不可用'))
  assert.equal(await rejectedAppend, false, '持久化 reject 应归一为 false')
  assert.equal(await rejectedWait, false)
  const rejectedAppliedContent = rejectedCommit.content.value
  assert.equal(rejectedCommit.controller.visible.value, true, '保存失败应取消延迟关闭以便重试')
  assert.equal(rejectedCommit.controller.streamingContent.value, '保存失败后重试')
  assert.equal(rejectedCommit.controller.isCommitting.value, false)
  rejectedCommit.setSaveResult(true)
  assert.equal(await rejectedCommit.controller.append(), true)
  assert.equal(rejectedCommit.content.value, rejectedAppliedContent, 'reject 后重试不能重复追加正文')
  assert.equal(rejectedCommit.saveCount(), 2)
  console.log('✓ 续写持久化 reject 归一为 false，并保留原地重试状态')

  const switched = fixture()
  switched.controller.open()
  switched.controller.streamingContent.value = '旧章节续写'
  const oldContent = switched.content.value
  switched.currentChapter.value = { id: 12, title: '第二章' }
  await switched.controller.append()
  assert.equal(switched.content.value, oldContent)
  assert.match(switched.messages[0], /^warning:章节已切换/)
  console.log('✓ 章节切换后拒绝把旧续写写入新章节')

  const cancelled = fixture()
  cancelled.controller.open()
  const late = cancelled.controller.start()
  const lateRequest = cancelled.stream.pending[0]
  lateRequest.callback?.('部分', '部分')
  cancelled.controller.reset()
  assert.equal(lateRequest.signal.aborted, true)
  lateRequest.callback?.('迟到', '迟到结果')
  lateRequest.resolve('迟到结果')
  await late.catch(isAIRequestCancelled)
  assert.equal(cancelled.controller.streamingContent.value, '')
  assert.deepEqual(cancelled.messages, [])
  console.log('✓ 关闭续写对话框会取消请求并屏蔽迟到结果')

  console.log('\n=== WRITER CONTINUE TESTS PASSED ===')
}

main().catch(error => { console.error(error); process.exit(1) })
