/** Controlled-build App seam only. Native IDB/SDK remain the production implementations.
 * Delays target actual IO/ACKs. Private reads never create artifacts or grants. */
import type { App } from 'vue'
import type { CreativeProgressEvent, CreativeRepository, CreativeSnapshot } from '../../src/types/creativePilot'
import type { CampaignRepositoryIO } from '../../src/types/writerCampaign'
import { idbCompareAndSwapMany, idbGetMany } from '../../src/services/blobStore'
import { createCreativePilotRepository } from '../../src/services/writerCampaign/creativePilotStore'
import { createCreativeOfflineSdkHost } from '../../src/services/writerCampaign/creativePilotTransport'
import { creativePilotHostKey, creativePilotRepositoryKey, creativePilotProgressObserverKey } from '../../src/composables/creativePilotHost'
import { creativeControlConfiguration, creativeControlIdentity } from './creative-pilot-control'
import { observeCreativeIO } from './creative-pilot-io'
import { byteOracle, controlAssert, rowMapOracle } from './creative-pilot-oracles'
import { emptyCreativeMetrics, type CreativeMetrics } from './creative-pilot-report'

type HoldMode = 'before_read' | 'after_read' | 'after_cas'
type Trace = Array<{ keys: string[]; rows: Map<string, string | null> }>
export type CreativeAppSnapshot = Omit<CreativeSnapshot, 'artifacts' | 'requests' | 'phases' | 'responses'> & {
  artifacts: Array<[string, CreativeSnapshot['artifacts'] extends ReadonlyMap<string, infer T> ? T : never]>
  requests: Array<[string, CreativeSnapshot['requests'] extends Map<string, infer T> ? T : never]>
  phases: Array<[string, CreativeSnapshot['phases'] extends Map<string, infer T> ? T : never]>
  responses: Array<[string, CreativeSnapshot['responses'] extends Map<string, infer T> ? T : never]>
}
interface AppControl {
  revision: string; disposed: boolean; activeRepositoryOperations: number; activeIoOperations: number
  holdEntries: number; armed: { mode: HoldMode; minimumReads: number; reads: number; kind: string | null } | null
  held: boolean; entered: boolean; release: (() => void) | null; traceOverlap: boolean
  metrics: CreativeMetrics; observeIo: ReturnType<typeof observeCreativeIO>['observe']; repository: CreativeRepository | null
  pendingRequestOutcomes: Set<string>
  lastTrace: Trace; events: Array<CreativeProgressEvent & { elapsedMs: number }>; started: number
}
let current: AppControl | null = null
function control(): AppControl { if (!current || current.disposed) throw new Error('creative_app_control_not_installed'); return current }
export function armCreativeIoHold(mode: HoldMode, minimumReads = 1): void {
  const state = control()
  if (!['before_read', 'after_read', 'after_cas'].includes(mode) || !Number.isSafeInteger(minimumReads)
    || minimumReads < 0 || minimumReads > 4096 || state.armed || state.held) throw new Error('creative_app_control_invalid_hold')
  state.armed = { mode, minimumReads, reads: 0, kind: null }; state.entered = false
}
/** Selects a real committed receipt ACK; it cannot write or manufacture that receipt. */
export function armCreativeCommitAckHold(kind: 'dispatch_intent' | 'retain_response'): void {
  controlAssert(['dispatch_intent', 'retain_response'].includes(kind))
  armCreativeIoHold('after_cas', 0); control().armed!.kind = kind
}
export function releaseCreativeIoHold(): void { const state = control(); state.armed = null; const release = state.release; state.release = null; release?.() }
export function observeCreativeIoHold() {
  const state = control(), io = state.observeIo()
  return Object.freeze({ armed: state.armed !== null, held: state.held, entered: state.entered, holdEntries: state.holdEntries,
    readCalls: io.readCalls, casCalls: io.casCalls, successfulCas: io.successfulCas,
    activeRepositoryOperations: state.activeRepositoryOperations, activeIoOperations: state.activeIoOperations, pendingRequestOutcomes: state.pendingRequestOutcomes.size })
}
export function revokeCreativeControlHost(): void { control().revision = 'creative-control-revoked' }
export function observeCreativeAppMetrics() {
  const s = control(), io = s.observeIo()
  return { metrics: { ...s.metrics, readCalls: io.readCalls, readBytes: io.readBytes, casCalls: io.casCalls,
    successfulCas: io.successfulCas, accountingMismatches: io.accountingMismatches, maxReadBatchKeys: io.maxReadBatchKeys,
    maxReadBatchBytes: io.maxReadBatchBytes, maxRawIoMs: io.maxRawIoMs, maxCasMs: io.maxCasMs },
    traceOverlap: s.traceOverlap, events: s.events.map(e => ({ ...e })) }
}
/** Private bounded cursor. Data never enters source-free reports or artifacts. */
async function nativeRows(): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    let settled = false, db: IDBDatabase | null = null, tx: IDBTransaction | null = null
    const fail = (code: string) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      try { tx?.abort() } catch { /* A completed readonly transaction needs no abort. */ }
      db?.close(); reject(new Error(code))
    }
    const timer = setTimeout(() => fail('creative_app_private_read_timeout'), 3000)
    void idbGetMany(['writer-campaign:catalog']).then(() => {
      if (settled) return
      const opening = indexedDB.open('llm-writer', 1)
      opening.onerror = () => fail('creative_app_private_read')
      opening.onblocked = () => fail('creative_app_private_read')
      opening.onsuccess = () => {
        if (settled) { opening.result.close(); return }
        db = opening.result; tx = db.transaction('kv', 'readonly')
        const rows = new Map<string, string>(); let bytes = 0
        const request = tx.objectStore('kv').openCursor()
        request.onsuccess = () => {
          if (settled) return
          const cursor = request.result
          if (!cursor) return
          try {
            controlAssert(typeof cursor.key === 'string' && typeof cursor.value === 'string')
            bytes += byteOracle(cursor.key) + byteOracle(cursor.value)
            controlAssert(rows.size < 6000 && bytes <= 67108864)
            rows.set(cursor.key, cursor.value); cursor.continue()
          } catch { fail('creative_app_private_capacity') }
        }
        tx.oncomplete = () => { if (settled) return; settled = true; clearTimeout(timer); db!.close(); resolve(rows) }
        tx.onabort = tx.onerror = () => fail('creative_app_private_read')
      }
    }).catch(() => fail('creative_app_private_read'))
  })
}

