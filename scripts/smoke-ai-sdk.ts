/**
 * AI SDK 集成冒烟测试（无需真实 API Key）：
 * 启动本地 OpenAI 兼容 Mock 服务器，验证 流式解析 / 中断恢复 / 计费挂钩 / 连接测试。
 * 运行：npx tsx scripts/smoke-ai-sdk.ts
 */
import http from 'node:http'
import assert from 'node:assert'

// ---- localStorage stub（浏览器 API，Node 环境需要手动提供） ----
const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
}

const PORT = 8787
/** 最近一次 /chat/completions 请求体（供透传断言使用） */
let lastChatBody: Record<string, unknown> | null = null

function startMockServer(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization

    if (req.method === 'GET' && req.url?.endsWith('/models')) {
      if (auth === 'Bearer test-key') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }))
      } else {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'invalid key' } }))
      }
      return
    }

    if (req.method === 'POST' && req.url?.endsWith('/chat/completions')) {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const parsed = JSON.parse(body)
        lastChatBody = parsed
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
        const chunk = (content: string) => ({
          id: '1',
          object: 'chat.completion.chunk',
          created: 1,
          model: parsed.model,
          choices: [{ index: 0, delta: { content } }],
        })

        if (parsed.model === 'hang-model') {
          // 中断测试用：发出部分内容后挂起
          send(chunk('你好'))
          send(chunk('，世界'))
          return
        }

        send(chunk('春眠'))
        send(chunk('不觉晓'))
        send({
          id: '1',
          object: 'chat.completion.chunk',
          created: 1,
          model: parsed.model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 12, completion_tokens: 5 },
        })
        res.end('data: [DONE]\n\n')
      })
      return
    }

    res.writeHead(404)
    res.end()
  })

  return new Promise((resolve) => {
    server.listen(PORT, '127.0.0.1', () => resolve(server))
  })
}

