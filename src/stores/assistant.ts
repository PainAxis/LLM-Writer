import { defineStore } from 'pinia'
import { computed, ref, reactive, watch, onScopeDispose } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAIStream } from '@/composables/useAIStream'
import apiService from '@/services/api'
import { generateUniqueId } from '@/utils/id'
import { createPersistentState, StorageKeys } from '@/utils/storage'
import {
  buildSummaryPrompt,
  composeSystemWithSummary,
  DEFAULT_CONTEXT_POLICY,
  evaluateContext,
  fitContextWithinBudget,
  estimateContextTokens,
  type CompactorEntry,
} from '@/utils/contextCompactor'
import { normalizeContextPolicy, resolveAssistantContextPolicy } from '@/utils/contextPolicy'
import type { AssistantChatEntry, AssistantInfo, ContextPolicy } from '@/types/api'

type AssistantDraft = Pick<
  AssistantInfo,
  'name' | 'persona' | 'defaultModel' | 'contextPolicyMode'
> & { contextPolicy?: ContextPolicy }

interface ConversationSummary {
  text: string
  coveredThroughEntryId: string
  policyFingerprint?: string
}
type StoredSummary = string | ConversationSummary

export { DEFAULT_CONTEXT_POLICY }

// ---- 全局上下文策略（模块级单例，Settings 与对话共用；对齐 apiConfig 模式） ----
const policyState = createPersistentState<ContextPolicy>(
  StorageKeys.contextPolicy,
  DEFAULT_CONTEXT_POLICY
)
const globalPolicy = ref<ContextPolicy>(normalizeContextPolicy(policyState.load()))

export function useContextPolicy() {
  function savePolicy(policy: ContextPolicy): void {
    const next = normalizeContextPolicy(policy)
    policyState.save(next)
    globalPolicy.value = next
  }
  function resetPolicy(): void {
    savePolicy({ ...DEFAULT_CONTEXT_POLICY })
  }
  return { policy: globalPolicy, savePolicy, resetPolicy }
}

/**
 * AI 助手 store：助手 CRUD + 按助手隔离的会话持久化 + 流式对话 + 上下文容量管理。
 */
