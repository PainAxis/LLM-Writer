import { MemoryIndex } from './engine'
import type { MemoryWorkerRequest, MemoryWorkerResponse } from '../../types/memory'

const index = new MemoryIndex()
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<MemoryWorkerRequest>) => void) | null
  postMessage(message: MemoryWorkerResponse): void
}

scope.onmessage = async (event) => {
  const request = event.data
  try {
    if (request.type === 'invalidate') {
      index.invalidateSource()
    } else if (request.type === 'sync') {
      scope.postMessage({ id: request.id, ok: true, type: 'sync', result: await index.sync(request.project) })
    } else if (request.type === 'search') {
      scope.postMessage({ id: request.id, ok: true, type: 'search', result: await index.search(request.query, request.options) })
    } else {
      throw new Error('不支持的检索操作')
    }
  } catch (error) {
    scope.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : '检索失败，请重试' })
  }
}
