import assert from 'node:assert/strict'
import { ref } from 'vue'
import { useGenerationTask } from '../src/composables/useGenerationTask'
import { createAIRequestScope } from '../src/utils/aiRequestScope'
import type { GenerateOptions, StreamCallback } from '../src/types/api'

function fixture() {
  const source = ref({ id: 1, open: true })
  const requests: Array<{ callback: StreamCallback | null; signal: AbortSignal; resolve(text: string): void; reject(error: Error): void }> = []
  const scope = createAIRequestScope((_prompt, options, callback) => new Promise<string>((resolve, reject) => {
    requests.push({ callback, signal: options.signal!, resolve, reject })
  }), () => {})
  const task = useGenerationTask({ source: () => source.value, stream: scope })
  const text = ref('')
  const notices: string[] = []
  const queued: Array<() => void> = []
  const request = {
    prompt: 'synthetic', options: { type: 'test' } satisfies GenerateOptions,
    onText: (value: string, current: () => boolean) => {
      text.value = value
      queued.push(() => { if (current()) notices.push('scroll') })
    },
    onSuccess: () => { notices.push('success') },
    onError: (error: Error) => { notices.push(error.message) },
  }
  return { source, requests, task, text, notices, queued, request }
}

for (const cancel of ['stop', 'source', 'close', 'dispose'] as const) {
  const f = fixture()
  const run = f.task.start(f.request)
  const old = f.requests[0]!
  old.callback?.('partial', 'partial')
  if (cancel === 'stop') f.task.stop()
  if (cancel === 'source') f.source.value.id = 2
  if (cancel === 'close') f.source.value.open = false
  if (cancel === 'dispose') f.task.dispose()
  assert.equal(old.signal.aborted, true)
  old.callback?.('late', 'late')
  old.resolve('late result')
  assert.equal(await run, false)
  f.queued.forEach(job => job())
  assert.equal(f.text.value, 'partial')
  assert.equal(f.task.running.value, false)
  assert.deepEqual(f.notices, [])
  f.task.dispose()
}

{
  const f = fixture()
  const old = f.task.start(f.request)
  const fresh = f.task.start(f.request)
  f.requests[0]!.reject(new Error('obsolete error'))
  assert.equal(await old, false)
  assert.equal(f.task.running.value, true)
  f.requests[1]!.resolve('complete')
  assert.equal(await fresh, true)
  f.requests[1]!.callback?.('late', 'late after completion')
  assert.equal(f.text.value, 'complete')
  assert.deepEqual(f.notices, ['success'])
  f.task.dispose()
}

{
  const f = fixture()
  let confirm!: () => void
  let recovered = false
  const old = f.task.start({ ...f.request, onError: async (_error, current) => {
    await new Promise<void>(resolve => { confirm = resolve })
    if (current()) recovered = true
  } })
  f.requests[0]!.reject(new Error('failure'))
  await Promise.resolve()
  await Promise.resolve()
  f.source.value.open = false
  confirm()
  await old
  assert.equal(recovered, false, 'Closing a form also invalidates a pending fallback confirmation')
  const empty = f.task.start(f.request)
  f.requests[1]!.resolve('  ')
  assert.equal(await empty, false)
  assert.deepEqual(f.notices, ['AI返回内容为空'])
  f.task.dispose()
  assert.equal(await f.task.start(f.request), false)
}
console.log('✓ Generation ownership covers abort, source changes, dialog closure, unmount, restart, late callbacks and asynchronous recovery')
