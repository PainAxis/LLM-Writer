/** Test-only dynamic response recipes. Inputs come exclusively from the actual SDK wire. */
import type { ApiConfig } from '../../src/types/api'
import type { CreativeAdapterIdentity, CreativePromptPayloadV1, CreativeTaskId } from '../../src/types/creativePilot'
import { byteOracle, canonicalOracle, controlAssert, controlKeys, controlObject, domainOracle, hashOracle } from './creative-pilot-oracles'

export const CREATIVE_CONTROL_MODEL = 'synthetic-creative-pilot'
export const CREATIVE_CONTROL_MODES = ['normal', 'change_outline', 'change_body_one', 'invalid_json', 'duplicate_key', 'extra_key', 'wrong_stage', 'wrong_language', 'unknown_reference', 'lone_surrogate', 'body_short', 'body_long', 'finish_length', 'finish_missing', 'model_absent', 'model_mismatch', 'model_invalid', 'usage_absent', 'usage_complete', 'usage_partial', 'usage_invalid', 'usage_fractional', 'usage_unsafe', 'reasoning_usage', 'reasoning', 'tool', 'http_overflow', 'http_invalid_utf8', 'http_invalid_json', 'http_duplicate_key', 'http_redirect', 'hold', 'lost_response'] as const
export type CreativeControlMode = typeof CREATIVE_CONTROL_MODES[number]
export interface CreativeHttpRecord {
  taskId: CreativeTaskId; inputDigest: string; bodyDigest: string; bodyBytes: number; bodyUtf16: number
  briefDigest: string; outlineContentDigest: string | null; outlineEndingDigest: string | null; previousBodyDigests: string[]
  previousBodyBytes: number[]; previousBodyUtf16: number[]; replyTextJsonHash: string
  requestedModelDigest: string; outputLimit: number
}
export interface CreativeHttpObservation { activeRequests: number; maxActiveRequests: number; attempts: number; errors: number; blockedExternalRequests: number; records: CreativeHttpRecord[] }
export function creativeControlIdentity(endpoint: string, configurationRevision = 'creative-control-v1'): CreativeAdapterIdentity {
  return { mode: 'offline_control', adapterId: 'creative-pilot-sdk-v1', adapterVersion: 'creative-pilot-sdk-v1', requestedModelId: CREATIVE_CONTROL_MODEL, effectiveModelId: CREATIVE_CONTROL_MODEL, configurationRevision, endpointIdentity: endpoint }
}
export function creativeControlConfiguration(endpoint: string): ApiConfig {
  const url = new URL(endpoint)
  controlAssert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash)
  return { provider: 'custom', apiKey: 'synthetic-loopback-control-only', baseURL: endpoint, selectedModel: CREATIVE_CONTROL_MODEL, maxTokens: 4096, unlimitedTokens: false, temperature: 0.7, thinkingMode: 'disabled', thinkingProtocol: 'deepseek', customHeaders: {}, proxyUrl: '' }
}
function short(text: string, count = 480): string { return Array.from(text).slice(0, count).join('') || 'synthetic-control' }
function local(kind: string, id: string) { return { source: 'self', recordKind: kind, recordId: id } }
function token(packet: CreativePromptPayloadV1, kind: string, id?: string) {
  const row = packet.catalog.find(row => row.identity.recordKind === kind && (id === undefined || row.identity.recordId === id))
  controlAssert(row, 'creative_control_missing_catalog')
  return { source: 'catalog', token: row.token }
}
function tokenFromRef(packet: CreativePromptPayloadV1, ref: { recordKind: string; recordId: string } | null) { return ref === null ? null : token(packet, ref.recordKind, ref.recordId) }

