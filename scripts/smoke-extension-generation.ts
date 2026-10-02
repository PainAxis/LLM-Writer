/** Full APIService business loops against actual local HTTP providers and MCP. */
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import type { ExtensionRequest, ToolActivityEvent } from '../src/types/extensions'
import type { WritingSkill } from '../src/types/skills'
import type { WriterNovel } from '../src/types/writer'
// JavaScript fixture is deliberately shared with the real Chromium workflow.
// @ts-expect-error the local fixture has no declaration file
import { startExtensionFixture, CHAPTER_EVIDENCE, SKILL_EVIDENCE, MCP_EVIDENCE, FINAL_REPLY } from './fixtures/extension-server.mjs'

const disk = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => disk.get(key) ?? null,
  setItem: (key: string, value: string) => void disk.set(key, value),
  removeItem: (key: string) => void disk.delete(key),
} })
const api = (await import('../src/services/api')).default
const billing = (await import('../src/services/billing')).default
const { useApiConfig } = await import('../src/services/apiConfig')
const { parseSkillPackage } = await import('../src/services/skills')
const fixture = await startExtensionFixture()
const novel: WriterNovel = { id: 101, title: '灯塔与银钥匙', chapterList: [{ id: 11, title: '第一章：约定', content: CHAPTER_EVIDENCE }], characters: [], worldSettings: [], events: [], corpusData: [] }
const skill = parseSkillPackage([
  { path: 'SKILL.md', content: '---\nname: lighthouse-review\ndescription: 核对银钥匙与灯塔约定\n---\n请按需读取 references/evidence.md，依据原文写出有出处的审校意见。' },
  { path: 'references/evidence.md', content: SKILL_EVIDENCE },
])
const activity: ToolActivityEvent[] = []
const request = (overrides: Partial<ExtensionRequest> = {}): ExtensionRequest => ({ novel, writingToolIds: ['writing_read_chapter'], skills: [], servers: [], maxSteps: 4, contextTokenBudget: 16000, onToolActivity: event => activity.push(event), ...overrides })
const remote = { config: { id: 'fixture', name: '灯塔资料库', url: `${fixture.origin}/__test/mcp`, enabled: true, allowedTools: ['get_evidence'] }, bearerToken: 'synthetic-session-token' }
const newest = () => billing.getBillingRecords()[0]
const configure = (provider: 'custom' | 'anthropic') => useApiConfig().updateConfig({ provider, apiKey: 'synthetic-provider-key', baseURL: `${fixture.origin}/__test/${provider === 'anthropic' ? 'anthropic' : 'v1'}`, selectedModel: 'extension-writing' })
const originalConsoleError = console.error
const outcomes: string[] = []
async function check(name: string, run: () => Promise<void>) {
  activity.length = 0
  await run()
  outcomes.push(name)
  console.log(`PASS ${name}`)
}

