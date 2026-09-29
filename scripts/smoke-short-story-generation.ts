import assert from 'node:assert/strict'
import { ref } from 'vue'
import { useShortStoryGeneration, type ShortStoryOperation } from '../src/composables/useShortStoryGeneration'
import { createAIRequestScope } from '../src/utils/aiRequestScope'
import type { GenerateOptions, StreamCallback } from '../src/types/api'

const kinds: ShortStoryOperation[] = ['article', 'story', 'continue', 'optimize']

function fakeStream(scoped = false) {
  const requests: Array<{
    callback?: StreamCallback | null
    signal?: AbortSignal
    resolve(value: string): void
    reject(error: Error): void
  }> = []
  let stops = 0
  const generate = (_prompt: string, options: GenerateOptions = {}, callback?: StreamCallback | null) =>
    new Promise<string>((resolve, reject) => requests.push({ callback, signal: options.signal, resolve, reject }))
  const scope = createAIRequestScope(generate, () => {})
  return {
    requests,
    generate: scoped ? scope.generate : generate,
    stop: () => { stops++; if (scoped) scope.stop() },
    get stops() { return stops },
  }
}

function fixture(scoped = false) {
  const storyContent = ref('<p>原文</p>')
  const streams = Object.fromEntries(kinds.map(kind => [kind, fakeStream(scoped)])) as Record<ShortStoryOperation, ReturnType<typeof fakeStream>>
  const messages: string[] = []
  const controller = useShortStoryGeneration({
    storyContent, streams,
    notify: {
      success: text => messages.push(`success:${text}`),
      error: text => messages.push(`error:${text}`),
      warning: text => messages.push(`warning:${text}`),
    },
  })
  const request = { prompt: '合成测试请求', successMessage: '完成', errorPrefix: '失败' }
  return { controller, streams, messages, storyContent, request }
}

// Exercise hostile transports too: ignoring abort must never regain ownership.
for (const kind of kinds) {
  const f = fixture()
  let editor = ''
  const queued: Array<() => void> = []
  const request = { ...f.request, onText: (text: string, current: () => boolean) => {
    queued.push(() => { if (current()) editor = text })
  } }
  const oldRun = f.controller.start(kind, request)
  const old = f.streams[kind].requests[0]!
  old.callback?.('旧', '旧片段')
  f.controller.stop(kind)
  assert.equal(f.controller.states[kind].text, '旧片段', 'Stopping retains partial text')
  assert.equal(f.controller.canUseResult(kind), false)
  const freshRun = f.controller.start(kind, request)
  const fresh = f.streams[kind].requests[1]!
  fresh.callback?.('新', '新片段')
  old.callback?.('迟到', '过期内容')
  old.resolve('过期完成结果')
  assert.equal(await oldRun, false)
  assert.equal(f.controller.states[kind].running, true, 'Old finally cannot release a new run')
  assert.equal(f.controller.states[kind].text, '新片段')
  queued.shift()!()
  assert.equal(editor, '', 'Queued editor updates lose ownership on restart')
  assert.deepEqual(f.messages, [])
  fresh.resolve('最终新内容')
  assert.equal(await freshRun, true)
  queued.forEach(update => update())
  assert.equal(editor, '最终新内容')
  assert.equal(f.controller.canUseResult(kind), true)
  fresh.callback?.('不合法的后续回调', '完成后不能覆盖')
  assert.equal(f.controller.states[kind].text, '最终新内容')
  assert.deepEqual(f.messages, ['success:完成'])
  f.controller.dispose()
}
console.log('✓ All four operations reject late chunks, completions, finally and queued editor updates after restart')

for (const kind of kinds) {
  const f = fixture(true)
  const run = f.controller.start(kind, f.request)
  const pending = f.streams[kind].requests[0]!
  assert.equal(pending.signal?.aborted, false)
  pending.callback?.('部分', '部分内容')
  f.controller.stop(kind)
  assert.equal(pending.signal?.aborted, true, 'Stopping must abort the real request scope')
  pending.resolve('不能当作成功')
  assert.equal(await run, false)
  assert.equal(f.controller.states[kind].text, '部分内容')
  assert.deepEqual(f.messages, [])
  f.controller.dispose()
}
console.log('✓ Cancellation aborts the transport, keeps partial text and never reports success')

