import assert from 'node:assert/strict'
import { nextTick, ref } from 'vue'
import { useWriterOptimize } from '../src/composables/useWriterOptimize'
import { createAIRequestScope } from '../src/utils/aiRequestScope'
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
  })
  return { ...scope, isStreaming, streamingContent, pending } as any
}

function fixture(initialSelection = '选中的原文') {
  const stream = fakeStream()
  const messages: string[] = []
  const currentChapter = ref<any>({ id: 21, title: '第一章' })
  const content = ref('<p>选中的原文，以及其余正文。</p>')
  const hasUnsavedChanges = ref(false)
  const availablePrompts = ref<any[]>([
    { id: 1, title: '润色', category: 'polish', content: '提升画面感' },
    { id: 2, title: '人物', category: 'character', content: '生成人物' },
  ])
  let selection = initialSelection
  let editorHtml = content.value
  let insertCount = 0
  let saveCount = 0
  let saveResult = true
  let saveOperation = async () => saveResult
  let confirmCount = 0
  let confirmResult: Promise<unknown> = Promise.resolve()
  const controller = useWriterOptimize({
    currentChapter,
    content,
    hasUnsavedChanges,
    availablePrompts,
    ensureApiReady: () => true,
    saveCurrentChapter: () => { saveCount += 1; return saveOperation() },
    confirmFullReplace: () => { confirmCount += 1; return confirmResult },
    notify: {
      success: message => messages.push(`success:${message}`),
      info: message => messages.push(`info:${message}`),
      warning: message => messages.push(`warning:${message}`),
      error: message => messages.push(`error:${message}`),
    },
    writeText: async text => { messages.push(`copy:${text}`) },
    editor: {
      readSelection: () => selection,
      insertText: text => { insertCount += 1; editorHtml = `<p>${text}</p>` },
      getHtml: () => editorHtml,
    },
    stream,
  })
  return {
    controller, stream, messages, currentChapter, content, hasUnsavedChanges,
    insertCount: () => insertCount,
    saveCount: () => saveCount,
    confirmCount: () => confirmCount,
    setSelection: (value: string) => { selection = value },
    setSaveResult: (value: boolean) => {
      saveResult = value
      saveOperation = async () => saveResult
    },
    setSavePromise: (value: Promise<boolean>) => { saveOperation = () => value },
    setConfirmResult: (value: Promise<unknown>) => { confirmResult = value },
  }
}

