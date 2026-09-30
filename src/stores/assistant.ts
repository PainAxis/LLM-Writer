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
  foldEntries,
  keptWithinBudget,
  type CompactorEntry,
} from '@/utils/contextCompactor'
import { normalizeContextPolicy, resolveAssistantContextPolicy } from '@/utils/contextPolicy'
import type { AssistantChatEntry, AssistantInfo, ContextPolicy } from '@/types/api'

type AssistantDraft = Pick<
  AssistantInfo,
  'name' | 'persona' | 'defaultModel' | 'contextPolicyMode'
> & { contextPolicy?: ContextPolicy }

export { DEFAULT_CONTEXT_POLICY }

// ---- 全局上下文策略（模块级单例，Settings 与对话共用；对齐 apiConfig 模式） ----
const policyState = createPersistentState<ContextPolicy>(
  StorageKeys.contextPolicy,
  DEFAULT_CONTEXT_POLICY
)
const globalPolicy = ref<ContextPolicy>(normalizeContextPolicy(policyState.load()))

export function useContextPolicy() {
  function savePolicy(policy: ContextPolicy): void {
    globalPolicy.value = normalizeContextPolicy(policy)
    policyState.save(globalPolicy.value)
  }
  function resetPolicy(): void {
    globalPolicy.value = { ...DEFAULT_CONTEXT_POLICY }
    policyState.save(globalPolicy.value)
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
  const summariesState = createPersistentState<Record<number, string>>(
    StorageKeys.assistantSummaries,
    {}
  )

  const assistants = ref<AssistantInfo[]>(assistantsState.load())
  const conversations = ref<Record<number, AssistantChatEntry[]>>(conversationsState.load())
  const summaries = ref<Record<number, string>>(summariesState.load())
  const activeAssistantId = ref<number>(assistants.value[0]?.id ?? 0)

  /** 摘要待压缩标记（assistantId → 是否有待压缩内容），失败可见可重试 */
  const pendingCompaction = ref<Record<number, boolean>>({})

  const { isStreaming, streamingType, run, stop } = useAIStream()

  const activeAssistant = computed<AssistantInfo | null>(
    () => assistants.value.find((assistant) => assistant.id === activeAssistantId.value) ?? null
  )

  const activeConversation = computed<AssistantChatEntry[]>(
    () => conversations.value[activeAssistantId.value] ?? []
  )

  const activeSummary = computed<string>(() => summaries.value[activeAssistantId.value] ?? '')

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
    if (activeReply && !activeReply.reply.content.trim()) {
      removeEntry(activeReply.assistantId, activeReply.reply.id)
      removeEntry(activeReply.assistantId, activeReply.userEntryId)
    }
    activeReply = null
    persistConversations()
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
      persistSummaries()
    },
    { deep: true, flush: 'sync' }
  )
  onScopeDispose(() => {
    stopChat()
    for (const controller of summaryRequests.values()) controller.abort()
    summaryRequests.clear()
  })

  function persistAssistants(): void {
    assistantsState.save(assistants.value)
  }

  function persistConversations(): void {
    conversationsState.save(conversations.value)
  }

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
    assistants.value.push(assistant)
    persistAssistants()
    activeAssistantId.value = assistant.id
    return assistant
  }

  function updateAssistant(id: number, patch: Partial<AssistantDraft>): void {
    const assistant = assistants.value.find((item) => item.id === id)
    if (!assistant) return
    const previousPolicy = JSON.stringify(policyOf(assistant))
    if (patch.name !== undefined) assistant.name = patch.name.trim()
    if (patch.persona !== undefined) assistant.persona = patch.persona.trim()
    if (patch.defaultModel !== undefined)
      assistant.defaultModel = patch.defaultModel.trim() || undefined
    if (patch.contextPolicyMode !== undefined) assistant.contextPolicyMode = patch.contextPolicyMode
    if (patch.contextPolicy !== undefined)
      assistant.contextPolicy = normalizeContextPolicy(patch.contextPolicy)
    if (previousPolicy !== JSON.stringify(policyOf(assistant))) {
      invalidateContext(id)
      persistSummaries()
    }
    assistant.updatedAt = new Date().toISOString()
    persistAssistants()
  }

  function removeAssistant(id: number): void {
    const index = assistants.value.findIndex((item) => item.id === id)
    if (index === -1) return
    if (sendingAssistantId === id) stopChat()
    invalidateContext(id)
    assistants.value.splice(index, 1)
    delete conversations.value[id]
    delete summaries.value[id]
    delete pendingCompaction.value[id]
    persistAssistants()
    persistConversations()
    persistSummaries()
    if (activeAssistantId.value === id) {
      activeAssistantId.value = assistants.value[0]?.id ?? 0
    }
  }

  function setActiveAssistant(id: number): void {
    if (isPreparing.value && id !== activeAssistantId.value) stopChat()
    activeAssistantId.value = id
  }

  function clearConversation(id: number): void {
    if (sendingAssistantId === id) stopChat()
    invalidateContext(id)
    delete conversations.value[id]
    delete summaries.value[id]
    delete pendingCompaction.value[id]
    persistConversations()
    persistSummaries()
  }

  /** 会话体量预警阈值（字符数，约 800KB UTF-16） */
  const CONVERSATION_WARN_CHARS = 400_000
  const warnedConversations = new Set<number>()

  function appendEntry(assistantId: number, entry: AssistantChatEntry): void {
    const list = conversations.value[assistantId] ?? []
    list.push(entry)
    conversations.value[assistantId] = list
    persistConversations()

    if (!warnedConversations.has(assistantId)) {
      const size = JSON.stringify(list).length
      if (size > CONVERSATION_WARN_CHARS) {
        warnedConversations.add(assistantId)
        ElMessage.warning('当前会话体量较大，建议清空会话或另开新助手，以免占用过多本地存储')
      }
    }
  }

  function removeEntry(assistantId: number, entryId: string): void {
    const list = conversations.value[assistantId]
    if (!list) return
    const index = list.findIndex((entry) => entry.id === entryId)
    if (index > -1) {
      list.splice(index, 1)
      persistConversations()
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
    folded: CompactorEntry[]
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
    const prompt = buildSummaryPrompt(summaries.value[assistantId] ?? '', folded)
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
      summaries.value[assistantId] = summary.trim()
      persistSummaries()
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

  /** 摘要失败后的交互：重试摘要 / 放弃摘要直接发送 / 关闭=取消发送 */
  async function askSummaryDecision(firstAttempt: boolean): Promise<'retry' | 'send' | 'cancel'> {
    try {
      await ElMessageBox.confirm(
        firstAttempt
          ? '上下文即将超出预算，需要先生成对话摘要才能继续（保证对话质量）。是否立即生成摘要？'
          : '自动摘要失败，上下文仍超出预算。是否重试生成摘要？放弃摘要将按超限上下文直接发送。',
        '上下文管理',
        {
          confirmButtonText: '重试摘要',
          cancelButtonText: '放弃摘要，直接发送',
          distinguishCancelAndClose: true,
          type: 'warning',
        }
      )
      return 'retry'
    } catch (action) {
      return action === 'cancel' ? 'send' : 'cancel'
    }
  }

  /** 手动重试后台压缩（徽标点击） */
  async function retryCompaction(): Promise<void> {
    const assistant = activeAssistant.value
    if (!assistant || !pendingCompaction.value[assistant.id]) return

    const policy = policyOf(assistant)
    const entries = toCompactorEntries(conversations.value[assistant.id] ?? [])
    const { folded } = foldEntries(entries, policy.retainTurns)
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
    const entries = toCompactorEntries(conversations.value[assistant.id] ?? [])
    const withCurrent: CompactorEntry[] = [...entries, { isUser: true, content: currentMessage }]

    let contextEntries: CompactorEntry[] = withCurrent
    let summary = ''

    if (policy.strategy === 'summary') {
      const evaluation = evaluateContext(withCurrent, policy)
      if (!evaluation.overThreshold) {
        contextEntries = withCurrent
      } else {
        summary = summaries.value[assistant.id] ?? ''
        if (!summary) {
          // 无可用摘要：询问用户（重试摘要 / 直接发送 / 取消）
          let decided = false
          let firstAttempt = true
          while (!decided) {
            const decision = await askSummaryDecision(firstAttempt)
            if (!ownsContext()) return null
            firstAttempt = false
            if (decision === 'cancel') return null
            if (decision === 'send') {
              contextEntries = withCurrent
              decided = true
              break
            }
            const { folded } = foldEntries(entries, policy.retainTurns)
            const success = await generateSummaryNow(assistant.id, folded)
            if (success === null || !ownsContext()) return null
            if (success) {
              summary = summaries.value[assistant.id] ?? ''
              decided = true
            } else {
              pendingCompaction.value[assistant.id] = true
              ElMessage.error('自动摘要失败')
            }
          }
        }
        if (summary) {
          // 从历史折叠保留原文（摘要覆盖 folded 段），再追加当前消息——与摘要边界严格衔接、无缺口
          const { kept } = foldEntries(entries, policy.retainTurns)
          contextEntries = [...kept, { isUser: true, content: currentMessage }]
        }
      }
    } else {
      contextEntries = keptWithinBudget(withCurrent, policy)
    }

    const droppedCount = withCurrent.length - contextEntries.length
    const keptMessages = contextEntries.slice(0, -1).map((entry) => ({
      role: (entry.isUser ? 'user' : 'assistant') as 'user' | 'assistant',
      content: entry.content,
    }))
    const currentEntry = contextEntries[contextEntries.length - 1]

    return {
      system: composeSystemWithSummary(assistant.persona, summary),
      messages: currentEntry
        ? [...keptMessages, { role: 'user' as const, content: currentEntry.content }]
        : keptMessages,
      droppedCount,
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

    const ticket = ++sendRevision
    const revision = revisionOf(assistant.id)
    sendingAssistantId = assistant.id
    isPreparing.value = true
    let context: Awaited<ReturnType<typeof buildContext>>
    try {
      context = await buildContext(assistant, text)
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
    appendEntry(assistant.id, {
      id: userEntryId,
      content: text,
      isUser: true,
      timestamp: new Date().toISOString(),
    })

    const replyEntry = reactive<AssistantChatEntry>({
      id: `${generateUniqueId()}`,
      content: '',
      isUser: false,
      timestamp: new Date().toISOString(),
    })
    appendEntry(assistant.id, replyEntry)
    activeReply = { assistantId: assistant.id, userEntryId, reply: replyEntry }

    const result = await run({
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
      removeEntry(assistant.id, replyEntry.id)
      if (userEntryId) removeEntry(assistant.id, userEntryId)
      return null
    }

    replyEntry.content = result
    persistConversations()

    // 回复完成后的后台压缩：仅 summary 策略且仍超阈值时执行；失败可见可重试
    void maybeCompactAfterReply(assistant.id)

    return replyEntry
  }

  /** 回复完成后的后台增量压缩 */
  async function maybeCompactAfterReply(assistantId: number): Promise<void> {
    const assistant = assistants.value.find((item) => item.id === assistantId)
    if (!assistant) return

    const policy = policyOf(assistant)
    if (policy.strategy !== 'summary') return

    const entries = toCompactorEntries(conversations.value[assistantId] ?? [])
    const evaluation = evaluateContext(entries, policy)
    if (!evaluation.overThreshold) return

    const { folded } = foldEntries(entries, policy.retainTurns)
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
