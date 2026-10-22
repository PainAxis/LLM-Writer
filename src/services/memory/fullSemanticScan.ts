import type {
  MemoryFullScanGrant, MemoryFullScanHandle, MemoryFullScanOptions, MemoryFullScanPage,
  MemoryFullScanProgress, MemorySearchResult,
} from '../../types/memory'

export const FULL_SCAN_MAX_CALLS = 4_096
export const FULL_SCAN_MAX_ACTIVE_MS = 3_600_000
export const FULL_SCAN_EXPIRY_MS = 3_600_000
const PAGE_MS = 50_000
const PAGE_CALLS = 8
const PROVIDER_MS = 15_000
const GUARD_MS = 30_000
const BATCH = 32

export function validateFullScanOptions(value: MemoryFullScanOptions | undefined): MemoryFullScanOptions {
  if (!value || !Number.isSafeInteger(value.maxCalls) || value.maxCalls < 1 || value.maxCalls > FULL_SCAN_MAX_CALLS
    || !Number.isSafeInteger(value.maxActiveMs) || value.maxActiveMs < 1 || value.maxActiveMs > FULL_SCAN_MAX_ACTIVE_MS) {
    throw new Error('全范围语义扫描预算无效：请求次数须为 1–4096，处理时间须为 1–3600000 毫秒的整数。')
  }
  return { maxCalls: value.maxCalls, maxActiveMs: value.maxActiveMs }
}

export function validateFullScanHandle(handle: MemoryFullScanHandle): void {
  if (!handle || typeof handle.sessionId !== 'string' || !handle.sessionId.trim() || handle.sessionId.length > 128
    || !Number.isSafeInteger(handle.generation) || handle.generation < 1) throw new Error('全范围扫描会话标识无效。')
}

export interface FullScanRecord { id: string; quote: string }
export interface FullScanScore { id: string; score: number }
export type FullScanRemote = <T>(kind: 'query' | 'passage' | 'rerank', sourceChars: number,
  records: readonly FullScanRecord[], invoke: (signal: AbortSignal) => Promise<T>) => Promise<T>

interface ScanHooks {
  handle: MemoryFullScanHandle
  options: MemoryFullScanOptions
  records: readonly FullScanRecord[]
  query: string
  dimensions: number
  topK: number
  rerank: boolean
  enabled?: boolean
  preparedMs: number
  createdAt: number
  assertCurrent: () => void
  assertSources: (records: readonly FullScanRecord[]) => void
  cached: (record: FullScanRecord) => Float32Array | undefined
  cache: (record: FullScanRecord, vector: Float32Array) => void
  embed: (texts: string[], task: 'retrieval.query' | 'retrieval.passage', signal: AbortSignal) => Promise<number[][]>
  finish: (scores: readonly FullScanScore[], remote: FullScanRemote) => Promise<MemorySearchResult>
  /** Injectable clocks support deterministic deadline tests without changing production bounds. */
  now?: () => number
  wallNow?: () => number
}

class Pause extends Error {
  constructor(readonly reason: 'budget' | 'page' | 'provider') { super(reason) }
}

function vector(value: unknown, dimensions: number): Float32Array {
  if (!Array.isArray(value) || value.length !== dimensions
    || value.some(item => typeof item !== 'number' || !Number.isFinite(item))) throw new Pause('provider')
  const converted = new Float32Array(value)
  if (!converted.every(Number.isFinite) || !converted.some(item => item !== 0)) throw new Pause('provider')
  return converted
}

function cosine(left: Float32Array, right: Float32Array): number {
  let dot = 0, leftNorm = 0, rightNorm = 0
  for (let i = 0; i < left.length; i++) {
    dot += left[i]! * right[i]!
    leftNorm += left[i]! ** 2
    rightNorm += right[i]! ** 2
  }
  return dot / Math.sqrt(leftNorm * rightNorm)
}

