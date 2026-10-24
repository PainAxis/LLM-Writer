/** Evaluation admission and dispatch guard. Production aiRequestLimits remains the
 * only HTTP body/deadline adapter; this layer adds exact destination and budget admission. */
import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import dgram from 'node:dgram'
import { syncBuiltinESMExports } from 'node:module'
import { parseDocument } from 'yaml'

export const EVALUATION_LIVE_LIMITS = Object.freeze({ maxCases: 2, maxHttpRequests: 4,
  maxOutputTokens: 4_800, outputTokensPerCall: 1_200, responseBytes: 65_536, timeoutMs: 30_000 })
export type EvalFailureCode = 'invalid_plan' | 'invalid_credential' | 'dispatch_denied' | 'request_budget'
  | 'credential_echo' | 'source_boundary' | 'source_changed' | 'fixture_invalid' | 'packet_destination' | 'internal'
export class EvaluationError extends Error {
  constructor(readonly code: EvalFailureCode) { super(code); this.name = 'EvaluationError' }
}
export interface WriterAgentLivePlan {
  schemaVersion: 1
  fixtureSha256: string
  endpoint: string
  model: string
  caseIds: string[]
  limits: typeof EVALUATION_LIVE_LIMITS
  approvedSyntheticCorpus: true
  approvedAutomaticSelection: true
}
export const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))
export function parseLivePlanJSON(text: string): unknown {
  if (Buffer.byteLength(text) > 8_192) throw new EvaluationError('invalid_plan')
  try {
    const value: unknown = JSON.parse(text)
    if (parseDocument(text, { uniqueKeys: true, schema: 'json', strict: true }).errors.length) throw new EvaluationError('invalid_plan')
    return value
  } catch { throw new EvaluationError('invalid_plan') }
}
export function validateLivePlan(value: unknown, fixtureSha256: string, permittedIds: readonly string[]): WriterAgentLivePlan {
  const bad = (): never => { throw new EvaluationError('invalid_plan') }
  if (!object(value) || !exact(value, ['schemaVersion', 'fixtureSha256', 'endpoint', 'model', 'caseIds', 'limits', 'approvedSyntheticCorpus', 'approvedAutomaticSelection'])
    || value.schemaVersion !== 1 || value.fixtureSha256 !== fixtureSha256 || value.approvedSyntheticCorpus !== true
    || value.approvedAutomaticSelection !== true || typeof value.endpoint !== 'string' || typeof value.model !== 'string'
    || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value.model)
    || !Array.isArray(value.caseIds) || value.caseIds.length < 1 || value.caseIds.length > 2
    || new Set(value.caseIds).size !== value.caseIds.length || value.caseIds.some(id => typeof id !== 'string' || !permittedIds.includes(id))
    || !object(value.limits) || !exact(value.limits, Object.keys(EVALUATION_LIVE_LIMITS))
    || Object.entries(EVALUATION_LIVE_LIMITS).some(([k, v]) => (value.limits as Record<string, unknown>)[k] !== v)) return bad()
  let url: URL
  try { url = new URL(value.endpoint) } catch { return bad() }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port
    || url.href !== value.endpoint || !url.pathname.endsWith('/chat/completions')
    || !/^\/(?:[a-zA-Z0-9_-]+\/)*chat\/completions$/.test(url.pathname)
    || isIP(url.hostname.replace(/^\[|\]$/g, '')) || !url.hostname.includes('.')
    || /(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/.test(url.hostname)) return bad()
  return structuredClone(value) as unknown as WriterAgentLivePlan
}
export function validateCredential(value: string): string {
  // No whitespace/control/quote escapes; one stdin line, never argv, env, disk or prompts.
  if (!/^[A-Za-z0-9_.-]{16,512}$/.test(value)) throw new EvaluationError('invalid_credential')
  return value
}
/** SDK visible text can contain JSON-escaped key material; treat such echoes as
 * integrity failures rather than retaining even an encoded copy in a private packet. */
