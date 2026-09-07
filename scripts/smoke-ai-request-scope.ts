/** 本地真实 SSE + 不合作的迟到回调，覆盖取消、作用域隔离及重新生成。 */
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { StreamCallback } from '../src/types/api'
import { createAIRequestScope, isAIRequestCancelled, type AIRequestState } from '../src/utils/aiRequestScope'

// Exercise the actual SDK's browser branch: its Node tracing path observes a
// completion promise that its browser path leaves unhandled on cancellation.
// Keep Node APIs available to the local SSE server, changing only runtime detection.
const originalRelease = Object.getOwnPropertyDescriptor(process, 'release')!
Object.defineProperty(process, 'release', { ...originalRelease, value: { ...process.release, name: 'browser' } })
const unhandledRejections: unknown[] = []
const recordUnhandledRejection = (error: unknown) => unhandledRejections.push(error)
process.on('unhandledRejection', recordUnhandledRejection)

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
}, configurable: true })

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('等待 Mock 响应超时')), 5000)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

type Connection = {
  body: { model: string; stream: boolean; messages: Array<{ role: string; content: string }> }
  send: (text: string) => void
  finish: () => void
  fail: () => void
  closed: ReturnType<typeof deferred>
  isClosed: boolean
}
const waiting = new Map<string, ReturnType<typeof deferred<Connection>>>()
const connections = new Map<string, Connection>()
let abortAll = () => {}
function connection(name: string): Promise<Connection> {
  if (connections.has(name)) return Promise.resolve(connections.get(name)!)
  const signal = deferred<Connection>()
  waiting.set(name, signal)
  return bounded(signal.promise)
}

const server = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', () => {
    const body = JSON.parse(raw) as Connection['body']
    const name = body.messages.at(-1)!.content
    const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
    const entry: Connection = {
      body,
      send: (text) => send({
        id: name, object: 'chat.completion.chunk', created: 1, model: body.model,
        choices: [{ index: 0, delta: { content: text } }],
      }),
      finish: () => {
        send({
          id: name, object: 'chat.completion.chunk', created: 1, model: body.model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        })
        res.end('data: [DONE]\n\n')
      },
      fail: () => {
        send({ error: { message: 'Mock 服务端生成失败', type: 'server_error' } })
        res.end('data: [DONE]\n\n')
      },
      closed: deferred(),
      isClosed: false,
    }
    res.on('close', () => {
      entry.isClosed = true
      entry.closed.resolve()
    })
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      res.flushHeaders()
    }
    connections.set(name, entry)
    waiting.get(name)?.resolve(entry)
    waiting.delete(name)
  })
})