/** Private checkpoint. Only bounded top-K scores and coverage survive pages, never all vectors. */
export class FullSemanticScan {
  private readonly now: () => number
  private readonly wallNow: () => number
  private readonly covered: Uint8Array
  private readonly grants = new Map<string, { addCalls: number; addActiveMs: number }>()
  private queryVector: Float32Array | undefined
  private top: FullScanScore[] = []
  private phase: 'query' | 'cache' | 'passages' | 'finish' = 'query'
  private cursor = 0
  private cancelled = false
  private running = false
  private controller: AbortController | undefined
  private started = 0
  private pageCalls = 0
  private approvedCalls: number
  private approvedMs: number
  private activeMs: number
  private calls = { query: 0, passage: 0, rerank: 0 }
  private scored = 0
  private embedded = 0
  private scoredCached = 0
  private attemptedChars = 0
  private readonly cachedCount: number
  private readonly sourceChars: number
  private lastPage: MemoryFullScanPage

  constructor(private readonly hooks: ScanHooks) {
    const options = validateFullScanOptions(hooks.options)
    validateFullScanHandle(hooks.handle)
    this.now = hooks.now ?? (() => performance.now())
    this.wallNow = hooks.wallNow ?? Date.now
    const preparationStarted = this.now()
    this.approvedCalls = options.maxCalls
    this.approvedMs = options.maxActiveMs
    this.activeMs = hooks.preparedMs
    this.covered = new Uint8Array(Math.ceil(hooks.records.length / 8))
    hooks.assertCurrent()
    hooks.assertSources(hooks.records)
    this.cachedCount = hooks.records.reduce((count, record) => count + Number(Boolean(hooks.cached(record))), 0)
    this.sourceChars = hooks.records.reduce((sum, record) => sum + record.quote.length, 0)
    this.activeMs += this.now() - preparationStarted
    if (hooks.enabled === false) this.phase = 'finish'
    this.lastPage = { state: 'ready', progress: this.progress() }
  }

  private assertCurrent() {
    if (this.cancelled) throw new Error('全范围语义扫描已取消或失效。')
    this.hooks.assertCurrent()
    if (this.wallNow() >= this.hooks.createdAt + FULL_SCAN_EXPIRY_MS) {
      this.cancel()
      throw new Error('全范围语义扫描会话已过期，请重新预览。')
    }
  }

  assertHandle(handle: MemoryFullScanHandle) {
    validateFullScanHandle(handle)
    if (handle.sessionId !== this.hooks.handle.sessionId || handle.generation !== this.hooks.handle.generation) {
      throw new Error('全范围语义扫描会话已失效，请重新预览。')
    }
    this.assertCurrent()
  }

  private elapsed() { return this.running ? this.now() - this.started : 0 }
  private attempts() { return this.calls.query + this.calls.passage + this.calls.rerank }
  private deadline() {
    this.assertCurrent()
    if (this.activeMs + this.elapsed() >= this.approvedMs) throw new Pause('budget')
    if (this.running && this.elapsed() >= PAGE_MS) throw new Pause('page')
  }

  progress(): MemoryFullScanProgress {
    return {
      ...this.hooks.handle, eligiblePassages: this.hooks.records.length, cachedPassages: this.cachedCount,
      missingPassages: this.hooks.records.length - this.cachedCount, scoredPassages: this.scored,
      embeddedPassages: this.embedded, scoredCachedPassages: this.scoredCached,
      sourceChars: this.sourceChars, attemptedSourceChars: this.attemptedChars,
      queryCalls: this.calls.query, passageCalls: this.calls.passage, rerankCalls: this.calls.rerank,
      callsAttempted: this.attempts(), callsApproved: this.approvedCalls,
      activeMsUsed: Math.max(0, this.activeMs + this.elapsed()), activeMsApproved: this.approvedMs,
      coldEstimatedCalls: this.hooks.enabled === false ? 0 : 1 + Math.ceil(this.hooks.records.length / BATCH) + Number(this.hooks.rerank),
      currentEstimatedCalls: this.hooks.enabled === false ? 0 : 1 + Math.ceil((this.hooks.records.length - this.cachedCount) / BATCH) + Number(this.hooks.rerank),
      expiresAt: this.hooks.createdAt + FULL_SCAN_EXPIRY_MS,
    }
  }

  plan(preparationMs?: number): MemoryFullScanPage {
    const start = this.now()
    this.assertCurrent()
    this.activeMs = Math.max(this.activeMs, preparationMs ?? 0) + (this.now() - start)
    return { state: 'ready', progress: this.progress() }
  }

  cancel() {
    this.cancelled = true
    this.controller?.abort()
    this.queryVector = undefined
    this.top = []
  }