for (const kind of ['continue', 'optimize'] as const) {
  const f = fixture()
  const run = f.controller.start(kind, f.request)
  const old = f.streams[kind].requests[0]!
  f.controller.stop(kind) // The dialog close watcher uses the same boundary.
  const freshRun = f.controller.start(kind, f.request)
  old.reject(new Error('关闭前的迟到错误'))
  await run
  assert.deepEqual(f.messages, [])
  assert.equal(f.controller.states[kind].running, true)
  f.streams[kind].requests[1]!.resolve('重新打开的结果')
  await freshRun
  assert.equal(f.controller.canUseResult(kind), true)
  f.storyContent.value = '<p>用户修改后的正文</p>'
  assert.equal(f.controller.canUseResult(kind), false, 'Editing the source invalidates completed results')
  const rejected = await f.controller.start(kind, { ...f.request, sourceContent: '<p>原文</p>' })
  assert.equal(rejected, false)
  assert.equal(f.streams[kind].requests.length, 2)
  f.controller.dispose()
}
console.log('✓ Closing and reopening dialogs silences late failures; changed source invalidates old results')

{
  const f = fixture(true)
  const continuing = f.controller.start('continue', f.request)
  const optimizing = f.controller.start('optimize', f.request)
  const article = f.controller.start('article', f.request)
  const story = f.controller.start('story', f.request)
  assert.equal(f.streams.continue.requests[0]!.signal?.aborted, true)
  assert.equal(f.streams.optimize.requests[0]!.signal?.aborted, true)
  assert.equal(f.streams.article.requests[0]!.signal?.aborted, false, 'Independent article generation keeps ownership')
  assert.equal(await f.controller.start('continue', f.request), false)
  f.streams.continue.requests[0]!.resolve('过期续写')
  f.streams.optimize.requests[0]!.resolve('过期优化')
  f.streams.article.requests[0]!.resolve('短文')
  f.streams.story.requests[0]!.resolve('正文')
  assert.deepEqual(await Promise.all([continuing, optimizing, article, story]), [false, false, true, true])
  f.controller.dispose()
}
console.log('✓ Replacing the story cancels derived operations without interrupting independent articles')

for (const kind of kinds) {
  const f = fixture(true)
  const run = f.controller.start(kind, f.request)
  f.controller.dispose()
  f.controller.dispose()
  const pending = f.streams[kind].requests[0]!
  assert.equal(pending.signal?.aborted, true)
  pending.callback?.('迟到', '卸载后内容')
  pending.resolve('卸载后结果')
  assert.equal(f.controller.states[kind].running, false)
  assert.equal(f.controller.states[kind].text, '')
  assert.equal(await f.controller.start(kind, f.request), false)
  assert.equal(await run, false)
  assert.deepEqual(f.messages, [])
}
console.log('✓ Unmount aborts every scope and prevents future writes, notifications and starts')

{
  const f = fixture()
  const editing = f.controller.start('optimize', f.request)
  f.storyContent.value = '<p>新正文</p>'
  f.streams.optimize.requests[0]!.resolve('不能替换新正文')
  assert.equal(await editing, false)
  assert.equal(f.controller.states.optimize.running, false)
  assert.equal(f.controller.canUseResult('optimize'), false)
  const failing = f.controller.start('story', f.request)
  f.streams.story.requests[0]!.reject(new Error('服务不可用'))
  assert.equal(await failing, false)
  const empty = f.controller.start('story', f.request)
  f.streams.story.requests[1]!.resolve('  ')
  assert.equal(await empty, false)
  assert.deepEqual(f.messages, ['error:失败: 服务不可用', 'error:失败: AI返回内容为空'])
  assert.equal(f.controller.states.story.running, false)
  f.controller.dispose()
}
console.log('✓ Source edits cancel in-flight results; genuine errors and empty responses remain retryable')
