/** Exercise the real store with injected transports/storage, plus pure policy compatibility. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { computed, effectScope, onScopeDispose, reactive, ref, watch } from 'vue'
import * as compactor from '../src/utils/contextCompactor'
import { normalizeContextPolicy, resolveAssistantContextPolicy } from '../src/utils/contextPolicy'
import { StorageKeys } from '../src/utils/storage'
import type { ContextPolicy } from '../src/types/api'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const policy = (patch: Partial<ContextPolicy> = {}) => ({ ...compactor.DEFAULT_CONTEXT_POLICY, ...patch })
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const global = policy({ maxTokens: 0, maxTurns: 5 })
const custom = policy({ maxTokens: 0, maxTurns: 1 })
assert.deepEqual(resolveAssistantContextPolicy({ contextPolicy: custom }, global), global)
assert.deepEqual(resolveAssistantContextPolicy({ contextPolicyMode: 'global', contextPolicy: custom }, global), global)
const resolved = resolveAssistantContextPolicy({ contextPolicyMode: 'custom', contextPolicy: custom }, global)
assert.deepEqual(resolved, custom)
resolved.maxTurns = 99
assert.equal(custom.maxTurns, 1)
assert.deepEqual(normalizeContextPolicy({ maxTokens: -1, maxTurns: NaN, retainTurns: Infinity, strategy: 'bad' }), compactor.DEFAULT_CONTEXT_POLICY)
assert.equal(normalizeContextPolicy({ maxTurns: 10000, summaryThreshold: 101 }).maxTurns, 500)
assert.equal(normalizeContextPolicy({ summaryThreshold: 101 }).summaryThreshold, 100)

const source = ts.createSourceFile('assistant.ts', readFileSync(new URL('../src/stores/assistant.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const implementation = source.statements.filter(statement => !ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)).map(statement => statement.getText(source)).join('\n').replace(/^export /gm, '')
const executable = ts.transpileModule(`${implementation}\nreturn {useContextPolicy,useAssistantStore}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText

function harness(initial: Record<string, unknown> = {}) {
  const disk = new Map(Object.entries(initial))
  const requests: any[] = []
  const summaryRequests: any[] = []
  const errors: string[] = []
  let summaryTransport = async () => '滚动摘要'
  let chatTransport = async (options: any) => { options.onChunk('回复', '完整回复'); return '完整回复' }
  let confirm = async () => {}
  let id = 100
  const streaming = ref(false)
  const scope = effectScope()
  const dependencies = {
    ...compactor, normalizeContextPolicy, resolveAssistantContextPolicy,
    computed, ref, reactive, watch, onScopeDispose, StorageKeys,
    defineStore: (_id: string, factory: () => unknown) => factory,
    createPersistentState: (key: string, fallback: unknown) => ({ load: () => clone(disk.get(key) ?? fallback), save: (value: unknown) => disk.set(key, clone(value)) }),
    generateUniqueId: () => id++,
    useAIStream: () => ({
      isStreaming: streaming, streamingType: ref(''),
      stop: () => { streaming.value = false },
      run: async (options: any) => {
        requests.push(options)
        streaming.value = true
        try { return await chatTransport(options) } finally { streaming.value = false }
      },
    }),
    apiService: { generateText: async (prompt: string, options: any) => { summaryRequests.push({ prompt, options }); return summaryTransport() } },
    ElMessage: { success() {}, warning() {}, error: (message: string) => errors.push(message) },
    ElMessageBox: { confirm: () => confirm() },
    console: { error() {} },
  }
  const module = scope.run(() => new Function(...Object.keys(dependencies), executable)(...Object.values(dependencies)))!
  const store = scope.run(() => module.useAssistantStore()) as any
  return { store, disk, requests, summaryRequests, errors, context: module.useContextPolicy(),
    summary: (run: typeof summaryTransport) => { summaryTransport = run },
    chat: (run: typeof chatTransport) => { chatTransport = run },
    confirm: (run: typeof confirm) => { confirm = run },
    close: () => scope.stop(),
  }
}

const h = harness()
h.context.savePolicy(global)
const local = h.store.addAssistant({ name: '独立', persona: '人设', contextPolicyMode: 'custom', contextPolicy: custom })
const inherited = h.store.addAssistant({ name: '全局', persona: '' })
h.store.setActiveAssistant(local.id)
assert.equal(h.store.activePolicy.value.maxTurns, 1)
await h.store.sendMessage('第一条')
await h.store.sendMessage('第二条')
assert.equal(h.requests[1].generateOptions.messages.length, 1)
assert.equal(h.requests[1].generateOptions.messages[0].content, '第二条')
assert.equal(h.store.conversations.value[local.id].length, 4, 'truncation retains full local history')
h.store.setActiveAssistant(inherited.id)
await h.store.sendMessage('全局一')
await h.store.sendMessage('全局二')
assert.equal(h.requests.at(-1).generateOptions.messages.length, 3)
h.store.summaries.value[local.id] = '自定义摘要'
h.store.summaries.value[inherited.id] = '全局摘要'
h.context.savePolicy(policy({ maxTurns: 4 }))
assert.equal(h.store.summaries.value[local.id], '自定义摘要')
assert.equal(h.store.summaries.value[inherited.id], undefined)
h.context.savePolicy(global)
h.store.updateAssistant(local.id, { contextPolicyMode: 'global' })
h.store.setActiveAssistant(local.id)
assert.equal(h.store.summaries.value[local.id], undefined)
await h.store.sendMessage('切回全局')
assert.equal(h.requests.at(-1).generateOptions.messages.length, 5)
assert.equal(h.store.conversations.value[local.id].length, 6)
const reloaded = harness(Object.fromEntries(h.disk))
assert.equal(reloaded.store.activePolicy.value.maxTurns, 5)
reloaded.close()
h.close()
console.log('✓ legacy/global/custom resolution, immutable defaults, real request budgets, reload and complete local history')

const s = harness()
const assistant = s.store.addAssistant({ name: '摘要', persona: '', defaultModel: 'assistant-model', contextPolicyMode: 'custom', contextPolicy: policy({ maxTokens: 0, maxTurns: 2, strategy: 'summary', retainTurns: 1 }) })
const oldSummary = deferred<string>()
s.summary(() => oldSummary.promise)
await s.store.sendMessage('需要摘要')
assert.equal(s.summaryRequests.length, 1, 'custom summary runs even when global strategy is truncation')
assert.equal(s.summaryRequests[0].options.model, 'assistant-model')
s.store.updateAssistant(assistant.id, { contextPolicy: custom })
assert.equal(s.summaryRequests[0].options.signal.aborted, true)
oldSummary.resolve('迟到摘要')
await flush()
assert.equal(s.store.summaries.value[assistant.id], undefined)
assert.equal(s.store.pendingCompaction.value[assistant.id], undefined)
assert.deepEqual(s.errors, [])

s.store.clearConversation(assistant.id)
s.store.updateAssistant(assistant.id, { contextPolicy: policy({ maxTokens: 0, maxTurns: 2, strategy: 'summary', retainTurns: 1 }) })
s.summary(async () => { throw new Error('temporary outage') })
await s.store.sendMessage('摘要失败后重试')
await flush()
assert.equal(s.store.pendingCompaction.value[assistant.id], true)
const retry = deferred<string>()
s.summary(() => retry.promise)
const retrying = s.store.retryCompaction()
assert.equal(s.summaryRequests.length, 3)
s.store.clearConversation(assistant.id)
assert.equal(s.summaryRequests[2].options.signal.aborted, true)
retry.resolve('清空后的迟到摘要')
await retrying
assert.equal(s.store.summaries.value[assistant.id], undefined)
assert.equal(s.store.pendingCompaction.value[assistant.id], undefined)
assert.equal(s.store.conversations.value[assistant.id], undefined)

const decision = deferred<void>()
s.confirm(() => decision.promise)
s.store.conversations.value[assistant.id] = [
  {id:'old1',isUser:true,content:'旧问题',timestamp:''},
  {id:'old2',isUser:false,content:'旧回复',timestamp:''},
]
const preparing = s.store.sendMessage('等待摘要决策')
assert.equal(s.store.isPreparing.value, true)
assert.equal(await s.store.sendMessage('禁止并发发送'), null)
const requestCount = s.requests.length
s.store.clearConversation(assistant.id)
decision.resolve()
assert.equal(await preparing, null)
assert.equal(s.requests.length, requestCount)
assert.equal(s.store.conversations.value[assistant.id], undefined)

s.store.updateAssistant(assistant.id, { contextPolicy: custom })
const reply = deferred<string>()
let lateChunk!: (chunk: string, full: string) => void
s.chat(options => { lateChunk = options.onChunk; return reply.promise })
const sending = s.store.sendMessage('清空后不能恢复')
await flush()
s.store.clearConversation(assistant.id)
lateChunk('迟到', '迟到完整回复')
reply.resolve('迟到完整回复')
assert.equal(await sending, null)
assert.equal(s.store.conversations.value[assistant.id], undefined)
assert.deepEqual(s.disk.get(StorageKeys.assistantConversations), {})
const partial = deferred<string>()
s.chat(options => { lateChunk = options.onChunk; return partial.promise })
const stopping = s.store.sendMessage('保留停止前的部分回复')
await flush()
lateChunk('部分', '部分回复')
s.store.stop()
lateChunk('迟到', '不应写入的迟到内容')
partial.resolve('不应覆盖的完成结果')
assert.equal((await stopping).content, '部分回复')
assert.equal((s.disk.get(StorageKeys.assistantConversations) as any)[assistant.id].at(-1).content, '部分回复')
const empty = deferred<string>()
s.chat(() => empty.promise)
const stoppingEmpty = s.store.sendMessage('还没有回复就停止')
await flush()
s.store.stop()
empty.resolve('迟到的空回复')
assert.equal(await stoppingEmpty, null)
assert.equal(s.store.conversations.value[assistant.id].length, 2)

s.store.removeAssistant(assistant.id)
assert.deepEqual(s.disk.get(StorageKeys.assistants), [])
assert.deepEqual(s.disk.get(StorageKeys.assistantConversations), {})
s.close()
console.log('✓ per-assistant summary/model/retry, policy aborts, stale completion rejection, preparation lock and clear/delete persistence')

const r = harness()
const compacted = r.store.addAssistant({ name: '成功摘要', persona: '助手人设', contextPolicyMode: 'custom', contextPolicy: policy({ maxTokens: 0, maxTurns: 2, strategy: 'summary', retainTurns: 1 }) })
await r.store.sendMessage('首轮问题')
await flush()
assert.equal(r.store.summaries.value[compacted.id], '滚动摘要')
await r.store.sendMessage('第二轮问题')
assert.equal(r.requests.at(-1).generateOptions.messages.length, 2)
assert.ok(r.requests.at(-1).generateOptions.system.includes('【此前对话摘要】\n滚动摘要'))
assert.equal(r.store.conversations.value[compacted.id].length, 4)
r.close()
console.log('✓ successful custom summary is included in outgoing system context with retained messages')