export async function creativeControlText(packet: CreativePromptPayloadV1, mode: CreativeControlMode = 'normal'): Promise<string> {
  controlAssert(packet.protocol === 'creative-pilot-input-v1' && packet.brief.protocol === 'creative-brief-v1')
  const { taskId, stage, language, chapterOrdinal } = packet.identity, zh = language === 'zh'
  const signature = (await hashOracle(canonicalOracle(packet.brief))).slice(0, 12)
  const say = (a: string, b: string) => zh ? a : b
  const premise = packet.brief.premise, rules = packet.brief.constraints.length ? packet.brief.constraints : [premise]
  let payload: Record<string, unknown>
  if (stage === 'outline') {
    const p = taskId + '.', statement = short(premise)
    payload = {
      premise,
      endingIntent: short(rules[rules.length - 1]!) + (mode === 'change_outline' ? say(' 另一个明确结局。', ' A distinct explicit ending.') : ''),
      genreRules: rules.map((statement, i) => ({ id: p + 'rule' + i, polarity: 'required', statement: short(statement) })),
      loreEntities: [{ id: p + 'object', entityKind: 'object', name: say('线索', 'Clue') + '-' + signature, description: statement, invariantFactRefs: [local('world_fact', p + 'fact')] }],
      worldFacts: [{ id: p + 'fact', statement, subjectRefs: [local('lore_entity', p + 'object')], premiseRefs: [], invariant: true, validFrom: 1, validThrough: 3, readerNotBefore: 1 }],
      plotPromises: [{ id: p + 'promise', statement: short(rules[0]!), dueChapter: 3, premiseRefs: [local('world_fact', p + 'fact')] }],
      intentionallyOpenThreads: [{ id: p + 'open', statement: short(rules[rules.length - 1]!), premiseRefs: [], disposition: 'intentionally_open_at_end' }],
    }
  } else if (stage === 'character_bible') {
    const p = taskId + '.', parent = packet.earlyPlanning.outline
    controlAssert(parent)
    payload = {
      characters: [{ id: p + 'person', name: say('记录者', 'Observer') + '-' + signature, role: short(parent.premise), motivation: short(parent.endingIntent), identityInvariants: [say('保持此身份。', 'Keeps this identity.')], capabilityInvariants: [short(rules[0]!)], initialStateRef: local('character_state', p + 'state'), initialEpistemicRefs: [] }],
      characterStates: [{ id: p + 'state', characterRef: local('character', p + 'person'), description: short(parent.endingIntent), capabilityFactRefs: [token(packet, 'world_fact')], validFrom: 1, validThrough: 3 }], epistemicStates: [], transitions: [],
    }
  } else if (stage === 'detailed_outline') {
    const p = taskId + '.', character = token(packet, 'character'), fact = token(packet, 'world_fact')
    const beats = [1, 2, 3].map(n => ({ id: p + 'beat' + n, chapter: n, order: n, summary: short(`${n}: ${premise}`), causalPredecessorRefs: n > 1 ? [local('beat', p + 'beat' + (n - 1))] : [], participantRefs: [character], factRefs: [fact], transitionRefs: [], readerDisclosureFactRefs: [fact] }))
    payload = {
      beats, transitionBindings: [],
      obligations: [
        { id: p + 'payoff', summary: short(rules[0]!), setupRefs: [local('beat', p + 'beat1')], payoffRefs: [local('beat', p + 'beat3')], contextRefs: [fact], dueChapter: 3, readerNotBefore: 3, disposition: 'planned_payoff', openThreadRef: null },
        { id: p + 'open', summary: short(rules[rules.length - 1]!), setupRefs: [local('beat', p + 'beat1')], payoffRefs: [], contextRefs: [], dueChapter: 3, readerNotBefore: 1, disposition: 'intentionally_open_at_end', openThreadRef: token(packet, 'intentionally_open_thread') },
      ],
      chapters: [1, 2, 3].map(n => ({ id: p + 'chapter' + n, chapter: n, povRef: character, beatRefs: [local('beat', p + 'beat' + n)], requiredConstraintRefs: [token(packet, 'genre_rule'), character], requiredFactRefs: [fact], requiredTransitionRefs: [], obligationRefs: [local('obligation', p + 'payoff'), local('obligation', p + 'open')] })),
    }
  } else if (stage === 'chapter_outline') {
    controlAssert(packet.globalCanon && packet.selectedChapter && chapterOrdinal !== null)
    const entry = packet.selectedChapter.entry, details = packet.globalCanon.detailedOutline
    const selected = details.beats.filter(b => b.chapter.ordinal === chapterOrdinal)
    const obligationRefs = (kind: 'setupRefs' | 'payoffRefs') => details.obligations.filter(o => o[kind].some(ref => selected.some(b => b.id === ref.recordId))).map(o => token(packet, 'obligation', o.id))
    payload = { chapter: chapterOrdinal, povRef: tokenFromRef(packet, entry.povRef), scenes: [{ id: taskId + '.scene', order: 1, summary: short(`${chapterOrdinal}: ${premise}`), beatRefs: entry.beatRefs.map(ref => tokenFromRef(packet, ref)), castRefs: packet.globalCanon.characterBible.characters.map(c => token(packet, 'character', c.id)), stateRefs: packet.globalCanon.characterBible.characterStates.filter(s => s.validFrom.ordinal <= chapterOrdinal && s.validThrough.ordinal >= chapterOrdinal).map(s => token(packet, 'character_state', s.id)), epistemicRefs: [], setupObligationRefs: obligationRefs('setupRefs'), payoffObligationRefs: obligationRefs('payoffRefs'), withheldFactRefs: [] }], additionalRefs: [{ ref: token(packet, 'lore_entity'), reason: 'lore_detail' }] }
  } else {
    controlAssert(stage === 'chapter_body' && chapterOrdinal !== null && packet.previousBodies.length === chapterOrdinal - 1)
    const marker = await hashOracle(canonicalOracle({ brief: packet.brief, chapter: chapterOrdinal, selected: packet.selectedChapter, previous: packet.previousBodies }))
    const prefix = say(`第${chapterOrdinal}章。`, `Chapter ${chapterOrdinal}. `) + premise + ` [${marker.slice(0, 20)}] ` + (mode === 'change_body_one' && chapterOrdinal === 1 ? 'ALTERED-ORIGINAL-BODY-ONE. ' : '')
    let body = prefix
    for (let n = 1; Array.from(body).length < 512; n++) body += say(`\n记录${n}：`, `\nRecord ${n}: `) + rules[(n - 1) % rules.length] + ` ${signature}-${n}.`
    body = Array.from(body).slice(0, 512).join('')
    if (mode === 'body_short') body = Array.from(body).slice(0, 255).join('')
    if (mode === 'body_long') body += 'x'.repeat(1025 - Array.from(body).length)
    if (mode === 'lone_surrogate') body = '\ud800'
    return body
  }
  const result: Record<string, unknown> = { protocol: 'creative-plan-wire-v1', stage, language, payload }
  if (mode === 'extra_key') result.unexpected = true
  if (mode === 'wrong_stage') result.stage = stage === 'outline' ? 'character_bible' : 'outline'
  if (mode === 'wrong_language') result.language = zh ? 'en' : 'zh'
  if (mode === 'unknown_reference' && stage === 'outline') (payload.worldFacts as Array<any>)[0].subjectRefs[0].recordId = taskId + '.missing'
  if (mode === 'invalid_json') return '{'
  if (mode === 'lone_surrogate') return '\ud800'
  const raw = JSON.stringify(result)
  if (mode === 'duplicate_key') return raw.slice(0, -1) + ',"protocol":"creative-plan-wire-v1"}'
  return raw
}