export function containsCredential(text: string, credential: string): boolean {
  let decoded = text
  for (let pass = 0; pass < 3; pass++) {
    if (decoded.includes(credential)) return true
    const next = decoded.replace(/\\u([a-fA-F0-9]{4})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\x([a-fA-F0-9]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    if (next === decoded) return false
    decoded = next
  }
  return decoded.includes(credential)
}
export function scrubCredential<T>(value: T, credential: string): T {
  if (!credential) return value
  return JSON.parse(JSON.stringify(value).split(credential).join('[REDACTED]')) as T
}
export interface ExpectedDispatch { phase: 'plan' | 'draft'; system: string; prompt: string }
export interface DispatchRecord { phase: 'plan' | 'draft'; requestSha256: string; requestBytes: number; responseStatus: number | null }
export function createEvaluationFetchGuard(options: {
  endpoint: string; model: string; credential: string; maxRequests: number;
  send: typeof fetch; expected: () => ExpectedDispatch | null; records: DispatchRecord[]
}) {
  let attempted = 0, dispatched = 0
  let failure: EvalFailureCode | null = null
  const fail = (code: EvalFailureCode): never => { failure ??= code; throw new EvaluationError(code) }
  const guardedFetch: typeof fetch = async (input, init) => {
    attempted++
    if (failure) throw new EvaluationError(failure)
    const expected = options.expected()
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    // The real SDK emits a string URL, string JSON body and one bounded request signal.
    if (!expected || url !== options.endpoint || init?.method !== 'POST' || init.redirect !== 'error'
      || !init.signal || init.signal.aborted || typeof init.body !== 'string') return fail('dispatch_denied')
    const headers = new Headers(init.headers)
    if (headers.get('authorization') !== `Bearer ${options.credential}` || headers.get('content-type') !== 'application/json') return fail('dispatch_denied')
    for (const name of headers.keys()) if (!['authorization', 'content-type', 'user-agent'].includes(name)) return fail('dispatch_denied')
    let body: Record<string, unknown>
    try { body = JSON.parse(init.body) } catch { return fail('dispatch_denied') }
    if (!object(body) || body.model !== options.model || Object.keys(body).some(k => !['model', 'messages', 'max_tokens', 'max_completion_tokens', 'temperature'].includes(k))
      || (body.max_tokens ?? body.max_completion_tokens) !== 1_200
      || (Object.hasOwn(body, 'max_tokens') === Object.hasOwn(body, 'max_completion_tokens'))
      || (body.temperature !== undefined && body.temperature !== 0.2)
      || JSON.stringify(body.messages) !== JSON.stringify([{ role: 'system', content: expected.system }, { role: 'user', content: expected.prompt }])
      || Buffer.byteLength(init.body) > 65_536 || init.body.includes(options.credential)) return fail('dispatch_denied')
    if (dispatched >= options.maxRequests) return fail('request_budget')
    dispatched++
    const record: DispatchRecord = { phase: expected.phase, requestSha256: sha256(init.body), requestBytes: Buffer.byteLength(init.body), responseStatus: null }
    options.records.push(record)
    // No body clone or unbounded parsing here. APIService's real bounded fetch reads
    // decoded success/error bytes (65,536) and owns abort/deadline/redirect handling.
    const response = await options.send(input, init)
    record.responseStatus = response.status
    return response
  }
  return { fetch: guardedFetch, counts: () => ({ attempted, dispatched, failure }) }
}

/** Belt-and-suspenders offline boundary: a saved native fetch or direct Node socket
 * cannot bypass the mocked fetch. Only used by the standalone, serialized runner. */
export function blockNodeNetwork() {
  const restored: Array<() => void> = []
  let denied = 0
  const block = () => { denied++; throw new EvaluationError('dispatch_denied') }
  const patch = (target: object, key: string) => {
    const record = target as Record<string, unknown>, old = record[key]
    record[key] = block; restored.push(() => { record[key] = old })
  }
  for (const key of ['request', 'get']) { patch(http, key); patch(https, key) }
  for (const key of ['connect', 'createConnection']) patch(net, key)
  patch(net.Socket.prototype, 'connect'); patch(tls, 'connect'); patch(dgram, 'createSocket')
  if ('WebSocket' in globalThis) patch(globalThis, 'WebSocket')
  syncBuiltinESMExports()
  return { count: () => denied, restore: () => { for (const restore of restored.reverse()) restore(); syncBuiltinESMExports() } }
}