export async function readCreativeOrdinaryDigest(): Promise<string> {
  const rows = new Map([...await nativeRows()].filter(([key]) => !key.startsWith('writer-campaign:')).map(([key, value]) => ['idb:' + key, value] as const))
  for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i)!; rows.set('local:' + key, localStorage.getItem(key)!) }
  return rowMapOracle(rows)
}
/** Failure diagnosis only: one real readonly transaction, not a verified replay.
 * Exported bytes stay in the outer runner's private directory and never archives. */
export async function readCreativeFailureRows(campaignId: string | null): Promise<Array<[string, string]>> {
  const prefix = campaignId === null ? 'writer-campaign:' : `writer-campaign:${encodeURIComponent(campaignId)}:`
  return [...await nativeRows()].filter(([key]) => key.startsWith(prefix) || key === 'writer-campaign:catalog')
}
export async function readCreativeAppEvidence(campaignId: string) {
  const state = control(); controlAssert(!state.activeRepositoryOperations && !state.activeIoOperations && !state.held && state.pendingRequestOutcomes.size === 0)
  const snapshot = await state.repository!.read(campaignId)
  controlAssert(snapshot)
  const trace = state.lastTrace.map(batch => ({ keys: [...batch.keys], rows: [...batch.rows] }))
  const all = await nativeRows(), prefix = `writer-campaign:${encodeURIComponent(campaignId)}:`
  const rows = [...all].filter(([key]) => key.startsWith(prefix) || key === 'writer-campaign:catalog')
  controlAssert(all.get(prefix + 'head') === snapshot.rawHead)
  const serial: CreativeAppSnapshot = { ...snapshot, artifacts: [...snapshot.artifacts], requests: [...snapshot.requests], phases: [...snapshot.phases], responses: [...snapshot.responses] }
  return { snapshot: serial, rows, trace, ...observeCreativeAppMetrics() }
}

