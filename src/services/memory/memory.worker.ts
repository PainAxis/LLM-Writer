import { MemoryIndex } from './engine'
import type { MemoryWorkerRequest, MemoryWorkerResponse } from '../../types/memory'

const index = new MemoryIndex()
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<MemoryWorkerRequest>) => void) | null
  postMessage(message: MemoryWorkerResponse): void
}

let guardSequence = 0
const guards = new Map<number, { requestId: number; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
function cancelGuards(): void {
  for (const guard of guards.values()) {
    clearTimeout(guard.timer)
    guard.reject(new Error('稿件来源已改变，远程检索已取消。'))
  }
  guards.clear()
}
function beforeRemote(requestId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const guardId = ++guardSequence
    const timer = setTimeout(() => {
      guards.delete(guardId)
      reject(new Error('无法及时核对已保存稿件，已阻止远程检索。'))
    }, 30_000)
    guards.set(guardId, { requestId, resolve, reject, timer })
    scope.postMessage({ id: requestId, ok: true, type: 'remote-check', guardId })
  })
}

scope.onmessage = async (event) => {
  const request = event.data
  try {
    if (request.type === 'remote-ack') {
      const guard = guards.get(request.guardId)
      if (!guard || guard.requestId !== request.id) return
      clearTimeout(guard.timer)
      guards.delete(request.guardId)
      if (request.ok) guard.resolve()
      else guard.reject(new Error('已保存稿件已改变，已阻止远程检索。'))
    } else if (request.type === 'invalidate') {
      index.invalidateSource()
      cancelGuards()
    } else if (request.type === 'sync') {
      cancelGuards()
      scope.postMessage({ id: request.id, ok: true, type: 'sync', result: await index.sync(request.project) })
    } else if (request.type === 'search') {
      cancelGuards()
      scope.postMessage({ id: request.id, ok: true, type: 'search', result: await index.search(request.query, request.options,
        request.guardRemote ? () => beforeRemote(request.id) : undefined) })
    } else {
      throw new Error('不支持的检索操作')
    }
  } catch (error) {
    scope.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : '检索失败，请重试' })
  }
}