export async function creativeControlReply(rawBody: string, mode: CreativeControlMode = 'normal'): Promise<{ body: string; record: CreativeHttpRecord }> {
  controlAssert(byteOracle(rawBody) <= 65536 && rawBody.length <= 65536)
  const wire: unknown = JSON.parse(rawBody)
  controlObject(wire)
  const limitKey = Object.hasOwn(wire, 'max_tokens') ? 'max_tokens' : 'max_completion_tokens'
  controlKeys(wire, ['model', 'temperature', 'messages', limitKey])
  controlAssert(wire.model === CREATIVE_CONTROL_MODEL && wire.temperature === 0.7 && wire[limitKey] === 4096)
  controlAssert(Array.isArray(wire.messages) && wire.messages.length === 2)
  const [system, prompt] = wire.messages
  controlKeys(system, ['role', 'content']); controlKeys(prompt, ['role', 'content'])
  controlAssert(system.role === 'system' && prompt.role === 'user' && typeof system.content === 'string' && typeof prompt.content === 'string')
  const packet = JSON.parse(prompt.content) as CreativePromptPayloadV1
  controlAssert(packet.protocol === 'creative-pilot-input-v1' && packet.catalog.length <= 512 && packet.previousBodies.length <= 2)
  const text = await creativeControlText(packet, mode)
  const message: Record<string, unknown> = { role: 'assistant', content: text }
  if (mode === 'reasoning') message.reasoning_content = 'Synthetic hidden reasoning must not be retained.'
  if (mode === 'tool') message.tool_calls = [{ id: 'control-tool', type: 'function', function: { name: 'not_registered', arguments: '{}' } }]
  const choice: Record<string, unknown> = { index: 0, finish_reason: mode === 'finish_length' ? 'length' : mode === 'tool' ? 'tool_calls' : 'stop', message }
  if (mode === 'finish_missing') delete choice.finish_reason
  const result: Record<string, unknown> = { id: 'synthetic-creative-control', object: 'chat.completion', created: 1, model: CREATIVE_CONTROL_MODEL, choices: [choice], usage: { prompt_tokens: 37, completion_tokens: 29, total_tokens: 66 } }
  if (mode === 'model_absent') delete result.model
  if (mode === 'model_mismatch') result.model = 'wrong-synthetic-model'
  if (mode === 'model_invalid') result.model = 'x'.repeat(129)
  if (mode === 'usage_absent' || mode === 'reasoning') delete result.usage
  if (mode === 'usage_complete') result.usage = { prompt_tokens: 37, completion_tokens: 29, completion_tokens_details: { reasoning_tokens: 0 } }
  if (mode === 'usage_partial') result.usage = { prompt_tokens: 37 }
  if (mode === 'usage_invalid') result.usage = { prompt_tokens: -1, completion_tokens: 4097 }
  if (mode === 'usage_fractional') result.usage = { prompt_tokens: 1.5, completion_tokens: 29 }
  if (mode === 'usage_unsafe') result.usage = { prompt_tokens: 9007199254740992, completion_tokens: 29 }
  if (mode === 'reasoning_usage') result.usage = { prompt_tokens: 37, completion_tokens: 29, completion_tokens_details: { reasoning_tokens: 1 } }
  let body = JSON.stringify(result)
  if (mode === 'http_overflow') body = ' '.repeat(65537)
  if (mode === 'http_invalid_json') body = '{'
  if (mode === 'http_duplicate_key') body = body.slice(0, -1) + ',"model":"' + CREATIVE_CONTROL_MODEL + '"}'
  const outline = packet.earlyPlanning.outline ?? packet.globalCanon?.outline ?? null
  return { body, record: { taskId: packet.identity.taskId, inputDigest: await hashOracle(canonicalOracle({ system: system.content, prompt: prompt.content })), bodyDigest: await hashOracle(rawBody), bodyBytes: byteOracle(rawBody), bodyUtf16: rawBody.length, briefDigest: await hashOracle(canonicalOracle(packet.brief)), outlineContentDigest: outline ? await hashOracle(canonicalOracle(outline)) : null, outlineEndingDigest: outline ? await hashOracle(outline.endingIntent) : null, previousBodyDigests: await Promise.all(packet.previousBodies.map(row => hashOracle(row.text))), previousBodyBytes: packet.previousBodies.map(row => byteOracle(row.text)), previousBodyUtf16: packet.previousBodies.map(row => row.text.length), replyTextJsonHash: await domainOracle('creative-visible-text-json-v1', JSON.stringify(text)), requestedModelDigest: await hashOracle(CREATIVE_CONTROL_MODEL), outputLimit: 4096 } }
}
