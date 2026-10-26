import type { CampaignActionProofStats, CampaignActionScope, CampaignProofDisposalReason, CampaignSnapshot } from '../../types/writerCampaign'
import { CAMPAIGN_LIMITS, campaignAssert, campaignId, campaignInteger, decodeStorageBytes, utf8Bytes } from './protocol'

export const CAMPAIGN_PROOF_ENTRY_LIMIT = 4 * CAMPAIGN_LIMITS.operations + 1
export const CAMPAIGN_PROOF_BATCH_BYTES = CAMPAIGN_LIMITS.recordBytes

type RawEntry = { raw: string; bytes: number }
export interface CampaignProofLease {
  readonly campaignId: string
  live: boolean
  cancelled: boolean
  busy: boolean
  attempted: boolean
  entries: Map<string, RawEntry>
  bytes: number
  activeRecords: number
  snapshot: CampaignSnapshot | null
  catalogPrefix: string[]
  /** Identity only, retained across capacity fallback; never a replacement proof. */
  verificationHead: string | null
}

function add(a: number, b = 1): number { return Math.min(Number.MAX_SAFE_INTEGER, a + b) }

/** Repository-local ownership, not a cross-action cache. Nothing here is persisted.
 * The only strong lease reference belongs to the single admitted scope. Tokens
 * have no data or authority outside this instance's private WeakMap.
 */
export class CampaignActionProofPool {
  private readonly scopes = new WeakMap<CampaignActionScope, CampaignProofLease>()
  private admitted: CampaignProofLease | null = null
  private readonly maxBytes: number
  private readonly maxEntries: number
  private readonly stats: CampaignActionProofStats = {
    admittedScopes: 0, fallbackScopes: 0, disposedScopes: 0, coldReplays: 0, coldReplaysCompleted: 0,
    exactPasses: 0, exactRecords: 0, exactBytes: 0, transitions: 0,
    retainedBytes: 0, retainedEntries: 0, peakRetainedBytes: 0, peakRetainedEntries: 0, activeRecords: 0, peakActiveRecords: 0,
    coldMs: 0, coldMaxMs: 0, exactMs: 0, exactMaxMs: 0,
    disposalReasons: { completed: 0, capacity: 0, admission: 0, concurrent: 0, mismatch: 0, conflict: 0, error: 0, replay: 0 },
  }

  // Reduced caps let focused unit tests exercise exact boundaries without
  // allocating a 64 MiB fixture. Production always uses the fixed defaults.
  constructor(limits: { bytes?: number; entries?: number } = {}) {
    this.maxBytes = limits.bytes ?? CAMPAIGN_LIMITS.serializedBytes
    this.maxEntries = limits.entries ?? CAMPAIGN_PROOF_ENTRY_LIMIT
    campaignInteger(this.maxBytes, CAMPAIGN_LIMITS.serializedBytes)
    campaignInteger(this.maxEntries, CAMPAIGN_PROOF_ENTRY_LIMIT)
  }

  create(campaignIdValue: string): CampaignActionScope {
    campaignId(campaignIdValue)
    const token = Object.freeze({}) as CampaignActionScope
    this.scopes.set(token, { campaignId: campaignIdValue, live: true, cancelled: false, busy: false, attempted: false, entries: new Map(), bytes: 0, activeRecords: 0, snapshot: null, catalogPrefix: [], verificationHead: null })
    return token
  }

  begin(token: CampaignActionScope | undefined, campaignIdValue: string): CampaignProofLease | null {
    const lease = token && this.scopes.get(token)
    if (!lease?.live) return null
    if (lease.campaignId !== campaignIdValue) { this.discard(lease, 'mismatch'); return null }
    if (lease.busy) { this.discard(lease, 'concurrent'); return null }
    lease.busy = true
    return lease
  }
  end(lease: CampaignProofLease | null): void { if (lease) lease.busy = false }
  seedVerification(lease: CampaignProofLease | null, snapshot: CampaignSnapshot | null): void {
    if (lease && !lease.cancelled && snapshot) lease.verificationHead = snapshot.rawHead
  }
  /** Strict acquisition is separate from legacy begin's optional optimization. */
  acquireForVerification(token: CampaignActionScope, campaignIdValue: string, expectedRawHead: string): CampaignProofLease {
    const lease = this.scopes.get(token)
    campaignAssert(lease && !lease.cancelled && lease.campaignId === campaignIdValue, 'Unknown or closed Campaign verification scope', 'conflict')
    if (lease.busy) { this.discard(lease, 'concurrent'); campaignAssert(false, 'Concurrent Campaign verification scope', 'conflict') }
    if (lease.verificationHead !== expectedRawHead || lease.verificationHead === null) {
      this.discard(lease, 'conflict'); campaignAssert(false, 'Campaign verification scope cannot rebase', 'conflict')
    }
    lease.busy = true
    return lease
  }
  isLive(lease: CampaignProofLease | null): boolean { return lease !== null && lease.live }
  canCommit(lease: CampaignProofLease | null): boolean { return lease === null || !lease.cancelled }
  dispose(token: CampaignActionScope): void { const lease = this.scopes.get(token); if (lease) this.discard(lease, 'completed') }