async function main() {
  const server = await startMockServer()

  const { useApiConfig } = await import('../src/services/apiConfig')
  const apiService = (await import('../src/services/api')).default
  const billingService = (await import('../src/services/billing')).default

  useApiConfig().updateConfig({
    provider: 'custom',
    apiKey: 'test-key',
    baseURL: `http://127.0.0.1:${PORT}/v1`,
    selectedModel: 'mock-model',
  })

  // ---- 测试 1：流式生成 + 增量回调 ----
  let lastFull = ''
  const result1 = await apiService.generateTextStream('写一首诗', {}, (_chunk, full) => {
    lastFull = full
  })
  assert.strictEqual(result1, '春眠不觉晓', '流式最终内容不符')
  assert.strictEqual(lastFull, '春眠不觉晓', '增量回调内容不符')
  console.log('✓ 测试1 通过：流式生成与增量回调')

  // ---- 测试 2：SDK 透传真实 usage 到计费 ----
  const records = billingService.getBillingRecords()
  assert.ok(records.length >= 1, '应有计费记录')
  const last = records[0]
  assert.strictEqual(last.inputTokens, 12, '应记录真实 inputTokens（来自 usage）')
  assert.strictEqual(last.outputTokens, 5, '应记录真实 outputTokens（来自 usage）')
  console.log('✓ 测试2 通过：真实 usage 进入计费台账')

  // ---- 测试 3：连接测试（正确密钥 / 错误密钥） ----
  assert.strictEqual(await apiService.validateAPIKey(), true, '正确密钥应探活成功')
  useApiConfig().updateConfig({ apiKey: 'bad-key' })
  assert.strictEqual(await apiService.validateAPIKey(), false, '错误密钥应探活失败')
  useApiConfig().updateConfig({ apiKey: 'test-key' })
  console.log('✓ 测试3 通过：连接测试（密钥校验）')

  // ---- 测试 4：中断 → 可识别的取消结果，保留部分内容 ----
  useApiConfig().updateConfig({ selectedModel: 'hang-model' })
  const partialPromise = apiService.generateTextStream('测试中断', {}, (_chunk, full) => {
    if (full === '你好，世界') apiService.abortActiveRequests()
  })
  const { isAIRequestCancelled } = await import('../src/utils/aiRequestScope')
  await assert.rejects(partialPromise, (error) => {
    return isAIRequestCancelled(error) && error.partialContent === '你好，世界'
  }, '中断应抛出取消异常并保留部分内容，不能继续执行成功分支')
  console.log('✓ 测试4 通过：中断后保留部分内容且不会返回成功')

  // ---- 测试 5：模型列表拉取 ----
  const { fetchProviderModels } = await import('../src/services/aiProviders')
  useApiConfig().updateConfig({ provider: 'custom', apiKey: 'test-key', baseURL: `http://127.0.0.1:${PORT}/v1`, selectedModel: 'mock-model' })
  const models = await fetchProviderModels(useApiConfig().activeConfig.value)
  assert.deepStrictEqual(models, ['mock-model'], '应从 /models 端点拉取到模型列表')
  useApiConfig().setProviderModels('custom', models)
  assert.deepStrictEqual(useApiConfig().providerModels.value['custom'], ['mock-model'], '模型列表应进入响应式缓存')
  console.log('✓ 测试5 通过：模型列表拉取与缓存')

  // ---- 测试 6：拉取失败（错误密钥） ----
  useApiConfig().updateConfig({ apiKey: 'bad-key' })
  await assert.rejects(
    () => fetchProviderModels(useApiConfig().activeConfig.value),
    /HTTP 401/,
    '错误密钥应抛出 HTTP 401 错误',
  )
  useApiConfig().updateConfig({ apiKey: 'test-key' })
  console.log('✓ 测试6 通过：拉取失败的错误处理')

  // ---- 测试 7：配置持久化 ----
  const saved = JSON.parse(store.get('apiConfig') ?? '{}')
  assert.strictEqual(saved.provider, 'custom', '配置应持久化到 storage 层')
  console.log('✓ 测试7 通过：配置持久化')

  // ---- 测试 8：system 提示词 + messages 多轮载荷透传 ----
  lastChatBody = null
  await apiService.generateTextStream('', {
    system: '你是一位毒舌编辑',
    messages: [
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
      { role: 'user', content: '第二问' },
    ],
  })
  assert.ok(lastChatBody, '应捕获到请求体')
  const bodyMessages = (lastChatBody as { messages?: Array<{ role: string; content: string }> }).messages ?? []
  assert.strictEqual(bodyMessages[0]?.role, 'system', 'system 应作为首条消息发送')
  assert.ok(bodyMessages[0]?.content.includes('毒舌编辑'), 'system 内容应包含人设')
  assert.strictEqual(bodyMessages.length, 4, 'system + 3 条历史消息')
  assert.strictEqual(bodyMessages[3]?.role, 'user', '最后一条应为用户消息')
  console.log('✓ 测试8 通过：system 与 messages 透传')

  // ---- 测试 9：chatWithAI 自定义人设参数 ----
  lastChatBody = null
  const chatReply = await apiService.chatWithAI('帮我构思', [], '你是一个情节构思专家')
  assert.strictEqual(chatReply, '春眠不觉晓', 'chatWithAI 应走流式路径返回内容')
  const chatBody = lastChatBody as { messages?: Array<{ role: string; content: string }> } | null
  assert.ok(chatBody?.messages?.[0]?.content.includes('情节构思专家'), 'chatWithAI 第三参数应替换默认人设')
  console.log('✓ 测试9 通过：chatWithAI 自定义人设')

  // ---- 测试 10：代理前缀生效（请求经代理 URL 到达同一 mock） ----
  useApiConfig().updateConfig({
    provider: 'custom',
    apiKey: 'test-key',
    baseURL: 'https://backend.example.com/v1',
    selectedModel: 'mock-model',
    proxyUrl: `http://127.0.0.1:${PORT}/proxy/`,
  })
  const proxiedProbe = await apiService.validateAPIKey()
  assert.strictEqual(proxiedProbe, true, '探活应经代理前缀命中 mock 的 /models')
  const proxiedReply = await apiService.generateTextStream('经代理生成', {}, null)
  assert.strictEqual(proxiedReply, '春眠不觉晓', '对话应经代理前缀命中 mock 的 /chat/completions')
  console.log('✓ 测试10 通过：代理前缀拼接生效')

  server.close()
}

main()
  .then(() => {
    console.log('\n=== ALL SMOKE TESTS PASSED ===')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n=== SMOKE TEST FAILED ===')
    console.error(error)
    process.exit(1)
  })
