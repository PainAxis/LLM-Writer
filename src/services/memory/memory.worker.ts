import { MemoryIndex } from './engine'
import type { MemoryFullScanHandle, MemoryWorkerRequest, MemoryWorkerResponse } from '../../types/memory'

const index = new MemoryIndex()
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<MemoryWorkerRequest>) => void) | null
  postMessage(message: MemoryWorkerResponse): void
}

let guardSequence = 0
let operationSequence = 0
let activeScan: { handle: MemoryFullScanHandle; guardRemote: boolean; busy: boolean } | undefined
const guards = new Map<number, {
  requestId: number; operation: number; handle?: MemoryFullScanHandle
  resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>
}>()
function sameHandle(left?: MemoryFullScanHandle, right?: MemoryFullScanHandle): boolean {
  return left?.sessionId === right?.sessionId && left?.generation === right?.generation
}
function cancelGuards(predicate: (guard: { requestId: number; operation: number; handle?: MemoryFullScanHandle }) => boolean = () => true): void {
  for (const [id, guard] of guards) {
    if (!predicate(guard)) continue
    clearTimeout(guard.timer)
    guards.delete(id)
    guard.reject(new Error('稿件来源已改变或本页已结束，远程检索已取消。'))
  }
}
function beforeRemote(requestId: number, operation: number, handle?: MemoryFullScanHandle): Promise<void> {
  if (operation !== operationSequence || (handle && !sameHandle(activeScan?.handle, handle))) {
    return Promise.reject(new Error('检索已被新请求替代，已阻止远程检索。'))
  }
  return new Promise((resolve, reject) => {
    const guardId = ++guardSequence
    const timer = setTimeout(() => {
      guards.delete(guardId)
      reject(new Error('无法及时核对已保存稿件，已阻止远程检索。'))
    }, 30_000)
    guards.set(guardId, { requestId, operation, handle, resolve, reject, timer })
    scope.postMessage({ id: requestId, ok: true, type: 'remote-check', guardId, ...(handle ? { handle } : {}) })
  })
}
function cancelScan(handle: MemoryFullScanHandle): void {
  // A malformed start handle never owned an engine checkpoint. Cleanup must not
  // throw a second exception and suppress the original RPC failure response.
  try { index.cancelFullScan(handle) } catch { /* Invalid identity is already rejected. */ }
}
function replaceOperation(): number {
  if (activeScan) cancelScan(activeScan.handle)
  cancelGuards()
  activeScan = undefined
  return ++operationSequence
}

scope.onmessage = async (event) => {
  const request = event.data
  const handle = 'handle' in request ? request.handle : request.type === 'full-scan-resume'
    ? { sessionId: request.grant.sessionId, generation: request.grant.generation } : undefined
  let operation: number | undefined
  try {
    if (request.type === 'remote-ack') {
      const guard = guards.get(request.guardId)
      if (!guard || guard.requestId !== request.id || guard.operation !== operationSequence
        || !sameHandle(guard.handle, request.handle)) return
      clearTimeout(guard.timer)
      guards.delete(request.guardId)
      if (request.ok) guard.resolve()
      else guard.reject(new Error('已保存稿件已改变，已阻止远程检索。'))
    } else if (request.type === 'invalidate') {
      replaceOperation()
      index.invalidateSource()
    } else if (request.type === 'sync') {
      operation = replaceOperation()
      scope.postMessage({ id: request.id, ok: true, type: 'sync', result: await index.sync(request.project) })
    } else if (request.type === 'search') {
      operation = replaceOperation()
      const ownedOperation = operation
      scope.postMessage({ id: request.id, ok: true, type: 'search', result: await index.search(request.query, request.options,
        request.guardRemote ? () => beforeRemote(request.id, ownedOperation) : undefined) })
    } else if (request.type === 'full-scan-start') {
      operation = replaceOperation()
      const scan = { handle: request.handle, guardRemote: !!request.guardRemote, busy: true }
      activeScan = scan
      const page = await index.startFullScan(request.query, request.options, request.handle)
      if (activeScan === scan) scan.busy = false
      scope.postMessage({ id: request.id, ok: true, type: 'full-scan', page })
    } else if (request.type === 'full-scan-cancel') {
      // A late cancellation must never cancel a replacement session or its guard.
      if (sameHandle(activeScan?.handle, request.handle)) {
        cancelScan(request.handle)
        cancelGuards(guard => sameHandle(guard.handle, request.handle))
        activeScan = undefined
        ++operationSequence
      }
      scope.postMessage({ id: request.id, ok: true, type: 'full-scan-cancel', handle: request.handle })
    } else {
      const scan = activeScan
      if (!scan || !sameHandle(scan.handle, handle)) throw new Error('扫描会话已失效，请重新预览。')
      if (scan.busy) throw new Error('扫描页面仍在处理中，不能重复推进。')
      scan.busy = true
      operation = ++operationSequence
      const ownedOperation = operation
      const guard = scan.guardRemote ? () => beforeRemote(request.id, ownedOperation, scan.handle) : undefined
      if (request.type === 'full-scan-local') {
        const result = await index.useLocalFullScan(request.handle, guard)
        if (activeScan === scan) activeScan = undefined
        scope.postMessage({ id: request.id, ok: true, type: 'full-scan-local', handle: request.handle, result })
      } else {
        const page = request.type === 'full-scan-resume'
          ? await index.resumeFullScan(request.grant, guard)
          : await index.advanceFullScan(request.handle, guard)
        if (activeScan === scan) {
          scan.busy = false
          // Retain terminal identity for idempotent replay of the same grant.
        }
        scope.postMessage({ id: request.id, ok: true, type: 'full-scan', page })
      }
    }
  } catch (error) {
    if (operation !== undefined && operation === operationSequence && handle && sameHandle(activeScan?.handle, handle)) {
      cancelScan(handle)
      activeScan = undefined
    }
    scope.postMessage({ id: request.id, ok: false, ...(handle ? { handle } : {}),
      error: error instanceof Error ? error.message : '检索失败，请重试',
    })
  } finally {
    // Page deadlines can detach a held guard. Purge only this operation's guard;
    // an older page's finally must not cancel the newer page's authorization.
    if (operation !== undefined) cancelGuards(guard => guard.requestId === request.id && guard.operation === operation)
  }
}