async function main() {
  const generated = fixture()
  generated.controller.openFromEditor()
  assert.equal(generated.controller.form.value.mode, 'selection')
  assert.equal(generated.controller.form.value.originalContent, '选中的原文')
  assert.equal(generated.controller.prompts.value.length, 1)
  generated.controller.selectPrompt(generated.controller.prompts.value[0])
  assert.equal(generated.controller.form.value.customPrompt, '')
  generated.controller.form.value.customPrompt = '改成更克制的语气'
  await nextTick()
  assert.equal(generated.controller.form.value.selectedPrompt, null, '自定义要求应取代预设提示词')
  const starting = generated.controller.start()
  assert.match(generated.stream.pending[0].prompt, /改成更克制的语气/)
  assert.match(generated.stream.pending[0].prompt, /选中的原文/)
  generated.stream.pending[0].resolve('润色结果')
  await starting
  assert.equal(generated.controller.form.value.optimizedContent, '润色结果')
  assert.ok(generated.messages.includes('success:内容润色完成'))
  console.log('✓ 润色模式、提示词互斥和流式生成结果')

  const retry = fixture()
  retry.controller.openFromEditor()
  retry.controller.form.value.optimizedContent = '替换后的内容'
  retry.setSaveResult(false)
  await retry.controller.applySelection()
  assert.equal(retry.insertCount(), 1)
  assert.equal(retry.content.value, '<p>替换后的内容</p>')
  assert.equal(retry.controller.visible.value, true)
  retry.setSaveResult(true)
  await retry.controller.applySelection()
  assert.equal(retry.insertCount(), 1, '保存重试不能再次插入编辑器')
  assert.equal(retry.saveCount(), 2)
  assert.equal(retry.controller.visible.value, false)
  assert.equal(retry.hasUnsavedChanges.value, true)
  console.log('✓ 选区替换保存失败可重试，编辑器只应用一次')

  const guardedCommit = fixture()
  guardedCommit.controller.openFromEditor()
  guardedCommit.controller.form.value.optimizedContent = '不可取消的替换内容'
  const saveGate = deferred<boolean>()
  guardedCommit.setSavePromise(saveGate.promise)
  const applying = guardedCommit.controller.applySelection()
  const waiting = guardedCommit.controller.waitForCommit()
  assert.strictEqual(guardedCommit.controller.applySelection(), applying, '重复应用应复用同一个事务')
  assert.strictEqual(waiting, applying, 'waitForCommit 应等待完整应用事务')
  assert.equal(guardedCommit.controller.isCommitting.value, true)
  await Promise.resolve()
  assert.equal(guardedCommit.insertCount(), 1)
  assert.equal(guardedCommit.saveCount(), 1)
  assert.equal(guardedCommit.controller.reset(), false)
  guardedCommit.controller.visible.value = false
  assert.equal(guardedCommit.controller.visible.value, true, '保存期间直接关闭应被延迟')
  assert.equal(guardedCommit.controller.cancelAndClose(), false)
  assert.equal(guardedCommit.controller.form.value.optimizedContent, '不可取消的替换内容')
  let waitSettled = false
  void waiting.then(() => { waitSettled = true })
  await Promise.resolve()
  assert.equal(waitSettled, false, '路由等待不能越过未完成的保存')
  saveGate.resolve(true)
  assert.equal(await applying, true)
  assert.equal(await waiting, true)
  assert.equal(guardedCommit.controller.isCommitting.value, false)
  assert.equal(guardedCommit.controller.visible.value, false)
  assert.equal(guardedCommit.controller.form.value.optimizedContent, '')
  assert.equal(guardedCommit.content.value, '<p>不可取消的替换内容</p>')
  console.log('✓ 润色应用不可取消，重复点击复用事务并延迟重置和关闭')

  const rejectedCommit = fixture()
  rejectedCommit.controller.openFromEditor()
  rejectedCommit.controller.form.value.optimizedContent = '保存失败后重试'
  const rejectedSave = deferred<boolean>()
  rejectedCommit.setSavePromise(rejectedSave.promise)
  const rejectedApply = rejectedCommit.controller.applySelection()
  const rejectedWait = rejectedCommit.controller.waitForCommit()
  await Promise.resolve()
  assert.equal(rejectedCommit.controller.reset(), false)
  assert.equal(rejectedCommit.controller.cancelAndClose(), false)
  rejectedSave.reject(new Error('存储不可用'))
  assert.equal(await rejectedApply, false, '持久化 reject 应归一为 false')
  assert.equal(await rejectedWait, false)
  const rejectedAppliedContent = rejectedCommit.content.value
  assert.equal(rejectedCommit.controller.visible.value, true, '保存失败应取消延迟关闭以便重试')
  assert.equal(rejectedCommit.controller.form.value.optimizedContent, '保存失败后重试')
  assert.equal(rejectedCommit.controller.isCommitting.value, false)
  rejectedCommit.setSaveResult(true)
  assert.equal(await rejectedCommit.controller.applySelection(), true)
  assert.equal(rejectedCommit.content.value, rejectedAppliedContent, 'reject 后重试不能重复替换编辑器')
  assert.equal(rejectedCommit.insertCount(), 1)
  assert.equal(rejectedCommit.saveCount(), 2)
  console.log('✓ 润色持久化 reject 归一为 false，并保留原地重试状态')

  const changedSelection = fixture()
  changedSelection.controller.openFromEditor()
  changedSelection.controller.form.value.optimizedContent = '错误替换'
  changedSelection.setSelection('另一个选区')
  await changedSelection.controller.applySelection()
  assert.equal(changedSelection.insertCount(), 0)
  assert.match(changedSelection.messages.at(-1) || '', /^warning:原选择内容已变化/)
  console.log('✓ 选区变化时拒绝替换其他文本')

  const crossChapter = fixture('')
  crossChapter.controller.openFromEditor()
  crossChapter.controller.form.value.optimizedContent = '旧章节结果'
  const confirmation = deferred<void>()
  crossChapter.setConfirmResult(confirmation.promise)
  const applyingOldResult = crossChapter.controller.applyFull()
  crossChapter.currentChapter.value = { id: 22, title: '第二章' }
  confirmation.resolve()
  await applyingOldResult
  assert.equal(crossChapter.content.value, '<p>选中的原文，以及其余正文。</p>')
  assert.equal(crossChapter.saveCount(), 0)
  assert.deepEqual(crossChapter.messages, ['info:未检测到选择内容，将优化整篇文章'])
  console.log('✓ 全文确认期间切章不会污染新章节')

  const fullRetry = fixture('')
  fullRetry.controller.openFromEditor()
  fullRetry.controller.form.value.optimizedContent = '完整润色正文'
  fullRetry.setSaveResult(false)
  await fullRetry.controller.applyFull()
  const onceApplied = fullRetry.content.value
  fullRetry.setSaveResult(true)
  await fullRetry.controller.applyFull()
  assert.equal(fullRetry.content.value, onceApplied)
  assert.equal(fullRetry.confirmCount(), 1, '保存重试不应再次确认或重复格式化')
  assert.equal(fullRetry.saveCount(), 2)
  assert.equal(fullRetry.controller.visible.value, false)
  console.log('✓ 全文替换保存失败可直接重试且只应用一次')

  const stopped = fixture()
  stopped.controller.openFromEditor()
  stopped.controller.form.value.customPrompt = '润色'
  const stopping = stopped.controller.start()
  const stoppedRequest = stopped.stream.pending[0]
  stoppedRequest.callback?.('部分', '部分结果')
  stopped.controller.stop()
  assert.equal(stoppedRequest.signal.aborted, true)
  stoppedRequest.resolve('迟到完整结果')
  await stopping
  assert.equal(stopped.controller.form.value.optimizedContent, '部分结果')
  assert.equal(stopped.messages.some(message => message === 'success:内容润色完成'), false)
  console.log('✓ 停止润色保留部分结果并屏蔽迟到完成值')

  console.log('\n=== WRITER OPTIMIZE TESTS PASSED ===')
}

main().catch(error => { console.error(error); process.exit(1) })