  /** Duplicate grants return the last outcome without doing any new work. */
  async resume(grant: MemoryFullScanGrant, guard?: () => Promise<void>): Promise<MemoryFullScanPage> {
    this.assertHandle(grant)
    if (this.running) throw new Error('全范围扫描页面仍在处理，不能并发继续。')
    if (typeof grant.grantId !== 'string' || !grant.grantId.trim() || grant.grantId.length > 128
      || !Number.isSafeInteger(grant.addCalls) || grant.addCalls < 0
      || !Number.isSafeInteger(grant.addActiveMs) || grant.addActiveMs < 0) throw new Error('全范围扫描追加预算无效。')
    const previous = this.grants.get(grant.grantId)
    if (previous) {
      if (previous.addCalls !== grant.addCalls || previous.addActiveMs !== grant.addActiveMs) throw new Error('同一授权编号不能更改预算。')
      return { ...this.lastPage, progress: this.progress() }
    }
    if (this.lastPage.state === 'complete') throw new Error('全范围扫描已经完成。')
    if (grant.addCalls === 0 && grant.addActiveMs === 0
      && (this.attempts() >= this.approvedCalls || this.activeMs >= this.approvedMs)) {
      throw new Error('剩余请求或处理时间预算已耗尽，继续扫描需要明确追加相应预算。')
    }
    if (this.approvedCalls + grant.addCalls > FULL_SCAN_MAX_CALLS || this.approvedMs + grant.addActiveMs > FULL_SCAN_MAX_ACTIVE_MS) {
      throw new Error('追加预算超过全范围扫描累计上限。')
    }
    if (this.grants.size >= FULL_SCAN_MAX_CALLS) throw new Error('全范围扫描授权次数已达上限，请重新预览。')
    // Validate both additions before mutating either total or the idempotency ledger.
    this.approvedCalls += grant.addCalls
    this.approvedMs += grant.addActiveMs
    this.grants.set(grant.grantId, { addCalls: grant.addCalls, addActiveMs: grant.addActiveMs })
    return this.run(guard)
  }

  async advance(handle: MemoryFullScanHandle, guard?: () => Promise<void>): Promise<MemoryFullScanPage> {
    this.assertHandle(handle)
    if (this.lastPage.state !== 'page-complete') throw new Error('全范围扫描需要明确开始或继续授权。')
    return this.run(guard)
  }

  /** Source guard is also required for use-local; its failure is never a local success. */
  async validateLocal<T = void>(handle: MemoryFullScanHandle, guard?: () => Promise<void>, finish?: () => T): Promise<T> {
    this.assertHandle(handle)
    if (this.running) throw new Error('全范围扫描页面仍在处理，不能并发结束。')
    const allowance = Math.min(GUARD_MS, this.approvedMs - this.activeMs,
      this.hooks.createdAt + FULL_SCAN_EXPIRY_MS - this.wallNow())
    if (allowance <= 0) {
      this.cancel()
      throw new Error('扫描处理时间预算已耗尽，无法在剩余预算内验证本地结果，请重新预览。')
    }
    const controller = new AbortController()
    this.controller = controller
    this.running = true
    this.started = this.now()
    try {
      await this.wait(() => guard?.() ?? Promise.resolve(), allowance, controller,
        () => new Error('稿件依据校验超时或处理时间预算已耗尽，请重新预览。'))
      this.assertCurrent()
      if (this.activeMs + this.elapsed() >= this.approvedMs) throw new Error('处理时间预算已耗尽。')
      this.hooks.assertSources(this.hooks.records)
      const result = finish?.()
      this.assertCurrent()
      if (this.activeMs + this.elapsed() >= this.approvedMs) throw new Error('处理时间预算已耗尽。')
      return result as T
    } catch {
      this.cancel()
      throw new Error('稿件依据校验失败或处理时间预算已耗尽，已阻止本地结果，请重新预览。')
    } finally {
      this.activeMs += this.now() - this.started
      this.running = false
      if (this.controller === controller) this.controller = undefined
    }
  }