export async function installCreativePilotApp(app: App, explicitLoopbackEndpoint: string): Promise<{ dispose(): void }> {
  if (current && !current.disposed) throw new Error('creative_app_control_already_installed')
  const configuration = creativeControlConfiguration(explicitLoopbackEndpoint), identity = creativeControlIdentity(explicitLoopbackEndpoint)
  const initial = new Map([...await nativeRows()].filter(([key]) => key.startsWith('writer-campaign:')))
  const meter = observeCreativeIO({ getMany: idbGetMany, compareAndSwapMany: idbCompareAndSwapMany }, initial)
  const state: AppControl = { revision: identity.configurationRevision, disposed: false, activeRepositoryOperations: 0, activeIoOperations: 0,
    holdEntries: 0, armed: null, held: false, entered: false, release: null, traceOverlap: false,
    metrics: emptyCreativeMetrics(), observeIo: meter.observe, repository: null, pendingRequestOutcomes: new Set(), lastTrace: [], events: [], started: performance.now() }
  const host = createCreativeOfflineSdkHost({ identity, currentConfigurationRevision: () => state.revision, readConfiguration: () => ({ ...configuration, customHeaders: {} }) })
  async function hold(mode: HoldMode, kind: string | null = null) {
    const selected = state.armed
    if (!selected || selected.mode !== mode || selected.reads < selected.minimumReads || selected.kind !== null && selected.kind !== kind) return
    state.armed = null; state.held = true; state.entered = true; state.holdEntries++
    try { await new Promise<void>(resolve => { state.release = resolve }) } finally { state.held = false; state.release = null }
  }
  const io: CampaignRepositoryIO = {
    async getMany(keys) {
      state.activeIoOperations++
      try { if (state.armed) state.armed.reads++; await hold('before_read'); const rows = await meter.io.getMany(keys); await hold('after_read'); return rows }
      finally { state.activeIoOperations-- }
    },
    async compareAndSwapMany(entries, canCommit) {
      state.activeIoOperations++
      try {
        const committed = await meter.io.compareAndSwapMany(entries, canCommit)
        if (committed) {
          const records = entries.map(e => JSON.parse(e.value)), receipt = records.find(v => v.protocolVersion === 'creative-pilot-receipt-v4')
          const phase = records.find(v => v.protocol === 'creative-pilot-phase-v1')
          // These are actual writes made in this JS lifetime, not an inference
          // that reopened durable intents still have a live request owner.
          if (phase && phase.status === 'dispatch_intent') state.pendingRequestOutcomes.add(phase.requestHash)
          if (phase && ['response_retained', 'outcome_unknown', 'resolved'].includes(phase.status)) state.pendingRequestOutcomes.delete(phase.requestHash)
          await hold('after_cas', receipt?.kind ?? null)
        }
        return committed
      } finally { state.activeIoOperations-- }
    },
  }
  const repository = createCreativePilotRepository({ io })
  async function operation<T>(name: string, run: () => Promise<T>): Promise<T> {
    const tracing = state.activeRepositoryOperations === 0, started = performance.now()
    if (tracing) meter.beginTrace(); else state.traceOverlap = true
    state.activeRepositoryOperations++
    try { return await run() } finally {
      state.activeRepositoryOperations--
      if (tracing) { const trace = meter.endTrace(); if (name === 'read') state.lastTrace = trace }
      const elapsed = performance.now() - started
      state.metrics.maxRepositoryActionMs = Math.max(state.metrics.maxRepositoryActionMs, elapsed)
      if (name === 'read') state.metrics.maxVerifiedReadMs = Math.max(state.metrics.maxVerifiedReadMs, elapsed)
    }
  }
  const observed: CreativeRepository = Object.freeze({
    read: (...args: Parameters<CreativeRepository['read']>) => operation('read', () => repository.read(...args)),
    create: (...args: Parameters<CreativeRepository['create']>) => operation('create', () => repository.create(...args)),
    replaceBrief: (...args: Parameters<CreativeRepository['replaceBrief']>) => operation('replace', () => repository.replaceBrief(...args)),
    commit: (...args: Parameters<CreativeRepository['commit']>) => operation('commit', () => repository.commit(...args)),
    getReceipt: (...args: Parameters<CreativeRepository['getReceipt']>) => operation('receipt', () => repository.getReceipt(...args)),
  })
  state.repository = observed; current = state
  const stages = new Map<string, number>(), sdks = new Map<string, number>()
  app.provide(creativePilotProgressObserverKey, event => {
    const now = performance.now(), key = `${event.campaignId}:${event.ownerId}`
    if (state.events.length < 1024) state.events.push({ ...event, elapsedMs: now - state.started })
    else state.traceOverlap = true // Evidence capacity failure, never a production veto.
    if (event.taskId && event.kind === 'verifying' && !stages.has(key)) stages.set(key, now)
    if (event.kind === 'reserved') sdks.set(key, now)
    if (event.kind === 'response_retained' && sdks.has(key)) { state.metrics.maxSdkMs = Math.max(state.metrics.maxSdkMs, now - sdks.get(key)!); sdks.delete(key) }
    if (event.taskId && ['accepted', 'refused', 'blocked', 'authority_revoked', 'stopped', 'expired'].includes(event.kind)) {
      if (stages.has(key)) { state.metrics.maxStageMs = Math.max(state.metrics.maxStageMs, now - stages.get(key)!); stages.delete(key) }
      if (sdks.has(key)) { state.metrics.maxSdkMs = Math.max(state.metrics.maxSdkMs, now - sdks.get(key)!); sdks.delete(key) }
    }
    state.metrics.activeOwners = stages.size; state.metrics.activeCalls = sdks.size
  })
  app.provide(creativePilotHostKey, host); app.provide(creativePilotRepositoryKey, observed)
  return Object.freeze({ dispose() { if (state.disposed) return; state.disposed = true; state.revision = 'creative-control-revoked'; state.armed = null; state.release?.(); state.release = null } })
}
