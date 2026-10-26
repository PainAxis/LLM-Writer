/** Runtime-only bounded verification. No progress is persisted or grants authority. */
import type { ProducerVerificationContext, ProducerVerificationProgress, ProducerVerificationStats } from './verificationTypes'
import type { CampaignActionScope, CampaignRepository, CampaignSnapshot } from '../../types/writerCampaign'
import { CAMPAIGN_LIMITS, campaignAssert, campaignInteger } from './protocol'

export class ProducerVerificationError extends Error {
  constructor(readonly code: 'cancelled' | 'deadline_exceeded' | 'operation_timeout' | 'verification_capacity' | 'verification_quantum_exceeded') { super(code); this.name = 'ProducerVerificationError' }
}
export function emptyVerificationStats(): ProducerVerificationStats {
  return { protocol: 'producer-verification-session-v1', sessionsStarted: 0, sessionsCompleted: 0, sessionsFailed: 0, sessionsCancelled: 0,
    sessionsDisposed: 0, activeSessions: 0, sessionMaxMs: 0, rawIoCalls: 0, rawIoMaxMs: 0, casCalls: 0, casMaxMs: 0,
    advances: 0, maxOperationsPerAdvance: 0, hostYields: 0, synchronousSegmentMaxMs: 0, finalFencePasses: 0,
    finalFenceMaxMs: 0, finalFenceExpectedRecords: 0, finalFenceObservedRecords: 0,
    retainedBytes: 0, retainedEntries: 0, activePayloadRecords: 0, peakRetainedBytes: 0, peakRetainedEntries: 0, peakActivePayloadRecords: 0 }
}
const add = (a: number, b = 1) => Math.min(Number.MAX_SAFE_INTEGER, a + b)
type Partition = 'origin' | 'tail'

/** Registered once by the actual v2 repository; no caller-supplied decoded proof. */
export interface CampaignVerificationBridge {
  read(campaignId: string, scope: CampaignActionScope, executor: ProducerVerificationExecutor): Promise<CampaignSnapshot | null>
  capture(scope: CampaignActionScope, executor: ProducerVerificationExecutor, key: string, raw: string, valueBytes: number): void
  requireCapture(scope: CampaignActionScope, executor: ProducerVerificationExecutor): void
  sealAggregate(scope: CampaignActionScope, executor: ProducerVerificationExecutor, verifiedWrittenBytes: number, activePayloadRecords: number): void
  fence(scope: CampaignActionScope, executor: ProducerVerificationExecutor, expectedRawHead: string): Promise<void>
}
const bridges = new WeakMap<CampaignRepository, CampaignVerificationBridge>()
export function registerCampaignVerificationBridge(repository: CampaignRepository, bridge: CampaignVerificationBridge): void {
  campaignAssert(!bridges.has(repository), 'Verification bridge already registered')
  bridges.set(repository, bridge)
}
export function campaignVerificationBridge(repository: CampaignRepository): CampaignVerificationBridge {
  const bridge = bridges.get(repository)
  campaignAssert(bridge, 'Repository has no private verification bridge', 'conflict')
  return bridge
}