  private async wait<T>(invoke: () => Promise<T>, ms: number, controller: AbortController, timeout: () => Error): Promise<T> {
    if (controller.signal.aborted) throw new Error('全范围扫描已取消。')
    if (ms <= 0) throw timeout()
    let timer: ReturnType<typeof setTimeout> | undefined
    let rejectAbort: () => void = () => undefined
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new Error('全范围扫描已取消。'))
      controller.signal.addEventListener('abort', rejectAbort, { once: true })
    })
    const timed = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(timeout()); controller.abort() }, Math.max(0, ms))
    })
    try {
      return await Promise.race([Promise.resolve().then(() => {
        // Cancellation may arrive between scheduling and invoking a guard/adapter.
        // Never let a detached microtask start a new outbound attempt afterward.
        if (controller.signal.aborted) throw new Error('全范围扫描已取消。')
        this.deadline()
        return invoke()
      }), aborted, timed])
    }
    finally {
      if (timer !== undefined) clearTimeout(timer)
      controller.signal.removeEventListener('abort', rejectAbort)
    }
  }

  private remaining() {
    return Math.max(0, Math.min(PAGE_MS - this.elapsed(), this.approvedMs - this.activeMs - this.elapsed(),
      this.hooks.createdAt + FULL_SCAN_EXPIRY_MS - this.wallNow()))
  }

  private timeLimitError(): Error {
    const activeRemaining = this.approvedMs - this.activeMs - this.elapsed()
    const pageRemaining = PAGE_MS - this.elapsed()
    if (this.hooks.createdAt + FULL_SCAN_EXPIRY_MS - this.wallNow() <= Math.min(activeRemaining, pageRemaining)) {
      this.cancel()
      return new Error('全范围语义扫描会话已过期，请重新预览。')
    }
    // Timers can fire slightly before a fractional deadline. Identify the limiting
    // allowance, not whether the clock has already crossed it at this instant.
    return new Pause(activeRemaining <= pageRemaining ? 'budget' : 'page')
  }

  private async run(guard?: () => Promise<void>): Promise<MemoryFullScanPage> {
    if (this.running) throw new Error('全范围扫描页面不能并发执行。')
    this.assertCurrent()
    this.running = true
    this.started = this.now()
    this.pageCalls = 0
    const controller = new AbortController()
    this.controller = controller
    const boundary = () => {
      this.deadline()
      if (this.attempts() >= this.approvedCalls) throw new Pause('budget')
      if (this.pageCalls >= PAGE_CALLS) throw new Pause('page')
    }
    const remote: FullScanRemote = async (kind, chars, records, invoke) => {
      boundary()
      const guardRemaining = this.remaining()
      try {
        await this.wait(() => guard?.() ?? Promise.resolve(), Math.min(GUARD_MS, guardRemaining), controller,
          () => guardRemaining < GUARD_MS ? this.timeLimitError()
            : new Error('稿件依据校验超时。'))
      } catch (error) {
        this.assertCurrent()
        if (error instanceof Pause) throw error
        throw new Error('稿件依据校验失败，已阻止远程检索，请重新预览。')
      }
      boundary()
      this.hooks.assertSources(records)
      boundary()
      this.calls[kind]++
      this.pageCalls++
      this.attemptedChars += chars
      const remaining = this.remaining()
      let returned
      try {
        returned = await this.wait(() => invoke(controller.signal), Math.min(PROVIDER_MS, remaining), controller,
          () => remaining < PROVIDER_MS ? this.timeLimitError()
            : new Pause('provider'))
      } catch (error) {
        this.assertCurrent()
        if (error instanceof Pause) throw error
        throw new Pause('provider')
      }
      this.deadline()
      this.hooks.assertSources(records)
      this.deadline()
      return returned
    }
    let state: MemoryFullScanPage['state'] = 'page-complete'
    let result: MemorySearchResult | undefined
    try {
      this.deadline()
      if (this.hooks.enabled === false) {
        const remaining = this.remaining()
        try {
          await this.wait(() => guard?.() ?? Promise.resolve(), Math.min(GUARD_MS, remaining), controller,
            () => remaining < GUARD_MS ? this.timeLimitError()
              : new Error('稿件依据校验超时。'))
        } catch (error) {
          this.assertCurrent()
          if (error instanceof Pause) throw error
          throw new Error('稿件依据校验失败，已阻止本地结果，请重新预览。')
        }
        this.deadline()
      }
      if (this.phase === 'query') {
        const returned = await remote('query', 0, [], signal => this.hooks.embed([this.hooks.query], 'retrieval.query', signal))
        if (!Array.isArray(returned) || returned.length !== 1) throw new Pause('provider')
        this.queryVector = vector(returned[0], this.hooks.dimensions)
        this.phase = 'cache'
      }
      while (this.phase === 'cache') {
        this.deadline()
        const end = Math.min(this.cursor + BATCH, this.hooks.records.length)
        const pairs: { index: number; vector: Float32Array }[] = []
        for (let i = this.cursor; i < end; i++) {
          const cached = this.hooks.cached(this.hooks.records[i]!)
          if (cached) pairs.push({ index: i, vector: cached })
        }
        this.commit(pairs)
        this.scoredCached += pairs.length
        this.cursor = end
        if (end === this.hooks.records.length) { this.phase = 'passages'; this.cursor = 0 }
        await new Promise<void>(resolve => setTimeout(resolve, 0))
      }
      while (this.phase === 'passages') {
        this.deadline()
        const indexes: number[] = []
        let next = this.cursor
        while (next < this.hooks.records.length && indexes.length < BATCH) {
          if (!this.has(next)) indexes.push(next)
          next++
        }
        if (!indexes.length) { this.phase = 'finish'; break }
        const records = indexes.map(index => this.hooks.records[index]!)
        const returned = await remote('passage', records.reduce((sum, record) => sum + record.quote.length, 0), records,
          signal => this.hooks.embed(records.map(record => record.quote), 'retrieval.passage', signal))
        if (!Array.isArray(returned) || returned.length !== records.length) throw new Pause('provider')
        // Convert and validate the entire response before touching coverage, cache, or cursor.
        const pairs = indexes.map((index, position) => ({ index, vector: vector(returned[position], this.hooks.dimensions) }))
        this.deadline()
        this.hooks.assertSources(records)
        this.commit(pairs)
        for (const pair of pairs) this.hooks.cache(this.hooks.records[pair.index]!, pair.vector)
        this.embedded += pairs.length
        this.cursor = next
        if (this.cursor === this.hooks.records.length) this.phase = 'finish'
        await new Promise<void>(resolve => setTimeout(resolve, 0))
      }
      this.deadline()
      if (this.hooks.enabled !== false && this.scored !== this.hooks.records.length) throw new Error('全范围扫描覆盖不完整。')
      this.hooks.assertSources(this.hooks.records)
      result = await this.hooks.finish(this.top, remote)
      this.deadline()
      state = 'complete'
      this.queryVector = undefined
      this.top = []
    } catch (error) {
      if (error instanceof Pause) state = error.reason === 'page' ? 'page-complete' : error.reason === 'budget' ? 'paused-budget' : 'paused-provider'
      else { this.cancel(); throw error }
    } finally {
      this.activeMs += this.now() - this.started
      this.running = false
      controller.abort()
      if (this.controller === controller) this.controller = undefined
    }
    const progress = this.progress()
    if (state === 'complete' && result) {
      result.diagnostics.fullScan = { ...progress, status: this.hooks.enabled === false ? 'stopped-local' : 'complete',
        coverage: this.hooks.enabled === false ? 'incomplete' : 'complete' }
      this.lastPage = { state, progress, result }
    } else this.lastPage = { state: state === 'complete' ? 'page-complete' : state, progress }
    return { ...this.lastPage }
  }

  private has(index: number) { return Boolean(this.covered[index >> 3]! & (1 << (index & 7))) }

  private commit(pairs: { index: number; vector: Float32Array }[]) {
    this.deadline()
    this.hooks.assertSources(pairs.map(pair => this.hooks.records[pair.index]!))
    for (const { index, vector: value } of pairs) {
      if (this.has(index) || value.length !== this.hooks.dimensions || !value.every(Number.isFinite) || !value.some(item => item !== 0)) {
        throw new Error('全范围扫描缓存或覆盖状态无效。')
      }
    }
    for (const { index, vector: value } of pairs) {
      const score = cosine(this.queryVector!, value)
      if (Number.isFinite(score) && score > 0) {
        this.top.push({ id: this.hooks.records[index]!.id, score })
        this.top.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        if (this.top.length > this.hooks.topK) this.top.pop()
      }
      this.covered[index >> 3] = this.covered[index >> 3]! | (1 << (index & 7))
      this.scored++
    }
  }
}