export const useAssistantStore = defineStore('assistant', () => {
  const assistantsState = createPersistentState<AssistantInfo[]>(StorageKeys.assistants, [])
  const conversationsState = createPersistentState<Record<number, AssistantChatEntry[]>>(
    StorageKeys.assistantConversations,
    {}
  )
  const summariesState = createPersistentState<Record<number, StoredSummary>>(
    StorageKeys.assistantSummaries,
    {}
  )

  const assistants = ref<AssistantInfo[]>(assistantsState.load())
  const conversations = ref<Record<number, AssistantChatEntry[]>>(conversationsState.load())
  const summaries = ref<Record<number, StoredSummary>>(summariesState.load())
  const activeAssistantId = ref<number>(assistants.value[0]?.id ?? 0)

  /** 摘要待压缩标记（assistantId → 是否有待压缩内容），失败可见可重试 */
  const pendingCompaction = ref<Record<number, boolean>>({})
  const pendingConversationSave = ref(false)

  const { isStreaming, streamingType, run, stop } = useAIStream()

  const activeAssistant = computed<AssistantInfo | null>(
    () => assistants.value.find((assistant) => assistant.id === activeAssistantId.value) ?? null
  )

  const activeConversation = computed<AssistantChatEntry[]>(
    () => conversations.value[activeAssistantId.value] ?? []
  )

  const activeSummary = computed<string>(() => validSummary(activeAssistantId.value)?.text ?? '')

  const activePolicy = computed<ContextPolicy>(() =>
    resolveAssistantContextPolicy(activeAssistant.value, globalPolicy.value)
  )
  const isPreparing = ref(false)
  const summaryRequests = new Map<number, AbortController>()
  const contextRevisions = new Map<number, number>()
  let sendRevision = 0
  let sendingAssistantId: number | null = null
  let activeReply: { assistantId: number; userEntryId: string; reply: AssistantChatEntry } | null =
    null
  const revisionOf = (id: number) => contextRevisions.get(id) ?? 0
  const policyOf = (assistant: AssistantInfo) =>
    resolveAssistantContextPolicy(assistant, globalPolicy.value)

  // Historical string summaries have no trustworthy coverage boundary. Keep them
  // readable in backups, but rebuild from the retained original history before use.
  function validSummary(id: number): ConversationSummary | undefined {
    const value = summaries.value[id]
    const assistant = assistants.value.find(item => item.id === id)
    if (!value || typeof value === 'string' || !assistant || !value.text?.trim()) return
    if (value.policyFingerprint && value.policyFingerprint !== JSON.stringify(policyOf(assistant))) return
    if (!(conversations.value[id] ?? []).some(entry => entry.id === value.coveredThroughEntryId)) return
    return value
  }

  function uncoveredEntries(id: number): AssistantChatEntry[] {
    const entries = (conversations.value[id] ?? []).filter(entry => entry.content.trim())
    const summary = validSummary(id)
    const covered = summary ? entries.findIndex(entry => entry.id === summary.coveredThroughEntryId) : -1
    return entries.slice(covered + 1)
  }

  function saveConversationSnapshot(next: Record<number, AssistantChatEntry[]>): void {
    conversationsState.save(next)
    conversations.value = next
    pendingConversationSave.value = false
  }

  function retryConversationSave(): boolean {
    try {
      saveConversationSnapshot({ ...conversations.value })
      return true
    } catch (error) {
      pendingConversationSave.value = true
      ElMessage.error(`会话保存失败，内容仍保留在当前页面：${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  /** These three keys use synchronous localStorage; publish only after every
   * write succeeds. If a later key fails, restore the earlier persisted keys. */
  function commitCollections(nextAssistants: AssistantInfo[], nextConversations: Record<number, AssistantChatEntry[]>, nextSummaries: Record<number, StoredSummary>): void {
    const before = [assistants.value, conversations.value, summaries.value] as const
    const writes: Array<{ write: () => void; rollback: () => void }> = []
    if (nextAssistants !== before[0]) writes.push({ write: () => { assistantsState.save(nextAssistants) }, rollback: () => { assistantsState.save(before[0]) } })
    if (nextConversations !== before[1]) writes.push({ write: () => { conversationsState.save(nextConversations) }, rollback: () => { conversationsState.save(before[1]) } })
    if (nextSummaries !== before[2]) writes.push({ write: () => { summariesState.save(nextSummaries) }, rollback: () => { summariesState.save(before[2]) } })
    const committed: typeof writes = []
    try {
      for (const operation of writes) {
        operation.write()
        committed.push(operation)
      }
    } catch (error) {
      for (const operation of committed.reverse()) {
        try { operation.rollback() } catch (rollbackError) {
          console.error('[assistant] 保存回滚失败:', rollbackError)
        }
      }
      throw error
    }
    assistants.value = nextAssistants
    conversations.value = nextConversations
    summaries.value = nextSummaries
    if (nextConversations !== before[1]) pendingConversationSave.value = false
  }

  function invalidateContext(id: number): void {
    contextRevisions.set(id, revisionOf(id) + 1)
    summaryRequests.get(id)?.abort()
    summaryRequests.delete(id)
    delete summaries.value[id]
    delete pendingCompaction.value[id]
  }

  function stopChat(message?: string): void {
    sendRevision++
    isPreparing.value = false
    if (sendingAssistantId !== null) {
      summaryRequests.get(sendingAssistantId)?.abort()
      summaryRequests.delete(sendingAssistantId)
    }
    sendingAssistantId = null
    stop(message)
    if (activeReply && conversations.value[activeReply.assistantId] && !activeReply.reply.content.trim()) {
      const { assistantId, reply, userEntryId } = activeReply
      conversations.value = {
        ...conversations.value,
        [assistantId]: (conversations.value[assistantId] ?? []).filter(entry => entry.id !== reply.id && entry.id !== userEntryId),
      }
    }
    activeReply = null
    retryConversationSave()
  }

  let globalPolicyFingerprint = JSON.stringify(normalizeContextPolicy(globalPolicy.value))
  watch(
    globalPolicy,
    () => {
      const fingerprint = JSON.stringify(normalizeContextPolicy(globalPolicy.value))
      if (fingerprint === globalPolicyFingerprint) return
      globalPolicyFingerprint = fingerprint
      for (const assistant of assistants.value) {
        if (assistant.contextPolicyMode !== 'custom') invalidateContext(assistant.id)
      }
      try { persistSummaries() } catch (error) {
        console.error('[assistant] 保存摘要失效状态失败:', error)
      }
    },
    { deep: true, flush: 'sync' }
  )
  onScopeDispose(() => {
    stopChat()
    for (const controller of summaryRequests.values()) controller.abort()
    summaryRequests.clear()
  })

  function persistSummaries(): void {
    summariesState.save(summaries.value)
  }

  function addAssistant(data: AssistantDraft): AssistantInfo {
    const now = new Date().toISOString()
    const assistant: AssistantInfo = {
      id: generateUniqueId(),
      name: data.name.trim(),
      persona: data.persona.trim(),
      defaultModel: data.defaultModel?.trim() || undefined,
      contextPolicyMode: data.contextPolicyMode === 'custom' ? 'custom' : 'global',
      contextPolicy: normalizeContextPolicy(data.contextPolicy),
      createdAt: now,
      updatedAt: now,
    }
    const next = [...assistants.value, assistant]
    assistantsState.save(next)
    assistants.value = next
    activeAssistantId.value = assistant.id
    return assistant
  }

  function updateAssistant(id: number, patch: Partial<AssistantDraft>): void {
    const existing = assistants.value.find((item) => item.id === id)
    if (!existing) throw new Error('助手已被删除，请重新打开编辑窗口')
    const assistant = { ...existing }
    const previousPolicy = JSON.stringify(policyOf(existing))
    if (patch.name !== undefined) assistant.name = patch.name.trim()
    if (patch.persona !== undefined) assistant.persona = patch.persona.trim()
    if (patch.defaultModel !== undefined)
      assistant.defaultModel = patch.defaultModel.trim() || undefined
    if (patch.contextPolicyMode !== undefined) assistant.contextPolicyMode = patch.contextPolicyMode
    if (patch.contextPolicy !== undefined)
      assistant.contextPolicy = normalizeContextPolicy(patch.contextPolicy)
    const changedPolicy = previousPolicy !== JSON.stringify(policyOf(assistant))
    assistant.updatedAt = new Date().toISOString()
    const nextSummaries = { ...summaries.value }
    if (changedPolicy) delete nextSummaries[id]
    commitCollections(assistants.value.map(item => item.id === id ? assistant : item), conversations.value, changedPolicy ? nextSummaries : summaries.value)
    if (changedPolicy) invalidateContext(id)
  }

  function removeAssistant(id: number): void {
    const index = assistants.value.findIndex((item) => item.id === id)
    if (index === -1) return
    const nextConversations = { ...conversations.value }
    const nextSummaries = { ...summaries.value }
    delete nextConversations[id]
    delete nextSummaries[id]
    commitCollections(assistants.value.filter(item => item.id !== id), nextConversations, nextSummaries)
    invalidateContext(id)
    if (sendingAssistantId === id) stopChat()
    if (activeAssistantId.value === id) {
      activeAssistantId.value = assistants.value[0]?.id ?? 0
    }
  }

  function setActiveAssistant(id: number): void {
    if (isPreparing.value && id !== activeAssistantId.value) stopChat()
    activeAssistantId.value = id
  }

  function clearConversation(id: number): void {
    const nextConversations = { ...conversations.value }
    const nextSummaries = { ...summaries.value }
    delete nextConversations[id]
    delete nextSummaries[id]
    commitCollections(assistants.value, nextConversations, nextSummaries)
    invalidateContext(id)
    if (sendingAssistantId === id) stopChat()
  }

  /** 会话体量预警阈值（字符数，约 800KB UTF-16） */
  const CONVERSATION_WARN_CHARS = 400_000
  const warnedConversations = new Set<number>()

  function warnConversationSize(assistantId: number): void {
    if (!warnedConversations.has(assistantId)) {
      const list = conversations.value[assistantId] ?? []
      const size = JSON.stringify(list).length
      if (size > CONVERSATION_WARN_CHARS) {
        warnedConversations.add(assistantId)
        ElMessage.warning('当前会话体量较大，建议清空会话或另开新助手，以免占用过多本地存储')
      }
    }
  }

  // ============ 上下文压缩 ============

  function toCompactorEntries(entries: AssistantChatEntry[]): CompactorEntry[] {
    return entries
      .filter((entry) => entry.content.trim())
      .map((entry) => ({ isUser: entry.isUser, content: entry.content }))
  }

  /** 调用 AI 生成增量摘要；成功则更新并清除待压缩标记 */
  async function generateSummaryNow(
    assistantId: number,
    folded: AssistantChatEntry[]
  ): Promise<boolean | null> {
    const assistant = assistants.value.find((item) => item.id === assistantId)
    if (!assistant) return null
    if (folded.length === 0) {
      pendingCompaction.value[assistantId] = false
      return true
    }
    const policy = JSON.stringify(policyOf(assistant))
    const revision = revisionOf(assistantId)
    summaryRequests.get(assistantId)?.abort()
    const controller = new AbortController()
    summaryRequests.set(assistantId, controller)
    const ownsSummary = () => {
      const current = assistants.value.find((item) => item.id === assistantId)
      return (
        !controller.signal.aborted &&
        summaryRequests.get(assistantId) === controller &&
        revisionOf(assistantId) === revision &&
        !!current &&
        JSON.stringify(policyOf(current)) === policy
      )
    }
    const previous = validSummary(assistantId)
    const coveredThroughEntryId = folded[folded.length - 1]!.id
    const prompt = buildSummaryPrompt(previous?.text ?? '', toCompactorEntries(folded))
    try {
      const summary = await apiService.generateText(prompt, {
        type: 'chat-summary',
        model: assistant.defaultModel || undefined,
        signal: controller.signal,
        maxTokens: 800,
        temperature: 0.3,
        system: '你是对话摘要助手。请忠实、精炼地概括对话内容，保留关键事实、决定与未尽事项。',
      })
      if (!ownsSummary()) return null
      if (!summary.trim()) return false
      const next = { ...summaries.value, [assistantId]: {
        text: summary.trim(), coveredThroughEntryId, policyFingerprint: policy,
      } }
      summariesState.save(next)
      if (!ownsSummary()) return null
      summaries.value = next
      pendingCompaction.value[assistantId] = false
      return true
    } catch (error) {
      if (!ownsSummary()) return null
      console.error('[assistant] 自动摘要失败:', error)
      return false
    } finally {
      if (summaryRequests.get(assistantId) === controller) summaryRequests.delete(assistantId)
    }
  }

  /** Original messages may be sent only while the assembled request still fits. */
  async function askSummaryDecision(firstAttempt: boolean, canSendOriginals: boolean): Promise<'retry' | 'send' | 'cancel'> {
    const message = canSendOriginals
      ? firstAttempt
        ? '上下文接近预算，建议生成摘要。当前原文仍在预算内，也可使用原文发送。'
        : '自动摘要失败。当前原文仍在预算内，可以重试摘要或使用原文发送。'
      : firstAttempt
        ? '当前上下文已超出预算，需要成功生成摘要后才能发送。也可取消发送，缩短输入或提高预算。'
        : '自动摘要失败，当前上下文仍超出预算。请重试摘要，或取消发送后调整输入与预算。'
    try {
      await ElMessageBox.confirm(
        message,
        '上下文管理',
        {
          confirmButtonText: '重试摘要',
          cancelButtonText: canSendOriginals ? '使用原文发送' : '取消发送',
          distinguishCancelAndClose: true,
          type: 'warning',
        }
      )
      return 'retry'
    } catch (action) {
      return action === 'cancel' && canSendOriginals ? 'send' : 'cancel'
    }
  }

  /** 手动重试后台压缩（徽标点击） */
  async function retryCompaction(): Promise<void> {
    const assistant = activeAssistant.value
    if (!assistant || !pendingCompaction.value[assistant.id]) return

    const policy = policyOf(assistant)
    const entries = uncoveredEntries(assistant.id)
    const folded = entries.slice(0, Math.max(0, entries.length - policy.retainTurns))
    const success = await generateSummaryNow(assistant.id, folded)
    if (success === null) return
    if (success) {
      ElMessage.success('对话摘要已更新')
    } else {
      pendingCompaction.value[assistant.id] = true
      ElMessage.error('自动摘要失败，请稍后重试')
    }
  }

  /**
   * 组装本次发送的上下文；summary 策略下可能触发摘要生成交互。
   * 返回 null 表示用户取消发送。
   */
  async function buildContext(
    assistant: AssistantInfo,
    currentMessage: string
  ): Promise<{
    system: string
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    droppedCount: number
  } | null> {
    const policy = policyOf(assistant)
    const revision = revisionOf(assistant.id)
    const ownsContext = () =>
      revisionOf(assistant.id) === revision &&
      assistants.value.some((item) => item.id === assistant.id)
    const history = (conversations.value[assistant.id] ?? []).filter(entry => entry.content.trim())
    const current = { isUser: true, content: currentMessage }
    let summary = validSummary(assistant.id)
    let contextEntries = [...toCompactorEntries(history), current]

    if (policy.strategy === 'summary') {
      const refreshEntries = () => [...toCompactorEntries(uncoveredEntries(assistant.id)), current]
      contextEntries = refreshEntries()
      const evaluation = evaluateContext(contextEntries, policy, composeSystemWithSummary(assistant.persona, summary?.text ?? ''))
      if (!summary && evaluation.overThreshold && uncoveredEntries(assistant.id).length > policy.retainTurns) {
        let firstAttempt = true
        while (!summary) {
          const canSendOriginals = !evaluateContext(refreshEntries(), policy, assistant.persona).overBudget
          const decision = await askSummaryDecision(firstAttempt, canSendOriginals)
          if (!ownsContext()) return null
          firstAttempt = false
          if (decision === 'cancel') return null
          // A previous reply's background summary may commit while the user is
          // deciding. Its text and cursor must be consumed as one fresh pair.
          summary = validSummary(assistant.id)
          if (summary) break
          if (decision === 'send') break
          const entries = uncoveredEntries(assistant.id)
          const folded = entries.slice(0, Math.max(0, entries.length - policy.retainTurns))
          if (!folded.length) break
          const success = await generateSummaryNow(assistant.id, folded)
          if (success === null || !ownsContext()) return null
          if (success) summary = validSummary(assistant.id)
          else {
            pendingCompaction.value[assistant.id] = true
            ElMessage.error('自动摘要失败')
          }
        }
      } else if (summary && evaluation.overBudget) {
        // The old cursor remains authoritative while a background job is pending
        // or failed. Compress the uncovered interval before a hard-budget send.
        const entries = uncoveredEntries(assistant.id)
        const folded = entries.slice(0, Math.max(0, entries.length - policy.retainTurns))
        const success = await generateSummaryNow(assistant.id, folded)
        if (success === null || !ownsContext()) return null
        if (!success) pendingCompaction.value[assistant.id] = true
        summary = validSummary(assistant.id)
      }
      summary = validSummary(assistant.id)
      contextEntries = refreshEntries()
    }

    const system = composeSystemWithSummary(assistant.persona, policy.strategy === 'summary' ? summary?.text ?? '' : '')
    // Uncovered originals are never discarded by the summary strategy. Only a
    // committed coverage cursor permits replacing them with summary text.
    const fitted = fitContextWithinBudget(contextEntries, policy, system, policy.strategy === 'summary')
    return {
      system,
      messages: fitted.map(entry => ({ role: entry.isUser ? 'user' as const : 'assistant' as const, content: entry.content })),
      droppedCount: history.length + 1 - fitted.length,
    }
  }

  /** 发送消息：占位助手条目流式填充；失败/为空时移除占位 */
  async function sendMessage(content: string): Promise<AssistantChatEntry | null> {
    const assistant = activeAssistant.value
    if (!assistant) {
      throw new Error('请先选择助手')
    }
    const text = content.trim()
    if (!text || isStreaming.value || isPreparing.value) {
      return null
    }
    if (pendingConversationSave.value) {
      throw new Error('请先重试保存当前会话，再发送新消息')
    }

    const ticket = ++sendRevision
    const revision = revisionOf(assistant.id)
    sendingAssistantId = assistant.id
    isPreparing.value = true
    let context: Awaited<ReturnType<typeof buildContext>>
    try {
      context = await buildContext(assistant, text)
    } catch (error) {
      if (ticket === sendRevision) sendingAssistantId = null
      throw error
    } finally {
      if (ticket === sendRevision) isPreparing.value = false
    }
    if (
      context === null ||
      ticket !== sendRevision ||
      revision !== revisionOf(assistant.id) ||
      !assistants.value.some((item) => item.id === assistant.id)
    ) {
      if (ticket === sendRevision) sendingAssistantId = null
      return null
    }

    const userEntryId = String(generateUniqueId())
    const userEntry: AssistantChatEntry = {
      id: userEntryId,
      content: text,
      isUser: true,
      timestamp: new Date().toISOString(),
    }

    const replyEntry = reactive<AssistantChatEntry>({
      id: `${generateUniqueId()}`,
      content: '',
      isUser: false,
      timestamp: new Date().toISOString(),
    })
    try {
      saveConversationSnapshot({
        ...conversations.value,
        [assistant.id]: [...(conversations.value[assistant.id] ?? []), userEntry, replyEntry],
      })
    } catch (error) {
      sendingAssistantId = null
      throw new Error(`会话保存失败，尚未发送消息：${error instanceof Error ? error.message : String(error)}`)
    }
    warnConversationSize(assistant.id)
    activeReply = { assistantId: assistant.id, userEntryId, reply: replyEntry }

    let result: string | null
    try {
      result = await run({
        type: 'chat',
        prompt: text,
        generateOptions: {
          system: context.system,
          model: assistant.defaultModel || undefined,
          messages: context.messages,
        },
        successMessage: '',
        errorPrefix: '对话',
        onChunk: (_chunk, fullContent) => {
          if (ticket === sendRevision) replyEntry.content = fullContent
        },
      })
    } catch (error) {
      if (ticket === sendRevision) {
        sendingAssistantId = null
        activeReply = null
        conversations.value = {
          ...conversations.value,
          [assistant.id]: (conversations.value[assistant.id] ?? []).filter(entry => entry.id !== replyEntry.id && entry.id !== userEntryId),
        }
        retryConversationSave()
      }
      throw error
    }

    if (ticket !== sendRevision) {
      return replyEntry.content.trim() &&
        conversations.value[assistant.id]?.some((entry) => entry.id === replyEntry.id)
        ? replyEntry
        : null
    }
    sendingAssistantId = null
    activeReply = null
    if (result === null) {
      // 失败/取消：移除空占位与用户消息，配合视图把输入还原，保证干净重试
      conversations.value = {
        ...conversations.value,
        [assistant.id]: (conversations.value[assistant.id] ?? []).filter(entry => entry.id !== replyEntry.id && entry.id !== userEntryId),
      }
      retryConversationSave()
      return null
    }

    replyEntry.content = result
    const saved = retryConversationSave()

    // 回复完成后的后台压缩：仅 summary 策略且仍超阈值时执行；失败可见可重试
    if (saved) void maybeCompactAfterReply(assistant.id)

    return replyEntry
  }

  /** 回复完成后的后台增量压缩 */
  async function maybeCompactAfterReply(assistantId: number): Promise<void> {
    const assistant = assistants.value.find((item) => item.id === assistantId)
    if (!assistant) return

    const policy = policyOf(assistant)
    if (policy.strategy !== 'summary') return

    const entries = uncoveredEntries(assistantId)
    const evaluation = evaluateContext(toCompactorEntries(entries), policy, composeSystemWithSummary(assistant.persona, validSummary(assistantId)?.text ?? ''))
    if (!evaluation.overThreshold) return

    const folded = entries.slice(0, Math.max(0, entries.length - policy.retainTurns))
    const success = await generateSummaryNow(assistantId, folded)
    if (success === null) return
    if (!success) {
      pendingCompaction.value[assistantId] = true
      ElMessage.error('自动摘要失败，对话上下文已超限；可点击「待压缩」徽标重试')
    }
  }

  return {
    assistants,
    conversations,
    summaries,
    pendingCompaction,
    activeAssistantId,
    activeAssistant,
    activeConversation,
    activeSummary,
    contextTokenCount: computed(() => {
      const assistant = activeAssistant.value
      if (!assistant) return 0
      const summary = activePolicy.value.strategy === 'summary' ? validSummary(assistant.id) : undefined
      return estimateContextTokens(toCompactorEntries(summary ? uncoveredEntries(assistant.id) : activeConversation.value), composeSystemWithSummary(assistant.persona, summary?.text ?? ''))
    }),
    pendingConversationSave,
    retryConversationSave,
    activePolicy,
    isStreaming,
    isPreparing,
    streamingType,
    addAssistant,
    updateAssistant,
    removeAssistant,
    setActiveAssistant,
    clearConversation,
    sendMessage,
    retryCompaction,
    stop: stopChat,
  }
})