  discard(lease: CampaignProofLease | null, reason: CampaignProofDisposalReason): void {
    if (!lease) return
    // Admission/capacity only disable an optional optimization. Action closure
    // also fences operations already in flight, including their cold fallback.
    if (reason !== 'capacity' && reason !== 'admission') { lease.cancelled = true; lease.verificationHead = null }
    if (!lease.live) return
    lease.live = false
    lease.entries.clear(); lease.bytes = 0; lease.activeRecords = 0; lease.snapshot = null; lease.catalogPrefix = []
    if (this.admitted === lease) { this.admitted = null; this.stats.retainedBytes = 0; this.stats.retainedEntries = 0; this.stats.activeRecords = 0 }
    this.stats.disposedScopes = add(this.stats.disposedScopes)
    this.stats.disposalReasons[reason] = add(this.stats.disposalReasons[reason])
    if (reason === 'capacity' || reason === 'admission' || reason === 'concurrent') this.stats.fallbackScopes = add(this.stats.fallbackScopes)
  }

  capture(lease: CampaignProofLease | null): void {
    if (!lease?.live || lease.attempted) return
    lease.attempted = true
    if (this.admitted) { this.discard(lease, 'admission'); return }
    this.admitted = lease
    this.stats.admittedScopes = add(this.stats.admittedScopes)
  }

  collecting(lease: CampaignProofLease | null): lease is CampaignProofLease {
    return lease !== null && lease.live && this.admitted === lease
  }

  observe(lease: CampaignProofLease | null, key: string, raw: string, valueBytes: number): void {
    if (!this.collecting(lease)) return
    const old = lease.entries.get(key)
    campaignAssert(old === undefined || old.raw === raw, 'Immutable record changed during proof capture')
    if (old) {
      // Preserve the last-observed position of duplicate metadata reads. This
      // avoids moving the final checkpoint/receipt before the historical prefix.
      lease.entries.delete(key); lease.entries.set(key, old)
      return
    }
    const bytes = utf8Bytes(key) + valueBytes, total = lease.bytes + bytes
    if (!Number.isSafeInteger(total) || total > this.maxBytes || lease.entries.size >= this.maxEntries) { this.discard(lease, 'capacity'); return }
    lease.entries.set(key, { raw, bytes }); lease.bytes = total
    this.stats.retainedBytes = total; this.stats.retainedEntries = lease.entries.size
    this.stats.peakRetainedBytes = Math.max(this.stats.peakRetainedBytes, total)
    this.stats.peakRetainedEntries = Math.max(this.stats.peakRetainedEntries, lease.entries.size)
  }

  seal(lease: CampaignProofLease | null, snapshot: CampaignSnapshot, prefix: string[]): void {
    if (!this.collecting(lease)) return
    // Cache admission is optional. It must never change a completed cold read
    // or a positively acknowledged durable commit into a failure.
    try {
      if (lease.bytes > decodeStorageBytes(snapshot.checkpoint.storage.writtenBytes)
        || snapshot.artifacts.size + snapshot.requests.size > 4 * CAMPAIGN_LIMITS.tasks
        || prefix.length > CAMPAIGN_LIMITS.campaigns) { this.discard(lease, 'capacity'); return }
      const detached = structuredClone(snapshot)
      if (!this.collecting(lease)) return
      lease.snapshot = detached; lease.catalogPrefix = [...prefix]
      this.stats.activeRecords = snapshot.artifacts.size + snapshot.requests.size
      lease.activeRecords = this.stats.activeRecords
      this.stats.peakActiveRecords = Math.max(this.stats.peakActiveRecords, this.stats.activeRecords)
    } catch { this.discard(lease, 'capacity') }
  }

  /** Internal aggregate replay admission. Never replaces the verified v2 baseline. */
  sealAggregate(lease: CampaignProofLease, verifiedWrittenBytes: number, activeRecords: number): void {
    campaignInteger(verifiedWrittenBytes, CAMPAIGN_LIMITS.serializedBytes)
    campaignInteger(activeRecords, 4 * CAMPAIGN_LIMITS.tasks)
    campaignAssert(this.collecting(lease) && lease.snapshot !== null && lease.bytes <= verifiedWrittenBytes, 'Aggregate verification transcript lacks verified capacity')
    lease.activeRecords = activeRecords; this.stats.activeRecords = activeRecords
    this.stats.peakActiveRecords = Math.max(this.stats.peakActiveRecords, activeRecords)
  }

  extend(lease: CampaignProofLease | null, snapshot: CampaignSnapshot, entries: ReadonlyArray<{ key: string; value: string }>, valueBytes: ReadonlyMap<string, number>): void {
    if (!this.collecting(lease) || !lease.snapshot) return
    try {
      for (const entry of entries) this.observe(lease, entry.key, entry.value, valueBytes.get(entry.key)!)
      this.seal(lease, snapshot, lease.catalogPrefix)
    } catch { this.discard(lease, 'capacity') }
  }

  coldCompleted(): void { this.stats.coldReplaysCompleted = add(this.stats.coldReplaysCompleted) }
  coldStart(): number { this.stats.coldReplays = add(this.stats.coldReplays); return performance.now() }
  timed(kind: 'cold' | 'exact', start: number): void {
    const elapsed = performance.now() - start
    if (!Number.isFinite(elapsed) || elapsed < 0) return
    if (kind === 'cold') { this.stats.coldMs = add(this.stats.coldMs, elapsed); this.stats.coldMaxMs = Math.max(this.stats.coldMaxMs, elapsed) }
    else { this.stats.exactMs = add(this.stats.exactMs, elapsed); this.stats.exactMaxMs = Math.max(this.stats.exactMaxMs, elapsed) }
  }
  observed(bytes: number): void { this.stats.exactRecords = add(this.stats.exactRecords); this.stats.exactBytes = add(this.stats.exactBytes, bytes) }
  passed(): void { this.stats.exactPasses = add(this.stats.exactPasses) }
  transition(): void { this.stats.transitions = add(this.stats.transitions) }
  observations(): CampaignActionProofStats { return structuredClone(this.stats) }
}
