/** Actual SDK request-body regression; all traffic is restricted to a local mock server. */
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { ApiConfig, GenerateOptions } from '../src/types/api'

const disk = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => disk.get(key) ?? null,
    setItem: (key: string, value: string) => void disk.set(key, value),
    removeItem: (key: string) => void disk.delete(key),
    clear: () => disk.clear(),
  },
})

type Body = Record<string, any>
interface CapturedRequest { url: string; body: Body; headers: http.IncomingHttpHeaders }
const captured: CapturedRequest[] = []
const reply = '预算测试正文'
let retryResponsesRemaining = 0

async function startServer(): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    try {
      const url = req.url ?? ''
      if (req.method === 'GET' && url.endsWith('/models')) {
        captured.push({ url, body: {}, headers: req.headers })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'qwen3.8-flash' }, { id: 'gateway-model-alias' }] }))
        return
      }
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Body
      captured.push({ url, body, headers: req.headers })
      if (retryResponsesRemaining > 0) {
        retryResponsesRemaining--
        res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '0' })
        res.end(JSON.stringify({ error: { message: 'Temporary local retry fixture', type: 'server_error' } }))
        return
      }
      if (url.endsWith('/chat/completions')) {
        const common = { id: 'budget-test', created: 1, model: body.model }
        const usage = { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
        if (body.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          const send = (value: unknown) => res.write(`data: ${JSON.stringify(value)}\n\n`)
          send({ ...common, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: reply } }] })
          send({ ...common, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
          send({ ...common, object: 'chat.completion.chunk', choices: [], usage })
          res.end('data: [DONE]\n\n')
        } else {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            ...common, object: 'chat.completion', usage,
            choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
          }))
        }
      } else if (url.endsWith('/messages')) {
        const message = {
          id: 'budget-test', type: 'message', role: 'assistant', model: body.model,
          content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', stop_sequence: null,
          usage: { input_tokens: 12, output_tokens: 8 },
        }
        if (body.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          const send = (event: Body) => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
          send({ type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 12, output_tokens: 0 } } })
          send({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
          send({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply } })
          send({ type: 'content_block_stop', index: 0 })
          send({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } })
          send({ type: 'message_stop' })
          res.end()
        } else {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify(message))
        }
      } else if (url.includes(':generateContent') || url.includes(':streamGenerateContent')) {
        const response = {
          candidates: [{ content: { role: 'model', parts: [{ text: reply }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8, totalTokenCount: 20 },
        }
        if (url.includes(':streamGenerateContent')) {
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          res.end(`data: ${JSON.stringify(response)}\n\n`)
        } else {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify(response))
        }
      } else {
        res.writeHead(404)
        res.end(JSON.stringify({ error: `Unexpected endpoint: ${url}` }))
      }
    } catch (error) {
      res.writeHead(500)
      res.end(JSON.stringify({ error: String(error) }))
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return server
}

function assertReasoning(body: Body, expected: Body, label: string) {
  for (const field of ['thinking', 'reasoning_effort', 'enable_thinking', 'thinking_budget']) {
    if (field in expected) assert.deepEqual(body[field], expected[field], `${label}: ${field}`)
    else assert.equal(field in body, false, `${label}: must omit ${field}`)
  }
}

async function main() {
  // A fresh process proves the persisted settings survive module initialization.
  if (process.argv.includes('--verify-reload')) {
    const saved = process.env.GENERATION_BUDGET_SAVED_CONFIG!
    disk.set('apiConfig', saved)
    const { useApiConfig } = await import('../src/services/apiConfig')
    const loaded = useApiConfig().activeConfig.value
    const expected = JSON.parse(saved) as ApiConfig
    for (const field of ['provider', 'baseURL', 'selectedModel', 'proxyUrl', 'thinkingProtocol', 'thinkingMode', 'thinkingBudget', 'thinkingEffort', 'maxTokens', 'unlimitedTokens'] as const) {
      assert.deepEqual(loaded[field], expected[field], `reload preserves ${field}`)
    }
    return
  }

  const server = await startServer()
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  const realFetch = globalThis.fetch
  let fetches = 0
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    assert.equal(new URL(url).origin, origin, 'This suite must never contact a paid/external API')
    fetches++
    return realFetch(input, init)
  }

  try {
    const { useApiConfig } = await import('../src/services/apiConfig')
    const { buildModelsProbe, fetchProviderModels, getPreset } = await import('../src/services/aiProviders')
    const apiService = (await import('../src/services/api')).default
    const { getThinkingCapability } = await import('../src/utils/generationBudget')
    const state = useApiConfig()
    const base: ApiConfig = {
      provider: 'custom', apiKey: 'local-test-key', baseURL: 'https://mock.invalid/v1',
      selectedModel: 'plain-chat-model', proxyUrl: `${origin}/proxy/`, customHeaders: {},
      maxTokens: 12288, unlimitedTokens: false, temperature: 0.7,
      thinkingProtocol: 'auto', thinkingMode: 'default', thinkingBudget: 4096, thinkingEffort: 'medium',
    }
    for (const provider of ['custom', 'groq']) {
      const hostedQwen = { ...base, provider, selectedModel: 'qwen/qwen3-32b' }
      assert.deepEqual(getThinkingCapability(hostedQwen).modes.map(mode => mode.value), ['default'], `${provider} Qwen must not assume DashScope controls`)
      assert.ok(getThinkingCapability({ ...hostedQwen, thinkingProtocol: 'qwen' }).modes.some(mode => mode.value === 'budget'), 'explicit Qwen protocol enables confirmed gateway controls')
    }
    for (const config of [
      { ...base, provider: 'qwen', selectedModel: 'qwen3.6-plus' },
      { ...base, selectedModel: 'qwen3.6-plus', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    ]) assert.ok(getThinkingCapability(config).modes.some(mode => mode.value === 'budget'), 'known DashScope endpoints support Qwen budgets')
    for (const selectedModel of ['claude-3-opus-20240229', 'claude-3-haiku-20240307', 'native-claude-alias']) {
      assert.deepEqual(getThinkingCapability({ ...base, provider: 'anthropic', selectedModel }).modes.map(mode => mode.value), ['default'], `${selectedModel} must not expose unconfirmed thinking controls`)
    }
    for (const selectedModel of ['qwen3.8-flash', 'gateway-model-alias']) {
      const native = { ...base, provider: 'anthropic', selectedModel }
      assert.deepEqual(getThinkingCapability(native).modes.map(mode => mode.value), ['default'], 'native gateways must not infer controls from non-Claude model names')
      const explicit = getThinkingCapability({ ...native, thinkingProtocol: 'anthropic' })
      assert.deepEqual(explicit.modes.map(mode => mode.value), ['default', 'disabled', 'budget'], 'an explicit native format enables manual gateway thinking')
      assert.equal(explicit.budgetMin, 1024)
      assert.deepEqual(getThinkingCapability({ ...native, thinkingProtocol: 'qwen' }).modes.map(mode => mode.value), ['default'], 'DashScope overrides must not enable fields on the native Anthropic transport')
    }
    for (const selectedModel of ['claude-3-opus-20240229', 'claude-3-haiku-20240307']) {
      assert.deepEqual(getThinkingCapability({ ...base, provider: 'anthropic', selectedModel, thinkingProtocol: 'anthropic' }).modes.map(mode => mode.value), ['default'], 'manual gateway format must preserve known legacy Claude restrictions')
    }
    async function request(patch: Partial<ApiConfig>, stream = false, options: GenerateOptions = {}): Promise<CapturedRequest> {
      state.updateConfig({ ...base, ...patch })
      const before = captured.length
      let visible = ''
      const text = stream
        ? await apiService.generateTextStream('验证实际请求参数', options, (_chunk, full) => { visible = full })
        : await apiService.generateText('验证实际请求参数', options)
      assert.equal(text, reply)
      if (stream) assert.equal(visible, reply, 'streaming callback receives body text')
      assert.equal(captured.length, before + 1, 'one SDK request per generation')
      const wire = captured.at(-1)!
      if (patch.proxyUrl !== '') assert.ok(wire.url.startsWith('/proxy/https://'), 'native and compatible presets must use the configured proxy')
      return wire
    }

    const compatibleCases: Array<{ name: string; config: Partial<ApiConfig>; expected: Body; capField?: string }> = [
      { name: 'OpenAI GPT effort', config: { provider: 'openai', selectedModel: 'gpt-5.4', thinkingMode: 'effort', thinkingEffort: 'high' }, expected: { reasoning_effort: 'high' }, capField: 'max_completion_tokens' },
      { name: 'OpenAI o-series effort', config: { provider: 'openai', selectedModel: 'o3', thinkingMode: 'effort', thinkingEffort: 'high' }, expected: { reasoning_effort: 'high' }, capField: 'max_completion_tokens' },
      { name: 'DeepSeek V4 effort', config: { provider: 'deepseek', selectedModel: 'deepseek-v4-pro', thinkingMode: 'effort', thinkingEffort: 'max' }, expected: { thinking: { type: 'enabled' }, reasoning_effort: 'max' } },
      { name: 'DeepSeek disabled', config: { provider: 'deepseek', selectedModel: 'deepseek-v4-flash', thinkingMode: 'disabled' }, expected: { thinking: { type: 'disabled' } } },
      { name: 'GLM 5.3 effort', config: { provider: 'zhipu', selectedModel: 'glm-5.3', thinkingMode: 'effort', thinkingEffort: 'high' }, expected: { thinking: { type: 'enabled' }, reasoning_effort: 'high' } },
      { name: 'MiMo enabled', config: { selectedModel: 'mimo-v2-pro', thinkingMode: 'enabled' }, expected: { thinking: { type: 'enabled' } }, capField: 'max_completion_tokens' },
      { name: 'MiMo disabled', config: { selectedModel: 'mimo-v2-pro', thinkingMode: 'disabled' }, expected: { thinking: { type: 'disabled' } }, capField: 'max_completion_tokens' },
      { name: 'Qwen exact budget', config: { provider: 'qwen', selectedModel: 'qwen3.6-plus', thinkingMode: 'budget', thinkingBudget: 2048 }, expected: { enable_thinking: true, thinking_budget: 2048 } },
      { name: 'Qwen disabled', config: { provider: 'qwen', selectedModel: 'qwen3.6-plus', thinkingMode: 'disabled' }, expected: { enable_thinking: false } },
      { name: 'explicit protocol for a gateway alias', config: { selectedModel: 'gateway-model-alias', thinkingProtocol: 'deepseek', thinkingMode: 'effort', thinkingEffort: 'high' }, expected: { thinking: { type: 'enabled' }, reasoning_effort: 'high' } },
    ]
    for (const stream of [false, true]) {
      for (const scenario of compatibleCases) {
        const label = `${scenario.name} (${stream ? 'stream' : 'nonstream'})`
        const { body } = await request(scenario.config, stream)
        assertReasoning(body, scenario.expected, label)
        const capField = scenario.capField ?? 'max_tokens'
        assert.equal(body[capField], 12288, `${label}: exact total output cap`)
        assert.equal(capField === 'max_tokens' ? 'max_completion_tokens' in body : 'max_tokens' in body, false, `${label}: omit obsolete/incorrect cap field`)
      }
    }
    console.log('✓ Compatible providers serialize thinking and total caps through the actual SDK in both generation paths')

    for (const stream of [false, true]) {
      for (const selectedModel of ['plain-chat-model', 'gpt-5.4', 'deepseek-v4-pro', 'mimo-v2-pro', 'qwen3.6-plus', 'glm-5.3']) {
        const { body } = await request({ selectedModel }, stream)
        assertReasoning(body, {}, `${selectedModel}: provider default`)
      }
      for (const cap of [{ maxTokens: null }, { unlimitedTokens: true }, { maxTokens: null, unlimitedTokens: true }]) {
        const { body } = await request(cap, stream)
        assert.equal('max_tokens' in body, false, 'provider-default output cap is omitted')
        assert.equal('max_completion_tokens' in body, false, 'no alternate output cap is synthesized')
      }
      const override = await request({ unlimitedTokens: true }, stream, { maxTokens: 2048 })
      assert.equal(override.body.max_tokens, 2048, 'an explicit per-request cap overrides global unlimited mode')
      const inherited = await request({}, stream, { maxTokens: null })
      assert.equal(inherited.body.max_tokens, 12288, 'legacy null per-request cap inherits configured total')
      const separateBudget = await request({ provider: 'qwen', selectedModel: 'qwen3.6-plus', thinkingMode: 'budget', thinkingBudget: 4096, maxTokens: 2048 }, stream)
      assert.equal(separateBudget.body.thinking_budget, 4096, 'Qwen thinking allocation is separate from its visible output cap')
      assert.equal(separateBudget.body.max_tokens, 2048)
      const modelOverride = await request({ selectedModel: 'deepseek-v4-pro', thinkingMode: 'effort', thinkingEffort: 'high' }, stream, { model: 'gpt-5.4' })
      assert.equal(modelOverride.body.reasoning_effort, 'high', 'resolve reasoning against the effective request model')
      assert.equal(modelOverride.body.max_completion_tokens, 12288)
      assert.equal('max_tokens' in modelOverride.body, false)
    }
    console.log('✓ Provider defaults, unlimited mode, per-request caps and model overrides preserve their wire semantics')

    const claude = await request({ provider: 'anthropic', selectedModel: 'claude-sonnet-4-5', thinkingMode: 'budget', thinkingBudget: 4096 })
    assert.ok(claude.url.endsWith('/messages'))
    assert.deepEqual(claude.body.thinking, { type: 'enabled', budget_tokens: 4096 })
    assert.equal(claude.body.max_tokens, 12288, 'SDK must not add the thinking allocation on top of the configured total')
    assert.equal('max_completion_tokens' in claude.body, false)
    const datedClaude = await request({ provider: 'anthropic', selectedModel: 'claude-sonnet-4-20250514', thinkingMode: 'budget', thinkingBudget: 4096 })
    assert.equal(datedClaude.body.model, 'claude-sonnet-4-20250514')
    assert.deepEqual(datedClaude.body.thinking, { type: 'enabled', budget_tokens: 4096 }, 'a dated Claude 4 ID still supports manual thinking')
    assert.equal(datedClaude.body.max_tokens, 12288, 'dated Claude IDs retain the exact total output cap')
    const adaptive = await request({ provider: 'anthropic', selectedModel: 'claude-opus-4-8', thinkingMode: 'effort', thinkingEffort: 'high' })
    assert.deepEqual(adaptive.body.thinking, { type: 'adaptive' })
    assert.equal(adaptive.body.output_config.effort, 'high')
    assert.equal(adaptive.body.max_tokens, 12288)
    assert.equal('budget_tokens' in adaptive.body.thinking, false)
    const googleBudget = await request({ provider: 'google', selectedModel: 'gemini-2.5-flash', thinkingMode: 'budget', thinkingBudget: 2048 })
    assert.ok(googleBudget.url.includes(':generateContent'))
    assert.equal(googleBudget.body.generationConfig.thinkingConfig.thinkingBudget, 2048)
    assert.equal(googleBudget.body.generationConfig.maxOutputTokens, 12288)
    assert.equal('thinkingLevel' in googleBudget.body.generationConfig.thinkingConfig, false)
    const googleEffort = await request({ provider: 'google', selectedModel: 'gemini-3-pro-preview', thinkingMode: 'effort', thinkingEffort: 'high' })
    assert.equal(googleEffort.body.generationConfig.thinkingConfig.thinkingLevel, 'high')
    assert.equal('thinkingBudget' in googleEffort.body.generationConfig.thinkingConfig, false)
    for (const config of [
      { provider: 'anthropic', selectedModel: 'claude-sonnet-4-5' },
      { provider: 'google', selectedModel: 'gemini-2.5-flash' },
    ]) {
      const { body } = await request(config)
      assert.equal('thinking' in body, false, 'native default must omit thinking overrides')
      assert.equal('output_config' in body, false, 'native default must omit effort overrides')
      assert.equal(body.generationConfig?.thinkingConfig, undefined)
    }
    console.log('✓ Native Anthropic and Google SDKs emit exact budget/effort fields and do not double-count Claude thinking')

    const nativeGateway: Partial<ApiConfig> = {
      provider: 'anthropic', baseURL: `  ${origin}/zen/go/v1///  `, proxyUrl: '',
      selectedModel: 'qwen3.8-flash', maxTokens: 4096,
      customHeaders: { 'X-Workspace': 'native-gateway-test' },
    }
    assert.equal(getPreset('anthropic').editableBaseURL, true, 'native Anthropic endpoints must be configurable')
    const nativeProbe = buildModelsProbe({ ...base, ...nativeGateway })
    assert.equal(nativeProbe.url, `${origin}/zen/go/v1/models`, 'native probe trims whitespace and trailing slashes')
    assert.equal(nativeProbe.headers['x-api-key'], base.apiKey)
    assert.equal(nativeProbe.headers['anthropic-version'], '2023-06-01')
    assert.equal(nativeProbe.headers['X-Workspace'], 'native-gateway-test')
    assert.equal(Object.keys(nativeProbe.headers).some(name => name.toLowerCase() === 'authorization'), false)
    assert.equal(buildModelsProbe({ ...base, provider: 'anthropic', baseURL: '', proxyUrl: '' }).url, 'https://api.anthropic.com/v1/models', 'empty native endpoint keeps the official default')
    assert.equal(await apiService.validateAPIKey({ ...base, ...nativeGateway }), true)
    assert.deepEqual(await fetchProviderModels({ ...base, ...nativeGateway }), ['gateway-model-alias', 'qwen3.8-flash'])
    for (const wire of captured.slice(-2)) {
      assert.equal(wire.url, '/zen/go/v1/models', 'connection checks and model sync reach the custom native endpoint')
      assert.equal(wire.headers['x-api-key'], base.apiKey)
      assert.equal(wire.headers['anthropic-version'], '2023-06-01')
      assert.equal(wire.headers.authorization, undefined)
      assert.equal(wire.headers['x-workspace'], 'native-gateway-test')
    }
    for (const stream of [false, true]) {
      for (const selectedModel of ['qwen3.8-flash', 'gateway-model-alias']) {
        for (const scenario of [
          { thinkingProtocol: 'auto', thinkingMode: 'default', expected: {} },
          { thinkingProtocol: 'qwen', thinkingMode: 'default', expected: {} },
          { thinkingProtocol: 'anthropic', thinkingMode: 'default', expected: {} },
          { thinkingProtocol: 'anthropic', thinkingMode: 'disabled', expected: { thinking: { type: 'disabled' } } },
          { thinkingProtocol: 'anthropic', thinkingMode: 'budget', expected: { thinking: { type: 'enabled', budget_tokens: 1024 } } },
        ] as const) {
          const { expected, ...settings } = scenario
          const wire = await request({ ...nativeGateway, selectedModel, ...settings, thinkingBudget: 1024 }, stream)
          assert.equal(wire.url, '/zen/go/v1/messages', 'the application must use the custom native endpoint directly, without a proxy prefix')
          assert.equal(wire.body.model, selectedModel)
          assert.equal(wire.body.max_tokens, 4096, 'native gateway output ceiling includes, rather than adds, the thinking allocation')
          assert.equal(wire.headers['x-api-key'], base.apiKey)
          assert.equal(wire.headers['anthropic-version'], '2023-06-01')
          assert.equal(wire.headers['x-workspace'], 'native-gateway-test')
          assert.equal(wire.headers.authorization, undefined, 'native authentication must not become OpenAI Bearer auth')
          assertReasoning(wire.body, expected, `${selectedModel}: ${settings.thinkingMode} (${stream ? 'stream' : 'nonstream'})`)
          for (const field of ['max_completion_tokens', 'stream_options', 'output_config']) assert.equal(field in wire.body, false, `native gateway must omit ${field}`)
          if (settings.thinkingMode === 'budget') assert.equal('temperature' in wire.body, false)
        }
      }
      const override = await request({ ...nativeGateway, thinkingProtocol: 'anthropic', thinkingMode: 'budget', thinkingBudget: 1024 }, stream, { model: 'request-model-alias', maxTokens: 2048 })
      assert.equal(override.body.model, 'request-model-alias')
      assert.equal(override.body.max_tokens, 2048, 'per-request total caps also include native gateway thinking')
    }
    console.log('✓ Custom native Anthropic gateways support direct model probes and both SDK generation paths with exact thinking/output budgets')

    const guardedProviders: Array<Partial<ApiConfig>> = [
      { provider: 'custom', selectedModel: 'plain-chat-model' },
      { provider: 'anthropic', selectedModel: 'claude-sonnet-4-5' },
      { provider: 'google', selectedModel: 'gemini-2.5-flash' },
    ]
    for (const stream of [false, true]) {
      for (const provider of guardedProviders) {
        state.updateConfig({ ...base, ...provider })
        const invoke = (options: GenerateOptions) => stream
          ? apiService.generateTextStream('来源门控测试', options)
          : apiService.generateText('来源门控测试', options)
        let guardCalls = 0
        let before = fetches
        assert.equal(await invoke({ beforeRequest: async () => { guardCalls++ } }), reply)
        assert.equal(guardCalls, 1, `${provider.provider}: successful HTTP dispatch checks source once`)
        assert.equal(fetches - before, 1)
        before = fetches
        await assert.rejects(invoke({ beforeRequest: async () => { throw new Error('stale source guard fixture') } }))
        assert.equal(fetches, before, `${provider.provider}: denied guard must prevent the actual SDK fetch`)

        let release!: () => void
        let entered!: () => void
        const started = new Promise<void>(resolve => { entered = resolve })
        const hold = new Promise<void>(resolve => { release = resolve })
        let sourceChanged = false
        const delayed = invoke({ beforeRequest: async () => {
          entered()
          await hold
          if (sourceChanged) throw new Error('source changed while final dispatch awaited')
        } })
        await started
        assert.equal(fetches, before, 'No payload leaves while the final source check is pending')
        sourceChanged = true
        release()
        await assert.rejects(delayed)
        assert.equal(fetches, before, `${provider.provider}: delayed guard rejects changed source before wire transport`)

        const cancelled = new AbortController()
        const abortStarted = new Promise<void>(resolve => { entered = resolve })
        const abortHold = new Promise<void>(resolve => { release = resolve })
        const aborting = invoke({ signal: cancelled.signal, beforeRequest: async () => {
          entered()
          await abortHold
          throw new Error('late source-guard rejection after cancellation')
        } })
        await abortStarted
        cancelled.abort()
        await assert.rejects(aborting)
        // Cancellation must finish while source validation is still stalled.
        release()
        await new Promise<void>(resolve => setImmediate(resolve))
        assert.equal(fetches, before, `${provider.provider}: cancellation during guard prevents dispatch after it resolves`)
      }
    }
    console.log('✓ All three real SDK providers guard both generation paths at actual dispatch, reject stale sources, and recheck cancellation after awaited guards')

    for (const stream of [false, true]) {
      state.updateConfig(base)
      const invoke = (options: GenerateOptions) => stream
        ? apiService.generateTextStream('重试来源门控测试', options)
        : apiService.generateText('重试来源门控测试', options)
      let guardCalls = 0
      let before = fetches
      retryResponsesRemaining = 1
      assert.equal(await invoke({ beforeRequest: async () => { guardCalls++ } }), reply)
      assert.equal(fetches - before, 2, 'Local 503 fixture must cause an actual SDK retry')
      assert.equal(guardCalls, 2, 'Every retry must recheck the saved-source boundary')
      before = fetches
      guardCalls = 0
      retryResponsesRemaining = 1
      await assert.rejects(invoke({ beforeRequest: async () => {
        guardCalls++
        if (guardCalls > 1) throw new Error('source changed between SDK retry attempts')
      } }))
      assert.equal(fetches - before, 1, 'A changed source blocks the retry payload, even after the first HTTP call failed')
      assert.ok(guardCalls >= 2)
      assert.equal(retryResponsesRemaining, 0)
    }
    console.log('✓ Actual SDK retry attempts revalidate source independently; edits between attempts stop subsequent payloads')

    const invalid: Array<{ name: string; config: Partial<ApiConfig>; options?: GenerateOptions }> = [
      ...[-1, 0, 1.5, NaN, Infinity, 10_000_001].map(maxTokens => ({ name: `invalid total ${maxTokens}`, config: { maxTokens } })),
      ...[-1, 0, 1.5, NaN, Infinity].map(thinkingBudget => ({ name: `invalid thinking ${thinkingBudget}`, config: { provider: 'qwen', selectedModel: 'qwen3.6-plus', thinkingMode: 'budget' as const, thinkingBudget } })),
      { name: 'thinking exhausts total', config: { provider: 'anthropic', selectedModel: 'claude-sonnet-4-5', thinkingMode: 'budget', thinkingBudget: 4096, maxTokens: 4096 } },
      { name: 'Claude minimum thinking', config: { provider: 'anthropic', selectedModel: 'claude-sonnet-4-5', thinkingMode: 'budget', thinkingBudget: 512 } },
      { name: 'Claude budget exceeds SDK model cap', config: { provider: 'anthropic', selectedModel: 'claude-sonnet-4-5', thinkingMode: 'budget', thinkingBudget: 65536, maxTokens: 131072 } },
      { name: 'native gateway requires explicit format', config: { ...nativeGateway, thinkingMode: 'budget', thinkingBudget: 1024 } },
      { name: 'native gateway rejects DashScope format', config: { ...nativeGateway, thinkingProtocol: 'qwen', thinkingMode: 'budget', thinkingBudget: 1024 } },
      { name: 'native gateway thinking exhausts total', config: { ...nativeGateway, thinkingProtocol: 'anthropic', thinkingMode: 'budget', thinkingBudget: 4096 } },
      { name: 'native gateway minimum thinking', config: { ...nativeGateway, thinkingProtocol: 'anthropic', thinkingMode: 'budget', thinkingBudget: 512 } },
      { name: 'native gateway rejects unsupported adaptive thinking', config: { ...nativeGateway, thinkingProtocol: 'anthropic', thinkingMode: 'enabled' } },
      { name: 'native gateway rejects unsupported effort', config: { ...nativeGateway, thinkingProtocol: 'anthropic', thinkingMode: 'effort' } },
      { name: 'native gateway request cap exhausts thinking', config: { ...nativeGateway, thinkingProtocol: 'anthropic', thinkingMode: 'budget', thinkingBudget: 1024 }, options: { maxTokens: 1024 } },
      { name: 'GPT Pro cannot disable', config: { selectedModel: 'gpt-5.4-pro', thinkingMode: 'disabled' } },
      { name: 'GPT Pro rejects low effort', config: { selectedModel: 'gpt-5.4-pro', thinkingMode: 'effort', thinkingEffort: 'low' } },
      { name: 'future GPT does not inherit disable support', config: { selectedModel: 'gpt-6-astra', thinkingMode: 'disabled' } },
      { name: 'Qwen 2 does not support a thinking budget', config: { provider: 'qwen', selectedModel: 'qwen2.5-72b-instruct', thinkingMode: 'budget' } },
      { name: 'Claude adaptive rejects numeric budget', config: { provider: 'anthropic', selectedModel: 'claude-opus-4-8', thinkingMode: 'budget' } },
      { name: 'GLM 5.3 cannot disable', config: { provider: 'zhipu', selectedModel: 'glm-5.3', thinkingMode: 'disabled' } },
      { name: 'MiMo cannot use numeric budget', config: { selectedModel: 'mimo-v2-pro', thinkingMode: 'budget' } },
      { name: 'MiMo cannot use effort', config: { selectedModel: 'mimo-v2-pro', thinkingMode: 'effort' } },
      { name: 'DeepSeek invalid effort', config: { provider: 'deepseek', selectedModel: 'deepseek-v4-pro', thinkingMode: 'effort', thinkingEffort: 'medium' } },
      { name: 'unknown family cannot use budget', config: { thinkingMode: 'budget' } },
      { name: 'Gemini 3 uses effort', config: { provider: 'google', selectedModel: 'gemini-3-pro-preview', thinkingMode: 'budget' } },
      { name: 'per-request cap below thinking allocation', config: { provider: 'google', selectedModel: 'gemini-2.5-flash', thinkingMode: 'budget' }, options: { maxTokens: 2048 } },
      { name: 'override changes supported protocol', config: { selectedModel: 'gpt-5.4', thinkingMode: 'effort' }, options: { model: 'plain-chat-model' } },
    ]
    for (const stream of [false, true]) {
      for (const scenario of invalid) {
        // Simulate old/corrupted persisted state, bypassing the form/save validator.
        // The request boundary must reject independently before the SDK can fetch.
        state.apiConfig.value = { ...base, ...scenario.config }
        const before = fetches
        await assert.rejects(
          stream ? apiService.generateTextStream('无效预算', scenario.options) : apiService.generateText('无效预算', scenario.options),
          (error: unknown) => error instanceof Error && error.message.length > 0,
          `${scenario.name} must fail locally (${stream ? 'stream' : 'nonstream'})`,
        )
        assert.equal(fetches, before, `${scenario.name}: invalid settings must fail before fetch`)
      }
    }
    console.log('✓ Invalid budgets and unsupported model/mode combinations fail before any fetch in both paths')

    state.updateConfig({ ...base, selectedModel: 'gateway-model-alias', thinkingProtocol: 'qwen', thinkingMode: 'budget', thinkingBudget: 3072, thinkingEffort: 'high' })
    const saved = disk.get('apiConfig')!
    const persisted = JSON.parse(saved) as ApiConfig
    assert.equal(persisted.thinkingProtocol, 'qwen')
    assert.equal(persisted.thinkingMode, 'budget')
    assert.equal(persisted.thinkingBudget, 3072)
    assert.equal(persisted.thinkingEffort, 'high')
    const reload = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--verify-reload'], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8',
      env: { ...process.env, GENERATION_BUDGET_SAVED_CONFIG: saved }, timeout: 30_000,
    })
    assert.equal(reload.status, 0, reload.stderr || String(reload.error ?? 'fresh process reload failed'))
    state.updateConfig({ ...base, ...nativeGateway, thinkingProtocol: 'anthropic', thinkingMode: 'budget', thinkingBudget: 1024 })
    const nativeSaved = disk.get('apiConfig')!
    const nativeReload = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--verify-reload'], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8',
      env: { ...process.env, GENERATION_BUDGET_SAVED_CONFIG: nativeSaved }, timeout: 30_000,
    })
    assert.equal(nativeReload.status, 0, nativeReload.stderr || String(nativeReload.error ?? 'native gateway reload failed'))
    state.updateConfig(persisted)
    const { BackupValidationError, createBackup, parseBackup, restoreBackup } = await import('../src/services/backup')
    const backup = await createBackup(['settings'])
    assert.deepEqual(parseBackup(backup).apiConfig, persisted)
    disk.delete('apiConfig')
    await restoreBackup(backup, ['settings'])
    assert.deepEqual(JSON.parse(disk.get('apiConfig')!), persisted, 'backup restores all generation budget controls')
    console.log('✓ Budget settings persist, reload in a fresh process, and round-trip through backup')
    const invalidBackupFields: Array<[string, unknown]> = [
      ...['4096', null, true, {}, -1, 0, 1.5].map(value => ['thinkingBudget', value] as [string, unknown]),
      ['thinkingMode', 'unrecognized-mode'], ['thinkingMode', 1],
      ['thinkingProtocol', 'unrecognized-protocol'], ['thinkingProtocol', {}],
      ['thinkingEffort', 'unrecognized-effort'], ['thinkingEffort', false],
    ]
    for (const [field, value] of invalidBackupFields) {
      const malformed = { ...backup, data: { ...backup.data, apiConfig: { ...persisted, [field]: value } } }
      const before = [...disk.entries()]
      const reportsField = (error: unknown) => error instanceof BackupValidationError && error.message.includes(`apiConfig.${field}`)
      assert.throws(() => parseBackup(malformed), reportsField, `backup parser must reject invalid ${field}`)
      await assert.rejects(restoreBackup(malformed, ['settings']), reportsField, `restore must reject invalid ${field}`)
      assert.deepEqual([...disk.entries()], before, 'invalid budget backups must not change persisted settings')
    }
    console.log('✓ Backup validation rejects malformed budget controls before writing settings')
  } finally {
    globalThis.fetch = realFetch
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
