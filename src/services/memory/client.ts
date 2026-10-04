import type {
  MemoryIndexStats, MemoryProjectInput, MemoryQuery, MemoryRemoteOptions, MemorySearchResult,
  MemoryWorkerRequest, MemoryWorkerResponse,
} from '../../types/memory'

/** Route-owned worker: indexing never runs on the editor's UI thread. */
export class MemoryClient {
  private worker: Worker | null = null
  private sequence = 0
  private pending = new Map<number, {
    resolve: (value: MemoryIndexStats | MemorySearchResult) => void
    reject: (error: Error) => void
    timeout: ReturnType<typeof setTimeout>
  }>()

  private rejectPending(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(message))
    }
    this.pending.clear()
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./memory.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<MemoryWorkerResponse>) => {
      if (this.worker !== worker) return
      const message = event.data
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pending.delete(message.id)
      if (message.ok) pending.resolve(message.result)
      else pending.reject(new Error(message.error))
    }
    worker.onerror = () => {
      if (this.worker !== worker) return
      this.rejectPending('检索进程启动或运行失败，请重建索引后重试')
      worker.terminate()
      if (this.worker === worker) this.worker = null
    }
    this.worker = worker
    return worker
  }

  private request(message: Exclude<MemoryWorkerRequest, { type: 'invalidate' }>): Promise<MemoryIndexStats | MemorySearchResult> {
    return new Promise((resolve, reject) => {
      const worker = this.ensureWorker()
      const timeout = setTimeout(() => {
        this.rejectPending('索引操作超时，请缩小作品规模或重试')
        worker.terminate()
        if (this.worker === worker) this.worker = null
      }, 90_000)
      this.pending.set(message.id, { resolve, reject, timeout })
      try {
        // Vue reactive proxies cannot be passed to structuredClone/postMessage.
        worker.postMessage(JSON.parse(JSON.stringify(message)))
      } catch (error) {
        clearTimeout(timeout)
        this.pending.delete(message.id)
        reject(error)
      }
    })
  }

  async sync(project: MemoryProjectInput): Promise<MemoryIndexStats> {
    // Invalidate before serialization: an uncloneable new source must not leave
    // the old source searchable in the surviving worker.
    this.invalidateSource()
    return await this.request({ id: ++this.sequence, type: 'sync', project }) as MemoryIndexStats
  }

  /** Hide stale readiness and abort work without losing the last complete cache. */
  invalidateSource(): void {
    this.rejectPending('作品来源已改变，已取消之前的检索')
    if (!this.worker) return
    try {
      // One-way control message: no timeout, promise, or replacement worker.
      this.worker.postMessage({ id: ++this.sequence, type: 'invalidate' } satisfies MemoryWorkerRequest)
    } catch {
      // If invalidation cannot reach the worker, it is unsafe to reuse it.
      this.worker.terminate()
      this.worker = null
    }
  }

  async search(query: MemoryQuery, options?: MemoryRemoteOptions): Promise<MemorySearchResult> {
    this.rejectPending('已开始新的检索，之前的请求已取消')
    return await this.request({ id: ++this.sequence, type: 'search', query, options }) as MemorySearchResult
  }

  dispose(): void {
    this.rejectPending('记忆检索已关闭')
    this.worker?.terminate()
    this.worker = null
  }
}