async function main() {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const { useApiConfig } = await import('../src/services/apiConfig')
  useApiConfig().updateConfig({ provider: 'custom', apiKey: 'test-key', baseURL: `http://127.0.0.1:${port}/v1`, selectedModel: 'scope-model' })
  const apiService = (await import('../src/services/api')).default
  abortAll = () => apiService.abortActiveRequests()
  const { useAIStream } = await import('../src/composables/useAIStream')
  const a = useAIStream()
  const b = useAIStream()

  const chunkA = deferred()
  const chunkB = deferred()
  const resultA = a.generate('scope-a', { type: 'outline' }, () => chunkA.resolve())
  const rejectedA = assert.rejects(resultA, (error) => isAIRequestCancelled(error) && error.partialContent === 'A部分')
  const resultB = b.generate('scope-b', { type: 'chat' }, () => chunkB.resolve())
  const connA = await connection('scope-a')
  const connB = await connection('scope-b')
  connA.send('A部分')
  connB.send('B部分')
  await bounded(Promise.all([chunkA.promise, chunkB.promise]))
  a.stop('')
  assert.equal(a.streamingContent.value, 'A部分')
  assert.equal(a.isStreaming.value, false)
  assert.equal(b.isStreaming.value, true)
  assert.equal(connB.isClosed, false, '停止 A 不能取消 B 的网络连接')

  // 不等旧请求 finally 完成就重新生成。
  const newChunk = deferred()
  const restarted = a.generate('scope-restart', { type: 'content' }, () => newChunk.resolve())
  const connRestart = await connection('scope-restart')
  await bounded(rejectedA)
  await bounded(connA.closed.promise)
  assert.equal(a.isStreaming.value, true, '旧请求 finally 不能关闭新请求状态')
  assert.equal(a.streamingType.value, 'content')
  connRestart.send('新内容')
  await bounded(newChunk.promise)
  connRestart.finish()
  connB.send('完成')
  connB.finish()
  assert.equal(await bounded(restarted), '新内容')
  assert.equal(await bounded(resultB), 'B部分完成')
  assert.equal(a.streamingContent.value, '新内容')
  console.log('✓ 独立作用域、真实连接取消、部分内容保留及取消后立即重启')

  // SDK 外的供应商实现也可能继续调用增量回调，必须在作用域边界抑制。
  const pending: Array<{ callback: StreamCallback | null; result: ReturnType<typeof deferred<string>> }> = []
  let observed: AIRequestState = { isStreaming: false, streamingContent: '', streamingType: '' }
  const scope = createAIRequestScope((_prompt, _options, callback) => {
    const result = deferred<string>()
    pending.push({ callback, result })
    return result.promise
  }, (state) => { observed = state })
  const applied: string[] = []
  const old = scope.generate('old', { type: 'old' }, (chunk) => applied.push(chunk))
  const oldRejection = assert.rejects(old, (error) => isAIRequestCancelled(error) && error.partialContent === '保留')
  pending[0].callback?.('保留', '保留')
  scope.stop()
  const next = scope.generate('new', { type: 'new' }, (chunk) => applied.push(chunk))
  pending[1].callback?.('当前', '当前')
  pending[0].callback?.('迟到', '保留迟到')
  pending[0].result.resolve('保留迟到')
  await oldRejection
  assert.equal(observed.isStreaming, true)
  assert.equal(observed.streamingType, 'new')
  assert.equal(observed.streamingContent, '当前')
  assert.deepEqual(applied, ['保留', '当前'])
  pending[1].result.resolve('当前完成')
  assert.equal(await next, '当前完成')
  assert.equal(observed.isStreaming, false)
  console.log('✓ 取消后迟到增量/成功结果均被拒绝，旧 finally 不覆盖新状态')

  const assistant = useAIStream()
  const assistantChunk = deferred()
  const partial = assistant.run({ type: 'chat', prompt: 'assistant-partial', onChunk: () => assistantChunk.resolve() })
  const connAssistant = await connection('assistant-partial')
  connAssistant.send('未完成的回复')
  await bounded(assistantChunk.promise)
  assistant.stop('')
  assert.equal(await bounded(partial), '未完成的回复', 'run 保留助手已生成的回复')
  await bounded(connAssistant.closed.promise)
  const empty = assistant.run({ type: 'chat', prompt: 'assistant-empty' })
  const connEmpty = await connection('assistant-empty')
  assistant.dispose()
  assert.equal(await bounded(empty), null)
  await bounded(connEmpty.closed.promise)
  console.log('✓ 助手 run 中断保留部分回复，空回复/卸载静默取消')

  const controller = new AbortController()
  const nonStream = apiService.generateText('non-stream', { signal: controller.signal, model: 'override-model', system: '角色\n要求' })
  const nonStreamRejection = assert.rejects(nonStream, isAIRequestCancelled)
  const connNonStream = await connection('non-stream')
  assert.ok(!connNonStream.body.stream)
  assert.equal(connNonStream.body.model, 'override-model')
  assert.equal(connNonStream.body.messages[0].content, '角色\n要求')
  controller.abort()
  await bounded(nonStreamRejection)
  await bounded(connNonStream.closed.promise)
  console.log('✓ 非流式请求透传 signal 并真正取消连接，保留 system 换行和模型覆盖')

  const before = connections.size
  await assert.rejects(apiService.generateTextStream('already-aborted', { signal: AbortSignal.abort() }), isAIRequestCancelled)
  await assert.rejects(apiService.generateText('already-aborted-text', { signal: AbortSignal.abort() }), isAIRequestCancelled)
  assert.equal(connections.size, before, '预先取消的请求不能开始联网')
  const timeoutController = new AbortController()
  const timeoutRequest = a.generate('external-timeout', { signal: timeoutController.signal })
  const timeoutRejection = assert.rejects(timeoutRequest, (error) => {
    return error instanceof Error && error.name === 'TimeoutError' && !isAIRequestCancelled(error)
  })
  const connTimeout = await connection('external-timeout')
  timeoutController.abort(new DOMException('测试请求超时', 'TimeoutError'))
  await bounded(timeoutRejection)
  await bounded(connTimeout.closed.promise)
  assert.equal(a.isStreaming.value, false)
  const formattedPrompt = '章节\n\n\t第一节\r\n要求'
  const formatted = apiService.generateTextStream(`${formattedPrompt}\u0000`, { system: '系统\n规则\u0001' })
  const connFormatted = await connection(formattedPrompt)
  assert.equal(connFormatted.body.messages[0].content, '系统\n规则')
  connFormatted.send('完成')
  connFormatted.finish()
  assert.equal(await bounded(formatted), '完成')
  console.log('✓ 预取消不会联网，超时保持错误语义，提示词保留换行和缩进')

  const failedStream = a.generate('stream-error')
  const failedRejection = assert.rejects(failedStream, (error: unknown) => {
    return !isAIRequestCancelled(error) && !!error && typeof error === 'object' && 'message' in error
      && error.message === 'Mock 服务端生成失败'
  })
  const connFailed = await connection('stream-error')
  connFailed.send('残缺内容')
  connFailed.fail()
  await bounded(failedRejection)
  assert.equal(a.streamingContent.value, '残缺内容')
  assert.equal(a.isStreaming.value, false)
  console.log('✓ 服务端 SSE 错误不会把残缺内容当作成功结果自动应用')

  const allA = apiService.generateTextStream('abort-all-a')
  const allB = apiService.generateTextStream('abort-all-b')
  const rejects = Promise.all([assert.rejects(allA, isAIRequestCancelled), assert.rejects(allB, isAIRequestCancelled)])
  const globalA = await connection('abort-all-a')
  const globalB = await connection('abort-all-b')
  apiService.abortActiveRequests()
  await bounded(rejects)
  await bounded(Promise.all([globalA.closed.promise, globalB.closed.promise]))
  console.log('✓ 兼容全局中断可关闭所有并发请求')
  // Give all detached SDK continuations a turn before asserting, without
  // weakening the browser CI's separate pageerror = [] requirement.
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.deepEqual(unhandledRejections, [], '浏览器运行时取消/超时/服务端错误不能泄漏未处理的 Promise 拒绝')
  console.log('✓ SDK 浏览器运行时无未处理 Promise 拒绝（取消、超时及服务端错误）')
}

main().then(() => {
  console.log('\n=== AI REQUEST SCOPE TESTS PASSED ===')
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
}).finally(() => {
  abortAll()
  server.closeAllConnections()
  server.close()
  Object.defineProperty(process, 'release', originalRelease)
  process.off('unhandledRejection', recordUnhandledRejection)
})
