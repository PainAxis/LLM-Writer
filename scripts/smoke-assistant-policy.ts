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
  const decisions: Array<{ message: string; options: Record<string, unknown> }> = []
  const errors: string[] = []
  let summaryTransport = async () => '滚动摘要'
  let chatTransport = async (options: any) => { options.onChunk('回复', '完整回复'); return '完整回复' }
  let confirm = async () => {}
  let failingKey = ''
  let beforeSave = (_key: string, _value: unknown) => {}
  let id = 100
  const streaming = ref(false)
  const scope = effectScope()
  const dependencies = {
    ...compactor, normalizeContextPolicy, resolveAssistantContextPolicy,
    computed, ref, reactive, watch, onScopeDispose, StorageKeys,
    defineStore: (_id: string, factory: () => unknown) => factory,
    createPersistentState: (key: string, fallback: unknown) => ({ load: () => clone(disk.get(key) ?? fallback), save: (value: unknown) => {
      beforeSave(key, value)
      if (key === failingKey) { failingKey = ''; throw new Error('simulated storage failure') }
      disk.set(key, clone(value))
    } }),
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
    ElMessageBox: { confirm: (message: string, _title: string, options: Record<string, unknown>) => {
      decisions.push({ message, options })
      return confirm()
    } },
    console: { error() {} },
  }
  const module = scope.run(() => new Function(...Object.keys(dependencies), executable)(...Object.values(dependencies)))!
  const store = scope.run(() => module.useAssistantStore()) as any
  return { store, disk, requests, summaryRequests, decisions, errors, context: module.useContextPolicy(),
    summary: (run: typeof summaryTransport) => { summaryTransport = run },
    chat: (run: typeof chatTransport) => { chatTransport = run },
    confirm: (run: typeof confirm) => { confirm = run },
    failNext: (key: string) => { failingKey = key },
    beforeSave: (run: typeof beforeSave) => { beforeSave = run },
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
assert.equal(r.store.summaries.value[compacted.id].text, '滚动摘要')
assert.equal(r.store.summaries.value[compacted.id].coveredThroughEntryId, r.store.conversations.value[compacted.id][0].id)
await r.store.sendMessage('第二轮问题')
assert.equal(r.requests.at(-1).generateOptions.messages.length, 2)
assert.ok(r.requests.at(-1).generateOptions.system.includes('【此前对话摘要】\n滚动摘要'))
assert.equal(r.store.conversations.value[compacted.id].length, 4)
r.close()
console.log('✓ successful custom summary is included in outgoing system context with retained messages')

// An old summary must never stand in for messages a pending/failed job has not
// committed. Delayed jobs receive only the interval after the coverage cursor.
const boundary = harness()
const boundaryAssistant = boundary.store.addAssistant({ name: '覆盖边界', persona: '', contextPolicyMode: 'custom', contextPolicy: policy({ maxTokens: 0, maxTurns: 4, summaryThreshold: 25, strategy: 'summary', retainTurns: 1 }) })
boundary.summary(async () => 'SUMMARY_USER_1')
await boundary.store.sendMessage('USER_1')
await flush()
const firstCursor = boundary.store.summaries.value[boundaryAssistant.id].coveredThroughEntryId
const delayedSummary = deferred<string>()
boundary.summary(() => delayedSummary.promise)
await boundary.store.sendMessage('USER_2')
const incrementalPrompt = boundary.summaryRequests.at(-1).prompt.split('【新增对话】')[1]
assert.ok(!incrementalPrompt.includes('USER_1'), 'already covered originals must not be summarized again')
assert.ok(incrementalPrompt.includes('USER_2'))
await boundary.store.sendMessage('USER_3')
const pendingMessages = boundary.requests.at(-1).generateOptions.messages
assert.ok(pendingMessages.some((entry: any) => entry.content === 'USER_2'), 'pending compaction keeps all uncovered originals')
assert.equal(boundary.store.summaries.value[boundaryAssistant.id].coveredThroughEntryId, firstCursor)
delayedSummary.reject(new Error('summary outage'))
await flush()
assert.equal(boundary.store.pendingCompaction.value[boundaryAssistant.id], true)
assert.equal(boundary.store.summaries.value[boundaryAssistant.id].coveredThroughEntryId, firstCursor)
boundary.summary(async () => 'SUMMARY_THROUGH_USER_3')
await boundary.store.retryCompaction()
const afterRetry = boundary.store.summaries.value[boundaryAssistant.id]
assert.equal(afterRetry.coveredThroughEntryId, boundary.store.conversations.value[boundaryAssistant.id].at(-2).id)
assert.equal(afterRetry.text, 'SUMMARY_THROUGH_USER_3')
const restoredBoundary = harness(Object.fromEntries(boundary.disk))
assert.equal(restoredBoundary.store.activeSummary.value, 'SUMMARY_THROUGH_USER_3')
restoredBoundary.close()
boundary.close()
console.log('✓ coverage cursors preserve originals during delayed/failed summaries, incremental input, retry and reload')

// Old string-only backups cannot supply a reliable cursor. Rebuild from all
// original messages instead of guessing that the last retained window is safe.
const legacy = harness({
  [StorageKeys.assistants]: [{ id: 1, name: 'Legacy', persona: '', contextPolicyMode: 'custom', contextPolicy: policy({ maxTokens: 0, maxTurns: 2, strategy: 'summary', retainTurns: 1 }) }],
  [StorageKeys.assistantConversations]: { 1: [{ id: 'legacy-u', content: '原始问题', isUser: true, timestamp: '' }, { id: 'legacy-a', content: '原始回复', isUser: false, timestamp: '' }] },
  [StorageKeys.assistantSummaries]: { 1: '覆盖边界未知的旧摘要' },
})
legacy.summary(async () => '重新构建的摘要')
await legacy.store.sendMessage('迁移后消息')
assert.ok(legacy.summaryRequests[0].prompt.includes('原始问题'))
assert.ok(!legacy.summaryRequests[0].prompt.includes('覆盖边界未知的旧摘要'))
assert.equal(legacy.store.summaries.value[1].text, '重新构建的摘要')
legacy.close()
console.log('✓ legacy string summaries safely rebuild from original history')

const persistence = harness()
persistence.failNext(StorageKeys.assistants)
assert.throws(() => persistence.store.addAssistant({ name: '失败创建', persona: '' }), /storage failure/)
assert.equal(persistence.store.assistants.value.length, 0)
const persistedAssistant = persistence.store.addAssistant({ name: '保存成功', persona: '原人设' })
persistence.failNext(StorageKeys.assistants)
assert.throws(() => persistence.store.updateAssistant(persistedAssistant.id, { name: '不应发布', persona: '新内容' }), /storage failure/)
assert.equal(persistence.store.assistants.value[0].name, '保存成功')
assert.equal((persistence.disk.get(StorageKeys.assistants) as any)[0].name, '保存成功')
persistence.failNext(StorageKeys.contextPolicy)
const oldPolicy = clone(persistence.context.policy.value)
assert.throws(() => persistence.context.savePolicy(policy({ maxTurns: 1 })), /storage failure/)
assert.deepEqual(persistence.context.policy.value, oldPolicy)
persistence.failNext(StorageKeys.assistantConversations)
await assert.rejects(persistence.store.sendMessage('失败首次发送'), /尚未发送消息/)
assert.equal(persistence.requests.length, 0)
assert.equal(persistence.store.conversations.value[persistedAssistant.id], undefined)
await persistence.store.sendMessage('失败首次发送')
assert.equal(persistence.requests.length, 1)
assert.equal(persistence.store.conversations.value[persistedAssistant.id].length, 2, 'retry must not append a duplicate user entry')
const committedHistory = clone(persistence.store.conversations.value)
persistence.failNext(StorageKeys.assistantConversations)
assert.throws(() => persistence.store.clearConversation(persistedAssistant.id), /storage failure/)
assert.deepEqual(persistence.store.conversations.value, committedHistory)
persistence.failNext(StorageKeys.assistantSummaries)
assert.throws(() => persistence.store.removeAssistant(persistedAssistant.id), /storage failure/)
assert.equal(persistence.store.assistants.value.length, 1)
assert.equal((persistence.disk.get(StorageKeys.assistants) as any).length, 1, 'later-key failure rolls back persisted removal')
assert.deepEqual(persistence.disk.get(StorageKeys.assistantConversations), committedHistory)
persistence.close()
console.log('✓ failed create/edit/policy/send/clear/delete preserve committed state, inputs can retry without duplicate requests')

const completedSave = harness()
const savedAssistant = completedSave.store.addAssistant({ name: '完成后保存失败', persona: '' })
let conversationWrites = 0
completedSave.beforeSave((key) => {
  if (key === StorageKeys.assistantConversations && ++conversationWrites === 2) throw new Error('final save outage')
})
const completedReply = await completedSave.store.sendMessage('请求仅生成一次')
assert.equal(completedReply.content, '完整回复')
assert.equal(completedSave.store.pendingConversationSave.value, true)
assert.equal((completedSave.disk.get(StorageKeys.assistantConversations) as any)[savedAssistant.id].at(-1).content, '')
await assert.rejects(completedSave.store.sendMessage('请求仅生成一次'), /先重试保存/)
assert.equal(completedSave.requests.length, 1)
completedSave.beforeSave(() => {})
assert.equal(completedSave.store.retryConversationSave(), true)
assert.equal(completedSave.store.pendingConversationSave.value, false)
assert.equal(completedSave.requests.length, 1, 'saving a completed reply never calls AI again')
assert.equal((completedSave.disk.get(StorageKeys.assistantConversations) as any)[savedAssistant.id].at(-1).content, '完整回复')
completedSave.close()
console.log('✓ failed final save retains generated reply and retries persistence without another AI call')

const finalBudget = harness()
const budgetAssistant = finalBudget.store.addAssistant({ name: '预算', persona: '设'.repeat(100), contextPolicyMode: 'custom', contextPolicy: policy({ maxTokens: 100, maxTurns: 0 }) })
await assert.rejects(finalBudget.store.sendMessage('当前输入'), /人设和当前消息超出/)
assert.equal(finalBudget.requests.length, 0)
assert.equal(finalBudget.store.conversations.value[budgetAssistant.id], undefined)
assert.equal(finalBudget.store.isPreparing.value, false)
finalBudget.store.updateAssistant(budgetAssistant.id, { persona: '人设', contextPolicy: policy({ maxTokens: 30, maxTurns: 0 }) })
await finalBudget.store.sendMessage('这条原文较长的消息')
await finalBudget.store.sendMessage('最新输入')
const boundedRequest = finalBudget.requests.at(-1).generateOptions
assert.ok(compactor.estimateContextTokens(boundedRequest.messages.map((entry: any) => ({ isUser: entry.role === 'user', content: entry.content })), boundedRequest.system) <= 30)
assert.equal(boundedRequest.messages.at(-1).content, '最新输入', 'budget handling keeps current input intact')
finalBudget.close()
console.log('✓ final request budget includes persona, preserves current input and releases preparation on rejection')

const summarySave = harness()
const summarySaveAssistant = summarySave.store.addAssistant({ name: '摘要落盘', persona: '', contextPolicyMode: 'custom', contextPolicy: policy({ maxTokens: 0, maxTurns: 2, summaryThreshold: 25, strategy: 'summary', retainTurns: 1 }) })
summarySave.summary(async () => '旧摘要')
await summarySave.store.sendMessage('已覆盖问题')
await flush()
const committedSummary = clone(summarySave.store.summaries.value[summarySaveAssistant.id])
summarySave.failNext(StorageKeys.assistantSummaries)
summarySave.summary(async () => '不应提交的新摘要')
await summarySave.store.sendMessage('摘要保存失败时的问题')
await flush()
assert.deepEqual(summarySave.store.summaries.value[summarySaveAssistant.id], committedSummary)
assert.deepEqual((summarySave.disk.get(StorageKeys.assistantSummaries) as any)[summarySaveAssistant.id], committedSummary)
assert.equal(summarySave.store.pendingCompaction.value[summarySaveAssistant.id], true)
summarySave.summary(async () => { throw new Error('unavailable summary') })
const previousRequestCount = summarySave.requests.length
await assert.rejects(summarySave.store.sendMessage('不能静默丢弃的当前问题'), /尚未摘要/)
assert.equal(summarySave.requests.length, previousRequestCount, 'over-budget uncovered history cannot be sent without a committed summary')
assert.ok(summarySave.store.conversations.value[summarySaveAssistant.id].some((entry: any) => entry.content === '摘要保存失败时的问题'))
summarySave.close()
console.log('✓ failed summary storage keeps text and cursor together; hard budgets reject uncompressed originals before requesting AI')

const cleanup = harness()
const cleanupAssistant = cleanup.store.addAssistant({ name: '请求失败', persona: '' })
cleanup.chat(async () => { throw new Error('unexpected transport rejection') })
await assert.rejects(cleanup.store.sendMessage('保留并重试输入'), /transport rejection/)
assert.equal(cleanup.store.conversations.value[cleanupAssistant.id].length, 0)
cleanup.chat(async (options) => { options.onChunk('成功', '重试成功'); return '重试成功' })
await cleanup.store.sendMessage('保留并重试输入')
assert.equal(cleanup.store.conversations.value[cleanupAssistant.id].length, 2)
cleanup.close()
console.log('✓ unexpected request rejection cleans its pair and remains retryable without duplicate entries')

// Run the actual view handlers to check that store failures leave editable
// dialog/input drafts, including when the user switches assistants meanwhile.
const viewSource = readFileSync(new URL('../src/views/AssistantManagement.vue', import.meta.url), 'utf8').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]
const viewAst = ts.createSourceFile('AssistantManagement.ts', viewSource, ts.ScriptTarget.Latest, true)
function viewHandler(name: string, dependencies: Record<string, unknown>) {
  const declaration = viewAst.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name)!
  const code = ts.transpileModule(`${declaration.getText(viewAst)}\nreturn ${name}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  return new Function(...Object.keys(dependencies), code)(...Object.values(dependencies))
}
const failedViewRequest = deferred<null>()
const viewDrafts = ref<Record<number, string>>({ 1: '应保留的输入', 2: '另一助手的草稿' })
const viewStore = { activeAssistantId: 1, activeAssistant: {}, isStreaming: false, isPreparing: false, sendMessage: () => failedViewRequest.promise }
const viewInput = computed({ get: () => viewDrafts.value[viewStore.activeAssistantId] ?? '', set: (text: string) => { viewDrafts.value[viewStore.activeAssistantId] = text } })
const viewErrors: string[] = []
const handleSend = viewHandler('handleSend', { store: viewStore, inputText: viewInput, inputDrafts: viewDrafts, scrollToBottom() {}, ElMessage: { error: (text: string) => viewErrors.push(text) } })
const failedSending = handleSend()
viewStore.activeAssistantId = 2
failedViewRequest.reject(new Error('initial save failure'))
await failedSending
assert.equal(viewDrafts.value[1], '应保留的输入')
assert.equal(viewDrafts.value[2], '另一助手的草稿')
assert.equal(viewErrors.length, 1)
const dialogForm = { name: '未保存助手', persona: '未保存的人设', defaultModel: '', contextPolicyMode: 'global', contextPolicy: policy() }
const dialogVisible = ref(true)
const saveDialog = viewHandler('saveDialog', { store: { addAssistant() { throw new Error('dialog save failure') } }, form: dialogForm, editingId: ref(null), showDialog: dialogVisible, normalizeContextPolicy, ElMessage: { warning() {}, success() { throw new Error('must not show success') }, error: (text: string) => viewErrors.push(text) } })
saveDialog()
assert.equal(dialogVisible.value, true)
assert.equal(dialogForm.name, '未保存助手')
assert.equal(dialogForm.persona, '未保存的人设')
console.log('✓ actual assistant view handlers retain failed dialog and per-assistant message drafts')

const overBudgetDecision = harness()
const overBudgetAssistant = overBudgetDecision.store.addAssistant({ name: '超限决策', persona: '', contextPolicyMode: 'custom', contextPolicy: policy({ maxTokens: 0, maxTurns: 2, strategy: 'summary', retainTurns: 1 }) })
overBudgetDecision.store.conversations.value[overBudgetAssistant.id] = [
  { id: 'over-u', isUser: true, content: '已有问题', timestamp: '' },
  { id: 'over-a', isUser: false, content: '已有回复', timestamp: '' },
]
overBudgetDecision.summary(async () => { throw new Error('summary unavailable') })
let decisionCount = 0
overBudgetDecision.confirm(async () => { if (++decisionCount === 2) throw 'cancel' })
assert.equal(await overBudgetDecision.store.sendMessage('超限时保留输入'), null)
assert.equal(overBudgetDecision.requests.length, 0)
assert.equal(overBudgetDecision.decisions.length, 2)
assert.ok(overBudgetDecision.decisions.every(decision => decision.options.cancelButtonText === '取消发送'))
assert.ok(overBudgetDecision.decisions[1].message.includes('当前上下文仍超出预算'))
assert.ok(overBudgetDecision.decisions.every(decision => !decision.message.includes('直接发送')))
assert.equal(overBudgetDecision.store.conversations.value[overBudgetAssistant.id].length, 2)
assert.equal(overBudgetDecision.store.isPreparing.value, false)
overBudgetDecision.close()

const withinBudgetDecision = harness()
const withinBudgetAssistant = withinBudgetDecision.store.addAssistant({ name: '预算内决策', persona: '', contextPolicyMode: 'custom', contextPolicy: policy({ maxTokens: 0, maxTurns: 6, summaryThreshold: 25, strategy: 'summary', retainTurns: 1 }) })
withinBudgetDecision.store.conversations.value[withinBudgetAssistant.id] = [
  { id: 'within-u', isUser: true, content: '预算内已有问题', timestamp: '' },
  { id: 'within-a', isUser: false, content: '预算内已有回复', timestamp: '' },
]
withinBudgetDecision.confirm(async () => { throw 'cancel' })
await withinBudgetDecision.store.sendMessage('预算内继续发送')
assert.equal(withinBudgetDecision.decisions[0].options.cancelButtonText, '使用原文发送')
assert.equal(withinBudgetDecision.requests[0].generateOptions.messages.length, 3)
assert.ok(withinBudgetDecision.requests[0].generateOptions.messages.some((entry: any) => entry.content === '预算内已有问题'))
withinBudgetDecision.close()
console.log('✓ summary decisions allow originals only within budget; over-budget failures offer retry/cancel without a request')

const confirmationRace = harness()
const racingAssistant = confirmationRace.store.addAssistant({ name: '确认期间完成', persona: '', contextPolicyMode: 'custom', contextPolicy: policy({ maxTokens: 0, maxTurns: 4, summaryThreshold: 50, strategy: 'summary', retainTurns: 1 }) })
const backgroundCompletion = deferred<string>()
confirmationRace.summary(() => backgroundCompletion.promise)
await confirmationRace.store.sendMessage('后台摘要中的原问题')
const confirmingSummary = deferred<void>()
confirmationRace.confirm(() => confirmingSummary.promise)
const sendingWhileConfirming = confirmationRace.store.sendMessage('等待确认的新问题')
assert.equal(confirmationRace.decisions.length, 1)
backgroundCompletion.resolve('后台原问题的有效摘要')
await flush()
assert.equal(confirmationRace.store.summaries.value[racingAssistant.id].text, '后台原问题的有效摘要')
confirmingSummary.resolve()
await sendingWhileConfirming
assert.ok(confirmationRace.requests.at(-1).generateOptions.system.includes('后台原问题的有效摘要'), 'new coverage cursor must be sent with its matching summary text')
assert.equal(confirmationRace.requests.at(-1).generateOptions.messages.at(-1).content, '等待确认的新问题')
confirmationRace.close()
console.log('✓ summary text/cursor pair refreshes when background compaction completes during the confirmation dialog')
