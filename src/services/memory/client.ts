import type {
  MemoryFullScanDecision, MemoryFullScanHandle, MemoryFullScanPage, MemoryFullScanProgress,
  MemoryIndexStats, MemoryProjectInput, MemoryQuery, MemoryRemoteOptions, MemorySearchControls,
  MemorySearchResult, MemoryWorkerRequest, MemoryWorkerResponse,
} from '../../types/memory'

type RpcRequest = Exclude<MemoryWorkerRequest, { type: 'invalidate' | 'remote-ack' | 'full-scan-cancel' }>
type RpcValue = MemoryIndexStats | MemorySearchResult | MemoryFullScanPage
interface SearchOperation {
  handle?: MemoryFullScanHandle
  worker?: Worker
  stopped: boolean
  failure: Promise<never>
  reject: (error: Error) => void
  expiry?: ReturnType<typeof setTimeout>
  expiresAt?: number
}
function sameHandle(left?: MemoryFullScanHandle, right?: MemoryFullScanHandle): boolean {
  return left?.sessionId === right?.sessionId && left?.generation === right?.generation
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** Route-owned worker. One search spans finite RPCs and author decision waits. */
export class MemoryClient {
  private worker: Worker | null = null
  private sequence = 0
  private searchOperation?: SearchOperation
  private pending = new Map<number, {
    resolve: (value: RpcValue) => void
    reject: (error: Error) => void
    timeout: ReturnType<typeof setTimeout>
    beforeRemote?: () => Promise<void>
    handle?: MemoryFullScanHandle
    responseType: 'sync' | 'search' | 'full-scan' | 'full-scan-local'
    guards: Set<number>
  }>()

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(message))
    }
    this.pending.clear()
  }

  private stopSearch(message: string, cancelWorker = true): void {
    const operation = this.searchOperation
    if (!operation || operation.stopped) return
    operation.stopped = true
    clearTimeout(operation.expiry)
    operation.reject(new Error(message))
    this.searchOperation = undefined
    if (cancelWorker && operation.handle && operation.worker === this.worker && this.worker) {
      try {
        this.worker.postMessage({ id: ++this.sequence, type: 'full-scan-cancel', handle: operation.handle } satisfies MemoryWorkerRequest)
      } catch {
        this.worker.terminate()
        this.worker = null
      }
    }
  }

  private loseWorker(worker: Worker, message: string): void {
    if (this.worker !== worker) return
    this.stopSearch(message, false)
    this.rejectPending(message)
    worker.terminate()
    this.worker = null
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./memory.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<MemoryWorkerResponse>) => {
      if (this.worker !== worker) return
      const message = event.data
      const pending = this.pending.get(message.id)
      if (!pending) return
      if (message.ok && message.type === 'remote-check') {
        if (!sameHandle(pending.handle, message.handle) || pending.guards.has(message.guardId)) return
        pending.guards.add(message.guardId)
        void (async () => {
          let ok = false
          try { if (pending.beforeRemote) { await pending.beforeRemote(); ok = true } } catch { /* Never transmit source/error payloads. */ }
          if (this.worker !== worker || this.pending.get(message.id) !== pending) return
          try {
            worker.postMessage({ id: message.id, type: 'remote-ack', guardId: message.guardId, ok,
              ...(pending.handle ? { handle: pending.handle } : {}),
            } satisfies MemoryWorkerRequest)
          } catch { this.loseWorker(worker, '检索连接已中断，扫描进度已丢失，请重新预览。') }
        })()
        return
      }
      // An unrelated or stale session cannot complete this RPC, even with its ID.
      if (message.ok) {
        if (message.type !== pending.responseType) return
        const handle = message.type === 'full-scan' ? message.page.progress : 'handle' in message ? message.handle : undefined
        if (!sameHandle(pending.handle, handle)) return
      } else if (!sameHandle(pending.handle, message.handle)) return
      clearTimeout(pending.timeout)
      this.pending.delete(message.id)
      if (!message.ok) pending.reject(new Error(message.error))
      else if (message.type === 'full-scan') pending.resolve(message.page)
      else if ('result' in message) pending.resolve(message.result)
    }
    worker.onerror = () => this.loseWorker(worker, '检索进程启动或运行失败，扫描进度已丢失，请重建索引后重试。')
    worker.onmessageerror = () => this.loseWorker(worker, '检索进程消息无法读取，扫描进度已丢失，请重新预览。')
    this.worker = worker
    return worker
  }

  private request(message: RpcRequest, beforeRemote?: () => Promise<void>): Promise<RpcValue> {
    return new Promise((resolve, reject) => {
      const worker = this.ensureWorker()
      const handle = 'handle' in message ? message.handle : message.type === 'full-scan-resume' ? message.grant : undefined
      const timeout = setTimeout(() => {
        this.loseWorker(worker, '索引操作超时，扫描进度已丢失，请缩小作品规模或重新预览。')
      }, 90_000)
      const responseType = message.type === 'sync' || message.type === 'search' || message.type === 'full-scan-local'
        ? message.type : 'full-scan'
      this.pending.set(message.id, { resolve, reject, timeout, beforeRemote,
        handle: handle ? { sessionId: handle.sessionId, generation: handle.generation } : undefined,
        responseType, guards: new Set(),
      })
      try {
        // Vue proxies cannot cross postMessage. Controls never enter this object.
        worker.postMessage(clone(message))
      } catch (error) {
        clearTimeout(timeout)
        this.pending.delete(message.id)
        reject(error)
      }
    })
  }

  async sync(project: MemoryProjectInput): Promise<MemoryIndexStats> {
    // Invalidate before serialization, even when the replacement is uncloneable.
    this.invalidateSource()
    return await this.request({ id: ++this.sequence, type: 'sync', project }) as MemoryIndexStats
  }

  /** Hide stale readiness and abort work without losing the last complete cache. */
  invalidateSource(): void {
    this.stopSearch('作品来源已改变，已取消之前的检索', false)
    this.rejectPending('作品来源已改变，已取消之前的检索')
    if (!this.worker) return
    try {
      this.worker.postMessage({ id: ++this.sequence, type: 'invalidate' } satisfies MemoryWorkerRequest)
    } catch {
      this.worker.terminate()
      this.worker = null
    }
  }

  private assertActive(operation: SearchOperation): void {
    if (operation.stopped || this.searchOperation !== operation) throw new Error('检索已取消或被新请求替代。')
    if (operation.expiresAt !== undefined && Date.now() >= operation.expiresAt) {
      this.stopSearch('扫描会话已过期，进度已丢失，请重新预览。')
      this.rejectPending('扫描会话已过期，进度已丢失，请重新预览。')
      throw new Error('扫描会话已过期，进度已丢失，请重新预览。')
    }
  }

  private async waitFor<T>(operation: SearchOperation, promise: Promise<T>): Promise<T> {
    const value = await Promise.race([promise, operation.failure])
    this.assertActive(operation)
    return value
  }

  private armExpiry(operation: SearchOperation, progress: MemoryFullScanProgress): void {
    if (!Number.isFinite(progress.expiresAt) || progress.expiresAt > Date.now() + 3_600_000
      || (operation.expiresAt !== undefined && operation.expiresAt !== progress.expiresAt)) {
      throw new Error('扫描会话期限无效，请重新预览。')
    }
    if (operation.expiresAt !== undefined) return
    operation.expiresAt = progress.expiresAt
    operation.expiry = setTimeout(() => {
      if (this.searchOperation !== operation) return
      this.stopSearch('扫描会话已过期，进度已丢失，请重新预览。')
      this.rejectPending('扫描会话已过期，进度已丢失，请重新预览。')
    }, Math.max(0, progress.expiresAt - Date.now()))
  }

  private async fullScan(
    operation: SearchOperation, query: MemoryQuery, options: MemoryRemoteOptions,
    beforeRemote: (() => Promise<void>) | undefined, controls: MemorySearchControls,
  ): Promise<MemorySearchResult> {
    const handle = operation.handle!
    const rpc = async (message: RpcRequest) => await this.waitFor(operation, this.request(message, beforeRemote))
    let page = await rpc({ id: ++this.sequence, type: 'full-scan-start', query, options, handle,
      ...(beforeRemote ? { guardRemote: true } : {}),
    }) as MemoryFullScanPage
    for (;;) {
      this.assertActive(operation)
      this.armExpiry(operation, page.progress)
      // Give callbacks separate safe copies. They cannot rewrite the handle/budget.
      if (controls.onProgress) {
        await this.waitFor(operation, Promise.resolve().then(() => controls.onProgress!(clone(page.progress))))
      }
      if (page.state === 'complete') return page.result
      if (page.state === 'page-complete') {
        page = await rpc({ id: ++this.sequence, type: 'full-scan-advance', handle }) as MemoryFullScanPage
        continue
      }
      let decision: MemoryFullScanDecision
      if (!controls.onPause) decision = { type: 'use-local', ...handle }
      else {
        const reason = page.state === 'ready' ? 'ready' : page.state === 'paused-budget' ? 'budget' : 'provider'
        decision = await this.waitFor(operation, Promise.resolve().then(() => controls.onPause!({ reason, progress: clone(page.progress) })))
      }
      this.assertActive(operation)
      if (!decision || !sameHandle(handle, decision)) throw new Error('扫描决定不属于当前会话，请重新预览。')
      if (decision.type === 'cancel') throw new Error('全范围扫描已取消。')
      if (decision.type === 'use-local') {
        return await rpc({ id: ++this.sequence, type: 'full-scan-local', handle }) as MemorySearchResult
      }
      if (decision.type !== 'continue') throw new Error('扫描决定无效。')
      // Explicit whitelist prevents callback fields from reaching the Worker.
      const grant = { ...handle, grantId: decision.grantId, addCalls: decision.addCalls, addActiveMs: decision.addActiveMs }
      page = await rpc({ id: ++this.sequence, type: 'full-scan-resume', grant }) as MemoryFullScanPage
    }
  }

  async search(
    query: MemoryQuery, options?: MemoryRemoteOptions, beforeRemote?: () => Promise<void>, controls: MemorySearchControls = {},
  ): Promise<MemorySearchResult> {
    this.stopSearch('已开始新的检索，之前的请求已取消')
    this.rejectPending('已开始新的检索，之前的请求已取消')
    if (controls.signal?.aborted) throw new Error('记忆检索已取消。')
    let reject!: (error: Error) => void
    const failure = new Promise<never>((_resolve, fail) => { reject = fail })
    // A synchronous callback/post failure can revoke before waitFor attaches.
    void failure.catch(() => undefined)
    const operation: SearchOperation = { stopped: false, failure, reject }
    this.searchOperation = operation
    const abort = () => {
      if (this.searchOperation !== operation) return
      this.stopSearch('记忆检索已取消。')
      this.rejectPending('记忆检索已取消。')
      // Legacy searches have no session cancellation command.
      if (!operation.handle && this.worker) this.invalidateSource()
    }
    controls.signal?.addEventListener('abort', abort, { once: true })
    try {
      operation.worker = this.ensureWorker()
      if (options?.fullScan !== undefined) {
        const generation = ++this.sequence
        operation.handle = { sessionId: `memory-scan-${generation}`, generation }
        return await this.fullScan(operation, query, options, beforeRemote, controls)
      }
      return await this.waitFor(operation, this.request({ id: ++this.sequence, type: 'search', query, options,
        ...(beforeRemote ? { guardRemote: true } : {}),
      }, beforeRemote)) as MemorySearchResult
    } catch (error) {
      if (this.searchOperation === operation) {
        this.stopSearch('记忆检索已取消。')
        this.rejectPending('记忆检索已取消。')
      }
      throw error
    } finally {
      clearTimeout(operation.expiry)
      controls.signal?.removeEventListener('abort', abort)
      if (this.searchOperation === operation) this.searchOperation = undefined
      operation.stopped = true
    }
  }

  dispose(): void {
    this.stopSearch('记忆检索已关闭', false)
    this.rejectPending('记忆检索已关闭')
    this.worker?.terminate()
    this.worker = null
  }
}