try {
  console.error = () => {} // Expected synthetic failures must not clutter logs.
  for (const provider of ['custom', 'anthropic'] as const) {
    configure(provider)
    for (const streaming of [false, true]) {
      const run = streaming ? api.generateTextStream.bind(api) : api.generateText.bind(api)
      for (const [model, extensions, evidence, toolName] of [
        ['extension-writing', request(), CHAPTER_EVIDENCE, 'writing_read_chapter'],
        ['extension-skill', request({ novel: undefined, writingToolIds: [], skills: [skill] }), SKILL_EVIDENCE, 'writing_skill_read_reference'],
        ['extension-mcp', request({ novel: undefined, writingToolIds: [], servers: [remote] }), MCP_EVIDENCE, 'get_evidence'],
      ] as const) {
        await check(`${provider} ${streaming ? 'stream' : 'text'} ${model} evidence loop and aggregate billing`, async () => {
          const before = fixture.captured.length
          const text = await run('核对灯塔约定后给出审校意见。', { model, extensions })
          assert.equal(text, FINAL_REPLY)
          const captures = fixture.captured.slice(before)
          assert.equal(captures.length, 2)
          const second = captures[1].body
          const results = provider === 'anthropic'
            ? second.messages.flatMap((message: { content: unknown }) => Array.isArray(message.content) ? message.content.filter((part: { type: string }) => part.type === 'tool_result') : [])
            : second.messages.filter((message: { role: string }) => message.role === 'tool')
          assert.ok(results.length > 0, 'second provider request must contain protocol-native tool results')
          assert.ok(JSON.stringify(results).includes(evidence), 'real source text must reach the second provider request')
          assert.equal(activity.length, 2)
          assert.ok(activity[0].toolName.includes(toolName))
          assert.deepEqual(activity.map(item => item.status), ['running', 'success'])
          assert.equal(newest().inputTokens, 28)
          assert.equal(newest().outputTokens, 8)
          assert.equal(newest().usageSource, 'reported')
          assert.equal(newest().status, 'success')
          assert.equal(fixture.metrics.forbiddenCalls, 0)
        })
      }
      await check(`${provider} ${streaming ? 'stream' : 'text'} step cap reports unfinished and retains usage`, async () => {
        await assert.rejects(run('持续检查。', { model: 'extension-loop', extensions: request({ servers: [remote], maxSteps: 2 }) }), /工具调用轮数上限/)
        assert.equal(newest().status, 'failed')
        assert.equal(newest().inputTokens, 28)
        assert.equal(newest().outputTokens, 8)
      })
      await check(`${provider} ${streaming ? 'stream' : 'text'} failed second request retains first-step usage`, async () => {
        await assert.rejects(run('读取后继续。', { model: 'extension-second-fail', extensions: request() }), /Synthetic second step failure/)
        assert.equal(newest().status, 'failed')
        assert.equal(newest().inputTokens, 11)
        assert.equal(newest().outputTokens, 3)
        assert.equal(newest().usageSource, 'reported')
      })
      await check(`${provider} ${streaming ? 'stream' : 'text'} MCP tool error remains visible in trace and native result`, async () => {
        const before = fixture.captured.length
        const text = await run('查询失败时说明情况。', { model: 'extension-mcp-error', extensions: request({ servers: [remote] }) })
        assert.equal(text, FINAL_REPLY)
        assert.deepEqual(activity.map(item => item.status), ['running', 'error'])
        assert.ok(JSON.stringify(fixture.captured.slice(before)[1].body.messages).includes('合成资料查询失败'))
      })
    }
  }
  configure('custom')
  for (const run of [api.generateText.bind(api), api.generateTextStream.bind(api)]) {
    await check('schemas and selected skill instructions count before the first provider request', async () => {
      const before = fixture.captured.length
      await assert.rejects(run('简短请求', { extensions: request({ skills: [skill], contextTokenBudget: 64 }) }), /超过.*上下文设置/)
      assert.equal(fixture.captured.length, before)
      assert.equal(newest().totalTokens, 0)
    })
    await check('read reference content is re-budgeted before a subsequent provider step', async () => {
      const longSkill: WritingSkill = { ...skill, files: skill.files.map(file => file.path === 'references/evidence.md' ? { ...file, content: '证'.repeat(5000) } : file) }
      const before = fixture.captured.length
      await assert.rejects(run('读取参考后再回答。', { model: 'extension-budget-result', extensions: request({ novel: undefined, writingToolIds: [], skills: [longSkill], contextTokenBudget: 2500 }) }), /超过.*上下文设置/)
      assert.equal(fixture.captured.length, before + 1)
      assert.equal(newest().inputTokens, 11)
      assert.equal(newest().outputTokens, 3)
    })
    await check('unadvertised provider tool calls never execute project access', async () => {
      const before = fixture.captured.length
      assert.match(await run('越权读取应失败。', { model: 'extension-denied', extensions: request() }), /未获授权/)
      const captures = fixture.captured.slice(before)
      assert.equal(captures.length, 2)
      const result = JSON.stringify(captures[1].body.messages.filter((message: { role: string }) => message.role === 'tool'))
      assert.match(result, /writing_read_material/)
      assert.equal(result.includes(CHAPTER_EVIDENCE), false)
      assert.equal(activity.some(item => item.toolName === 'writing_read_material' && item.status === 'success'), false)
      assert.ok(activity.some(item => item.toolName === 'writing_read_material' && item.status === 'error'), 'denied tool calls must remain visible in the activity trace')
      assert.equal(fixture.metrics.forbiddenCalls, 0)
    })
    await check('cancel during a real MCP HTTP wait emits no late success or final reply', async () => {
      const controller = new AbortController()
      let started!: () => void
      const waiting = new Promise<void>(resolve => { started = resolve })
      const events: ToolActivityEvent[] = []
      const cancellation = run('等待资料。', { model: 'extension-mcp-delay', signal: controller.signal, extensions: request({ servers: [remote], onToolActivity: event => { events.push(event); if (event.status === 'running') started() } }) })
      const rejection = assert.rejects(cancellation, { name: 'AbortError' })
      await waiting
      controller.abort()
      await rejection
      const count = events.length
      fixture.releasePending()
      await delay(30)
      assert.equal(events.length, count)
      assert.equal(events.some(event => event.status === 'success'), false)
      assert.equal(newest().status, 'failed')
      assert.equal(newest().inputTokens, 11, 'cancellation after provider generation must retain already reported input usage')
      assert.equal(newest().outputTokens, 3, 'cancellation during tool execution must retain provider tool-call usage')
    })
    await check('missing provider usage is estimated rather than misreported as zero', async () => {
      assert.equal(await run('读取章后说明约定。', { model: 'extension-no-usage', extensions: request() }), FINAL_REPLY)
      assert.equal(newest().usageSource, 'estimated')
      assert.ok(newest().inputTokens > 0)
      assert.ok(newest().outputTokens > 0)
    })
  }
  configure('anthropic')
  for (const run of [api.generateText.bind(api), api.generateTextStream.bind(api)]) {
    await check('native Anthropic cancellation retains tool-call usage during MCP execution', async () => {
      const controller = new AbortController()
      let started!: () => void
      const waiting = new Promise<void>(resolve => { started = resolve })
      const events: ToolActivityEvent[] = []
      const pending = run('等待外部证据。', { model: 'extension-mcp-delay', signal: controller.signal, extensions: request({ servers: [remote], onToolActivity: event => { events.push(event); if (event.status === 'running') started() } }) })
      const rejection = assert.rejects(pending, { name: 'AbortError' })
      await waiting
      controller.abort()
      await rejection
      fixture.releasePending()
      await delay(30)
      assert.equal(newest().inputTokens, 11)
      assert.equal(newest().outputTokens, 3)
      assert.equal(events.some(event => event.status === 'success'), false)
    })
  }
  await check('real assistant reserves schema/Skill budget and clears stale in-flight tools without late writes', async () => {
    configure('custom')
    disk.set('novels', JSON.stringify([novel]))
    const pinia = createPinia()
    setActivePinia(pinia)
    const { ElMessage } = await import('element-plus')
    const messageKinds = ['info', 'warning', 'success', 'error'] as const
    const originalMessages = Object.fromEntries(messageKinds.map(kind => [kind, ElMessage[kind]]))
    const feedback: string[] = []
    // This business test has no DOM. Keep the real store and API transports;
    // only the visual toast sink is replaced with a recording callback.
    for (const kind of messageKinds) Reflect.set(ElMessage, kind, (text: string) => { feedback.push(`${kind}:${text}`); return { close() {} } })
    try {
      const { useAssistantStore } = await import('../src/stores/assistant')
      const { useExtensionsStore } = await import('../src/stores/extensions')
      const extensions = useExtensionsStore()
      await extensions.importSkill(skill)
      await extensions.updateSettings({ enabled: true, selectedNovelId: novel.id, writingToolIds: ['writing_read_chapter'], selectedSkillIds: [skill.id] })
      const assistant = useAssistantStore()
      const person = assistant.addAssistant({ name: '实际上下文审校助手', persona: '核对原文，给出出处。', defaultModel: 'extension-context-only', contextPolicyMode: 'custom', contextPolicy: { maxTokens: 2000, maxTurns: 0, strategy: 'truncation', summaryThreshold: 75, retainTurns: 6 } })
      assistant.conversations[person.id] = Array.from({ length: 20 }, (_, index) => ({ id: `history-${index}`, isUser: index % 2 === 0, content: `旧会话-${index} ` + '旅人记录灯塔周边的天气与道路。'.repeat(15), timestamp: new Date().toISOString() }))
      const before = fixture.captured.length
      const reply = await assistant.sendMessage('只需确认已理解审校要求。')
      assert.equal(reply?.content, FINAL_REPLY, feedback.join('\n'))
      assert.equal(fixture.captured.length, before + 1)
      const body = fixture.captured[before].body
      assert.ok(body.messages.length < 21, 'history must shrink to make space for schemas and active Skills')
      assert.ok(JSON.stringify(body).includes(skill.instructions))
      assert.equal(body.tools.length, 2)
      assert.equal(assistant.conversations[person.id].length, 22, 'full original history remains local')
      assistant.updateAssistant(person.id, { defaultModel: 'extension-mcp-delay', contextPolicy: { maxTokens: 16000, maxTurns: 0, strategy: 'truncation', summaryThreshold: 75, retainTurns: 6 } })
      await extensions.saveServer(remote.config)
      extensions.setToken(remote.config.id, remote.bearerToken)
      const priorCalls = fixture.metrics.toolCalls
      const inFlight = assistant.sendMessage('等待 MCP 查询再审校。')
      for (let attempt = 0; fixture.metrics.toolCalls === priorCalls && attempt < 200; attempt++) await delay(5)
      assert.ok(fixture.metrics.toolCalls > priorCalls)
      assistant.clearConversation(person.id)
      await inFlight
      fixture.releasePending()
      await delay(30)
      assert.equal(assistant.conversations[person.id], undefined)
      assert.equal(newest().inputTokens, 11)
      assert.equal(newest().outputTokens, 3)
    } finally { disposePinia(pinia); Object.assign(ElMessage, originalMessages) }
  })
  assert.ok(fixture.metrics.closedSessions >= 10, 'request-scoped MCP sessions must close after normal and failed requests')
} finally {
  console.error = originalConsoleError
  fixture.releasePending()
  await fixture.close()
}
console.log(`Extension business generation smoke passed: ${outcomes.length} provider/loop/billing/budget/authorization/cancellation scenarios`)
