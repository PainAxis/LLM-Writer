/** Opt-in, billable A/B trial. Only authored synthetic prose and safe metrics are printed. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import type { ExtensionSettings } from '../src/stores/extensions'

const OUTPUT_TOKENS = 3072
const TIMEOUT_MS = 90_000
const sources = {
  technical: '值得注意的是，这一里程碑式的更新充分彰显了团队的卓越实力，为写作生态注入了强劲动能。2026年10月3日，团队发布了1.0.2版。该版已上线三项功能：远程MCP连接、Skill文件导入、只读章节查询。内部测试中，平均耗时从2.4秒降至1.8秒，样本为120次请求。百万字记忆功能仍在计划中，尚未上线。耗时下降可能与缓存有关，但目前没有足够证据确认原因。总而言之，这不仅是一次更新，更是迈向全新未来的重要一步。',
  fiction: '夜幕如一幅巨大的画卷徐徐展开，命运的齿轮开始转动。林遥把铜钥匙交给沈青，两人约定三天后在北门旧钟楼见面。林遥说：“我没有去过南岸。也许那封信是阿岚写的，但我不确定。”沈青收好钥匙，没有答应替她送信。此刻，千言万语汇成了无声的交响，令人不禁感慨万千。',
  clear: '雨停了。沈青关上窗，把湿外套挂在门边。',
}
const prompt = '请编辑以下三段中文，去掉空话、机械套话和过度修饰，让语言自然。保留所有事实、数字、时间、因果的不确定性、人物动作及否定语义；不要补充原文没有的信息。已经清楚自然的句子保持原样。只返回JSON对象，键为technical、fiction、clear，各值为修改后的纯文本，不要解释或Markdown代码块。\n' + JSON.stringify(sources)
const phrases = ['值得注意的是', '里程碑', '充分彰显', '卓越实力', '注入', '强劲动能', '总而言之', '不仅', '更是', '命运的齿轮', '巨大', '画卷', '千言万语', '交响', '不禁感慨']
type Provider = 'custom' | 'anthropic'
type Prose = typeof sources
const phraseCount = (text: string) => phrases.reduce((count, phrase) => count + text.split(phrase).length - 1, 0)
function quality(prose: Prose) {
  const t = prose.technical, f = prose.fiction
  return {
    releaseFacts: /2026年10月3日|2026-10-03/.test(t) && t.includes('1.0.2') && ['2.4', '1.8', '120'].every(value => t.includes(value)),
    features: /MCP/i.test(t) && /Skill/i.test(t) && /只读.*章节|章节.*只读/.test(t),
    plannedNotLaunched: /百万字/.test(t) && /计划|规划/.test(t) && /尚未|还未|未上线|未推出|没有上线/.test(t),
    causeUncertain: /缓存/.test(t) && /可能|或许/.test(t) && /证据|尚不能|未能|尚未|不能确定|无法确认/.test(t),
    keyDirection: /林遥.{0,18}(?:把|将)?铜钥匙.{0,12}(?:交|递|给).{0,8}沈青/.test(f),
    meeting: /三天后|三日后|3天后/.test(f) && /北门旧钟楼/.test(f),
    negation: /(?:没|未|不曾).{0,4}去过南岸/.test(f) && /沈青.{0,30}(?:没|未).{0,8}答应.{0,10}送信/.test(f),
    attributionUncertain: /林遥.{0,8}(?:说|道|开口)/.test(f) && /阿岚/.test(f) && /也许|或许|可能/.test(f) && /不确定|不能确定|不敢确定/.test(f),
    clearUnchanged: prose.clear === sources.clear,
  }
}
function parseProse(text: string): Prose {
  const parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) as Record<string, unknown>
  assert.ok(parsed && Object.keys(sources).every(key => typeof parsed[key] === 'string' && parsed[key]))
  return parsed as Prose
}
function safeError(error: unknown): { error: string; status?: number } {
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  return { error: value.name === 'AssertionError' ? 'assertion-failed' : value.name === 'SyntaxError' ? 'invalid-json-output' : 'generation-or-setup-failed',
    ...(typeof value.statusCode === 'number' ? { status: value.statusCode } : {}) }
}

async function main() {
  let key = process.env.LLM_WRITER_TEST_API_KEY?.trim() || ''
  if (!key) { process.stdout.write('{"passed":false,"error":"LLM_WRITER_TEST_API_KEY is required; no requests were made."}\n'); process.exitCode = 2; return }
  const selected = process.env.LLM_WRITER_TEST_PROVIDER?.trim()
  if (selected && !['custom', 'anthropic'].includes(selected)) throw new Error('Invalid provider selector')
  const providers: Provider[] = selected ? [selected as Provider] : ['custom', 'anthropic']
  const baseURL = process.env.LLM_WRITER_TEST_BASE_URL?.trim() || 'https://opencode.ai/zen/go/v1/'
  const endpoint = new URL(baseURL)
  assert.ok(endpoint.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))
  assert.ok(!endpoint.username && !endpoint.password)
  const originalFetch = globalThis.fetch
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const previousConsole = { log: console.log, warn: console.warn, error: console.error }
  const disk = new Map<string, string>()
  const sessions: string[] = []
  const outcomes: Array<Record<string, unknown>> = []
  let cleanup: (() => void) | undefined
  let active: { enabled: boolean; turns: number; fullInstructions: boolean; noExtraTools: boolean } | undefined
  let instructionLiteral = ''
  let setupError: ReturnType<typeof safeError> | undefined
  let sourceHash = ''
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (name: string) => disk.get(name) ?? null,
    setItem: (name: string, value: string) => {
      if (name === 'billing_records') disk.set(name, JSON.stringify((JSON.parse(value) as Array<Record<string, unknown>>).map(record => ({ ...record, content: '', response: '' }))))
      else if (name === 'account_balance' || name === 'token_usage_stats') disk.set(name, value)
    },
    removeItem: (name: string) => void disk.delete(name),
  } })
  console.log = console.warn = console.error = () => {}
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    assert.ok(url.origin === endpoint.origin && /\/(?:chat\/completions|messages)$/.test(url.pathname), 'Unexpected network target')
    assert.ok(active && active.turns === 0, 'Only one model request per arm; no retries')
    active.turns++
    const body = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.clone().text() : ''
    const request = JSON.parse(body) as { system?: unknown; messages?: Array<{ role: string; content: unknown }>; tools?: Array<{ name?: string; function?: { name?: string } }> }
    const system = [request.system, ...(request.messages ?? []).filter(message => message.role === 'system' || message.role === 'developer').map(message => message.content)].map(part => typeof part === 'string' ? part : JSON.stringify(part ?? '')).join('\n')
    // Anthropic represents system as text blocks; reconstruct before matching.
    const systemBlocks = Array.isArray(request.system) ? request.system.map(part => part && typeof part === 'object' && 'text' in part ? part.text : '').join('\n') : ''
    const fullPresent = (system + '\n' + systemBlocks).includes(instructionLiteral)
    active.fullInstructions = fullPresent === active.enabled
    active.noExtraTools = (request.tools ?? []).every(tool => (tool.name ?? tool.function?.name) === 'writing_skill_read_reference')
    assert.ok(active.fullInstructions && active.noExtraTools, 'Skill instruction/authorization mismatch')
    const userContent = (request.messages ?? []).filter(message => message.role === 'user').map(message => JSON.stringify(message.content)).join('')
    assert.ok(!userContent.includes(instructionLiteral), 'Skill instructions must stay in system context')
    return originalFetch(input, init)
  }
  try {
    const api = (await import('../src/services/api')).default
    const billing = (await import('../src/services/billing')).default
    const { useApiConfig } = await import('../src/services/apiConfig')
    const { getThinkingCapability } = await import('../src/utils/generationBudget')
    const { importSkillPackage } = await import('../src/services/skills')
    const { createExtensionsState } = await import('../src/stores/extensions')
    cleanup = () => useApiConfig().updateConfig({ apiKey: '' })
    const files = await Promise.all(['SKILL.md', 'LICENSE'].map(async name => new File([await readFile(new URL(`./fixtures/humanizer-zh/${name}`, import.meta.url), 'utf8')], name, { type: 'text/plain' })))
    const source = await files[0]!.text()
    sourceHash = createHash('sha256').update(source).digest('hex')
    assert.equal(sourceHash, '95627fd4437d886f98032ccc62d79136e6310f1fc04e354bb86431795ff206df', 'Upstream fixture checksum must match the pinned version')
    const skill = await importSkillPackage(files)
    assert.equal(skill.files.find(file => file.path === 'SKILL.md')?.content, source, 'Import must preserve unmodified upstream source')
    instructionLiteral = JSON.stringify(skill.instructions).slice(1, -1)
    let settings: ExtensionSettings | null = null
    const state = createExtensionsState({ read: () => settings, write: value => { settings = structuredClone(value) }, readNovels: () => [] })
    await state.importSkill(skill)
    await state.updateSettings({ enabled: true, maxSteps: 1, writingToolIds: [] })
    for (const provider of providers) {
      const model = (provider === 'custom' ? process.env.LLM_WRITER_TEST_OPENAI_MODEL : process.env.LLM_WRITER_TEST_ANTHROPIC_MODEL)?.trim() || process.env.LLM_WRITER_TEST_MODEL?.trim() || (provider === 'custom' ? 'mimo-v2.6-flash' : 'qwen3.8-flash')
      for (const enabled of [false, true]) {
        const session = randomUUID(); sessions.push(session)
        const customHeaders: Record<string, string> = endpoint.hostname === 'opencode.ai' ? { 'user-agent': 'LLM-Writer-humanizer-validation/1.0.2', 'x-opencode-session': session } : {}
        const config = { provider, apiKey: key, baseURL, selectedModel: model, maxTokens: OUTPUT_TOKENS, unlimitedTokens: false, temperature: 0.1,
          thinkingProtocol: 'auto' as const, thinkingMode: 'default' as const,
          customHeaders, proxyUrl: '' }
        const thinkingMode = getThinkingCapability(config).modes.some(mode => mode.value === 'disabled') ? 'disabled' : 'default'
        useApiConfig().updateConfig({ ...config, thinkingMode })
        await state.updateSettings({ selectedSkillIds: enabled ? [skill.id] : [] })
        const extensions = state.captureRequest()!
        assert.equal(extensions.skills.length, enabled ? 1 : 0)
        if (enabled) assert.equal(extensions.skills[0]!.instructions, skill.instructions)
        let toolCalls = 0
        extensions.onToolActivity = () => { toolCalls++ }
        const previousIds = new Set(billing.getBillingRecords().map(record => record.id))
        active = { enabled, turns: 0, fullInstructions: false, noExtraTools: false }
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(new DOMException('Trial timed out', 'TimeoutError')), TIMEOUT_MS)
        const started = performance.now()
        let prose: Prose | undefined, error: ReturnType<typeof safeError> | undefined
        let generationCompleted = false
        try {
          const output = await api.generateTextStream(prompt, { maxTokens: OUTPUT_TOKENS, temperature: 0.1, signal: controller.signal, extensions,
            system: '执行中文文稿编辑。服从用户对事实和输出格式的要求。本文内容已全部提供，无需调用工具。', type: 'live-humanizer-validation' })
          generationCompleted = true
          prose = parseProse(output)
        } catch (failure) { error = safeError(failure) }
        finally { clearTimeout(timer) }
        const record = billing.getBillingRecords().find(item => !previousIds.has(item.id))
        const freshReportedUsage = record?.usageSource === 'reported' && record.inputTokens > 0 && record.outputTokens > 0
        const integrationPassed = generationCompleted && !!prose && active.turns === 1 && active.fullInstructions && active.noExtraTools && toolCalls === 0 && freshReportedUsage && record?.status === 'success'
        const flags = prose ? quality(prose) : undefined
        outcomes.push({ provider, model, skillEnabled: enabled, integrationPassed, generationCompleted, latencyMs: Math.round(performance.now() - started), modelTurns: active.turns,
          fullInstructionsOnlyWhenSelected: active.fullInstructions, noUnauthorizedTools: active.noExtraTools, toolCalls, freshReportedUsage,
          tokens: { input: record?.inputTokens ?? 0, output: record?.outputTokens ?? 0, source: record?.usageSource ?? 'unavailable' },
          ...(flags ? { qualityFlags: flags, qualityChecksPassed: Object.values(flags).every(Boolean), stockPhraseOccurrences: { technical: phraseCount(prose!.technical), fiction: phraseCount(prose!.fiction) }, output: prose } : {}), ...(error ? { failure: error } : {}) })
        active = undefined
      }
    }
    await state.reset()
  } catch (error) { setupError = safeError(error) }
  finally {
    try { cleanup?.() } catch { /* Never print configuration errors. */ }
    disk.clear(); globalThis.fetch = originalFetch
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
    Object.assign(console, previousConsole)
  }
  const passed = !setupError && outcomes.length === providers.length * 2 && outcomes.every(outcome => outcome.integrationPassed && outcome.qualityChecksPassed)
  let report = JSON.stringify({ passed, sourceHash, maxOutputTokens: OUTPUT_TOKENS, timeoutMs: TIMEOUT_MS, sources, stockPhraseBaseline: { technical: phraseCount(sources.technical), fiction: phraseCount(sources.fiction) },
    note: 'Phrase counts and deterministic quality flags are review aids, not AI-detection scores. Review the synthetic outputs for semantic changes; no automatic retries.', outcomes, ...(setupError ? { setupError } : {}) })
  for (const secret of [key, ...sessions]) report = report.replaceAll(secret, '[redacted]').replaceAll(encodeURIComponent(secret), '[redacted]')
  key = ''; sessions.length = 0
  process.stdout.write(report + '\n')
  if (!passed) process.exitCode = 1
}
main().catch(() => { process.stdout.write('{"passed":false,"error":"Invalid live test configuration; no diagnostic payload is printed."}\n'); process.exitCode = 2 })