/** The async stack is the continuation. Only counts escape through progress. */
export class ProducerVerificationExecutor {
  private readonly entered = performance.now()
  private readonly ownerStartedAt: number
  private deadline: number
  private readonly signal: AbortSignal
  private readonly ownerCheck: () => void
  private readonly progress: ProducerVerificationContext['onProgress']
  private terminal = false
  private outcome: 'completed' | 'failed' | 'cancelled' | null = null
  private casPermit: { deadline: number; open: boolean } | null = null
  private resumeFence: (() => Promise<void>) | null = null
  private legacy = false
  private purpose: ProducerVerificationProgress['purpose'] | null = null
  private stage: ProducerVerificationProgress['stage'] = 'discovery'
  private operations = 0
  private operationQuantum = 0
  private totalOperations: number | null = null
  private synchronousStarted = this.entered
  private synchronousAccumulated = 0
  private lastHostYield = this.entered
  private fenceStarted: number | null = null
  private fenceObserved = 0
  private fenceExpected = 0
  private readonly originKeys = new Set<string>()
  private readonly tailKeys = new Set<string>()
  private readonly validatedKeys = new Set<string>()
  private capture: ((key: string, raw: string, valueBytes: number) => void) | null = null
  private retention: (() => { bytes: number; entries: number; active: number }) | null = null
  constructor(context: ProducerVerificationContext, private readonly stats: ProducerVerificationStats, private readonly scopeCheck: () => void,
    private readonly campaignId: string) {
    // Capture once. Subsequent caller mutation cannot extend the deadline or replace ownership.
    this.ownerStartedAt = context.ownerStartedAt; this.deadline = context.deadline
    this.signal = context.signal; this.ownerCheck = context.check; this.progress = context.onProgress
    stats.sessionsStarted = add(stats.sessionsStarted); stats.activeSessions = add(stats.activeSessions)
  }
  start(): void {
    campaignAssert(Number.isFinite(this.ownerStartedAt) && this.ownerStartedAt >= 0 && this.ownerStartedAt <= this.entered
      && Number.isFinite(this.deadline) && this.deadline <= this.ownerStartedAt + 10_000, 'Invalid verification absolute deadline', 'conflict')
    this.check()
  }
  private checkOwner(): void {
    this.scopeCheck()
    // Absolute deadline wins over an abort caused by deadline expiration.
    if (performance.now() >= this.deadline) throw new ProducerVerificationError('deadline_exceeded')
    if (this.signal.aborted) throw new ProducerVerificationError('cancelled')
    const check = this.ownerCheck
    check()
    if (performance.now() >= this.deadline) throw new ProducerVerificationError('deadline_exceeded')
    if (this.signal.aborted) throw new ProducerVerificationError('cancelled')
  }
  check = (): void => {
    campaignAssert(!this.terminal, 'Verification continuation closed', 'conflict')
    this.checkOwner()
    if (!this.legacy) {
      const elapsed = this.synchronousAccumulated + Math.max(0, performance.now() - this.synchronousStarted)
      this.stats.synchronousSegmentMaxMs = Math.max(this.stats.synchronousSegmentMaxMs, elapsed)
      if (elapsed >= 250) throw new ProducerVerificationError('verification_quantum_exceeded')
    }
  }
  setLegacyInspection(): void {
    this.legacy = true; this.deadline = Math.min(this.deadline, this.entered + 3_000); this.check()
  }
  setPurpose(purpose: ProducerVerificationProgress['purpose']): void {
    campaignAssert(this.purpose === null || this.purpose === purpose, 'Verification purpose cannot change', 'conflict')
    this.purpose = purpose; this.publish()
  }
  setStage(stage: ProducerVerificationProgress['stage']): void { this.check(); this.stage = stage; this.publish() }
  setTotal(total: number): void { campaignInteger(total, CAMPAIGN_LIMITS.operations); this.totalOperations = total }
  bindResumeFence(fence: () => Promise<void>): void {
    campaignAssert(this.resumeFence === null, 'Verification resume fence cannot rebase', 'conflict')
    this.resumeFence = fence
  }
  bindCapture(capture: NonNullable<ProducerVerificationExecutor['capture']>, retention: NonNullable<ProducerVerificationExecutor['retention']>): void {
    campaignAssert(this.capture === null, 'Verification cannot acquire another proof', 'conflict')
    this.capture = capture; this.retention = retention
  }
  captureRaw(partition: Partition, key: string, raw: string, valueBytes: number): void {
    this.check()
    const prefix = `writer-campaign:${encodeURIComponent(this.campaignId)}:`
    campaignAssert(key.startsWith(prefix) && key.startsWith(`${prefix}v3:`) === (partition === 'tail'), 'Verification record partition mismatch')
    campaignAssert(this.capture, 'Verification capture was not admitted', 'conflict')
    const own = partition === 'origin' ? this.originKeys : this.tailKeys, other = partition === 'origin' ? this.tailKeys : this.originKeys
    campaignAssert(!other.has(key), 'Verification partitions overlap')
    this.capture(key, raw, valueBytes); own.add(key)
    if (this.originKeys.size + this.tailKeys.size > 8193) throw new ProducerVerificationError('verification_capacity')
    this.observeRetention()
  }
  validated(key: string): void {
    campaignAssert(this.originKeys.has(key) || this.tailKeys.has(key), 'Validated record lacks captured source')
    this.validatedKeys.add(key)
  }
  assertCoverage(entries: ReadonlyMap<string, unknown>): void {
    const expected = this.originKeys.size + this.tailKeys.size
    campaignAssert(expected > 0 && entries.size === expected && this.validatedKeys.size === expected, 'Verification capture coverage is incomplete')
    for (const key of entries.keys()) campaignAssert(this.originKeys.has(key) || this.tailKeys.has(key), 'Verification captured an unvalidated record')
    this.check()
  }
  private observeRetention(): void {
    const current = this.retention?.()
    if (!current) return
    this.stats.retainedBytes = current.bytes; this.stats.retainedEntries = current.entries; this.stats.activePayloadRecords = current.active
    this.stats.peakRetainedBytes = Math.max(this.stats.peakRetainedBytes, current.bytes)
    this.stats.peakRetainedEntries = Math.max(this.stats.peakRetainedEntries, current.entries)
    this.stats.peakActivePayloadRecords = Math.max(this.stats.peakActivePayloadRecords, current.active)
  }
  private publish(): void {
    this.check(); this.observeRetention()
    if (this.purpose && this.progress) {
      const progress = this.progress, retained = this.retention?.()
      progress(Object.freeze({ purpose: this.purpose, stage: this.stage, verifiedOperations: this.operations,
        verifiedRecords: this.validatedKeys.size, capturedBytes: retained?.bytes ?? 0, capturedEntries: retained?.entries ?? 0, totalOperations: this.totalOperations }))
      this.check()
    }
  }
  async checkpoint(operation = false): Promise<void> {
    this.check()
    if (operation) { this.operations++; this.operationQuantum++; campaignAssert(this.operations <= CAMPAIGN_LIMITS.operations && this.operationQuantum <= 8, 'Verification operation quantum exceeded') }
    if (this.operationQuantum >= 8 || performance.now() - this.lastHostYield >= 50) {
      this.flushAdvance(); this.publish(); this.stats.hostYields = add(this.stats.hostYields)
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      this.synchronousStarted = performance.now(); this.lastHostYield = this.synchronousStarted
      this.synchronousAccumulated = 0
      this.check()
      campaignAssert(this.resumeFence, 'Verification suspension lacks a source fence', 'conflict')
      await this.resumeFence()
      this.check()
    }
  }
  private flushAdvance(): void {
    this.stats.advances = add(this.stats.advances)
    this.stats.maxOperationsPerAdvance = Math.max(this.stats.maxOperationsPerAdvance, this.operationQuantum)
    this.operationQuantum = 0
  }
  async io<T>(kind: 'read' | 'cas', action: () => Promise<T>): Promise<T> {
    if (this.terminal) this.checkOwner(); else this.check()
    const started = performance.now(), deadline = Math.min(started + 3_000, this.deadline)
    if (kind === 'cas') {
      campaignAssert(this.outcome === 'completed' && this.casPermit === null, 'Adoption baseline permits one CAS only', 'conflict')
      this.casPermit = { deadline, open: true }
    }
    this.synchronousAccumulated += Math.max(0, started - this.synchronousStarted)
    if (kind === 'read') this.stats.rawIoCalls = add(this.stats.rawIoCalls); else this.stats.casCalls = add(this.stats.casCalls)
    let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined, resumedAt: number | null = null
    try {
      const result = await new Promise<T>((resolve, reject) => {
        let settled = false
        const end = (error: unknown, value?: T) => { if (settled) return; settled = true; if (timer !== undefined) clearTimeout(timer); if (abort) this.signal.removeEventListener('abort', abort); if (error) reject(error); else resolve(value!) }
        abort = () => end(new ProducerVerificationError(performance.now() >= this.deadline ? 'deadline_exceeded' : 'cancelled'))
        this.signal.addEventListener('abort', abort, { once: true })
        timer = setTimeout(() => end(new ProducerVerificationError(performance.now() >= this.deadline ? 'deadline_exceeded' : 'operation_timeout')), Math.max(0, deadline - performance.now()))
        Promise.resolve().then(() => {
          this.checkOwner()
          if (performance.now() >= deadline) throw new ProducerVerificationError('operation_timeout')
          const invoked = performance.now()
          try { return action() }
          finally { this.synchronousAccumulated += Math.max(0, performance.now() - invoked) }
        }).then(value => end(null, value), error => end(error))
      })
      resumedAt = performance.now()
      this.checkOwner()
      if (performance.now() >= deadline) throw new ProducerVerificationError('operation_timeout')
      return result
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (abort) this.signal.removeEventListener('abort', abort)
      const elapsed = Math.max(0, performance.now() - started)
      if (kind === 'read') this.stats.rawIoMaxMs = Math.max(this.stats.rawIoMaxMs, elapsed); else this.stats.casMaxMs = Math.max(this.stats.casMaxMs, elapsed)
      // Exclude awaited IO, but an immediately resolved Promise does not reset
      // accumulated CPU. Only our explicit host-task yield does that.
      if (resumedAt !== null) this.synchronousAccumulated += Math.max(0, performance.now() - resumedAt)
      this.synchronousStarted = performance.now()
      if (kind === 'cas' && this.casPermit) this.casPermit.open = false
    }
  }
  beginFence(): void {
    this.setStage('final_fence'); this.fenceStarted = performance.now(); this.fenceObserved = 0
    this.fenceExpected = this.originKeys.size + this.tailKeys.size
    this.stats.finalFenceExpectedRecords = add(this.stats.finalFenceExpectedRecords, this.fenceExpected)
  }
  matchedRecord(key: string): void {
    campaignAssert(this.fenceStarted !== null && (this.originKeys.has(key) || this.tailKeys.has(key)), 'Unexpected final verification record')
    this.fenceObserved++; this.stats.finalFenceObservedRecords = add(this.stats.finalFenceObservedRecords)
  }
  endFence(passed: boolean): void {
    if (this.fenceStarted === null) return
    this.stats.finalFenceMaxMs = Math.max(this.stats.finalFenceMaxMs, performance.now() - this.fenceStarted)
    this.fenceStarted = null
    if (passed) {
      campaignAssert(this.fenceObserved === this.fenceExpected, 'Final verification coverage is incomplete')
      this.stats.finalFencePasses = add(this.stats.finalFencePasses)
    }
  }
  complete(): void { this.check(); this.flushAdvance(); this.publish(); this.finish('completed') }
  fail(error: unknown): void {
    if (this.terminal) return
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    const reason: unknown = this.signal.reason
    const reasonCode = reason && typeof reason === 'object' && 'code' in reason ? String(reason.code) : ''
    const expired = performance.now() >= this.deadline || [code, reasonCode].some(value => value === 'deadline_exceeded' || value === 'operation_timeout')
    this.finish(!expired && (code === 'cancelled' || this.signal.aborted) ? 'cancelled' : 'failed')
  }
  private finish(outcome: 'completed' | 'failed' | 'cancelled'): void {
    if (this.terminal) return
    this.endFence(false); this.observeRetention(); this.terminal = true; this.outcome = outcome
    if (outcome === 'completed') this.stats.sessionsCompleted = add(this.stats.sessionsCompleted)
    else if (outcome === 'cancelled') this.stats.sessionsCancelled = add(this.stats.sessionsCancelled)
    else this.stats.sessionsFailed = add(this.stats.sessionsFailed)
    this.stats.sessionsDisposed = add(this.stats.sessionsDisposed); this.stats.activeSessions--
    this.stats.sessionMaxMs = Math.max(this.stats.sessionMaxMs, performance.now() - this.entered)
    this.originKeys.clear(); this.tailKeys.clear(); this.validatedKeys.clear(); this.capture = null; this.retention = null; this.resumeFence = null
  }
  canCommit(): boolean {
    try {
      this.checkOwner()
      return this.outcome === 'completed' && (!this.casPermit || this.casPermit.open && performance.now() < this.casPermit.deadline)
    } catch { return false }
  }
}
