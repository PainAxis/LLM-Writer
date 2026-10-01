<template>
  <div class="assistant-page">
    <!-- 左侧：助手列表 -->
    <aside class="assistant-list">
      <div class="list-header">
        <h3>AI 助手</h3>
        <el-button type="primary" size="small" :icon="Plus" @click="openCreateDialog"
          >新建</el-button
        >
      </div>

      <div class="list-body">
        <div
          v-for="assistant in store.assistants"
          :key="assistant.id"
          class="assistant-item"
          :class="{ active: assistant.id === store.activeAssistantId }"
          @click="store.setActiveAssistant(assistant.id)"
        >
          <div class="assistant-avatar">{{ assistant.name.slice(0, 1) }}</div>
          <div class="assistant-meta">
            <div class="assistant-name">{{ assistant.name }}</div>
            <div class="assistant-persona">{{ assistant.persona || '未设置人设' }}</div>
          </div>
          <div class="assistant-actions" @click.stop>
            <el-button
              link
              size="small"
              :icon="Edit"
              aria-label="编辑助手"
              @click="openEditDialog(assistant)"
            />
            <el-button
              link
              size="small"
              type="danger"
              :icon="Delete"
              aria-label="删除助手"
              @click="confirmRemove(assistant)"
            />
          </div>
        </div>

        <el-empty
          v-if="store.assistants.length === 0"
          description="还没有助手，点击「新建」创建"
          :image-size="80"
        />
      </div>
    </aside>

    <!-- 右侧：对话区 -->
    <section class="chat-panel">
      <template v-if="store.activeAssistant">
        <div class="chat-header">
          <div class="chat-title">
            <span class="chat-name">{{ store.activeAssistant.name }}</span>
            <el-tag size="small" type="info" effect="plain">{{
              store.activeAssistant.contextPolicyMode === 'custom' ? '自定义上下文' : '全局上下文'
            }}</el-tag>
            <el-tag
              v-if="store.activeAssistant.defaultModel"
              size="small"
              type="info"
              effect="plain"
            >
              {{ store.activeAssistant.defaultModel }}
            </el-tag>
            <el-tag v-if="store.activeSummary" size="small" type="info" effect="plain"
              >已折叠摘要</el-tag
            >
            <el-tooltip
              v-if="isPendingCompaction"
              content="存在未压缩内容，点击重试生成摘要"
              placement="bottom"
            >
              <el-tag
                size="small"
                type="warning"
                class="pending-tag"
                @click="store.retryCompaction()"
                >⚠️ 待压缩</el-tag
              >
            </el-tooltip>
          </div>
          <div class="header-right">
            <span class="context-meter">上下文 {{ contextText }}</span>
            <el-button size="small" :icon="DeleteFilled" @click="confirmClearConversation"
              >清空会话</el-button
            >
          </div>
        </div>

        <div ref="messagesRef" class="chat-messages" tabindex="0" aria-label="助手会话" @scroll="onScroll" @wheel="onScrollIntent" @touchstart="onScrollIntent" @keydown="onScrollKey">
          <el-empty
            v-if="store.activeConversation.length === 0"
            description="开始与助手对话，会话将按助手隔离保存"
            :image-size="90"
          />
          <div :style="{ height: `${messageWindow.before}px` }" aria-hidden="true" />
          <div
            v-for="entry in visibleItems"
            :key="entry.id"
            :ref="node => measure(entry.id, node)"
            class="virtual-message"
          >
            <div class="message-row" :class="{ user: entry.isUser }">
              <div class="bubble">{{ entry.content }}</div>
            </div>
          </div>
          <div :style="{ height: `${messageWindow.after}px` }" aria-hidden="true" />
        </div>
        <el-button v-if="!following" class="latest-button" size="small" @click="scrollToBottom()">返回最新</el-button>

        <div class="chat-input">
          <el-input
            v-model="inputText"
            type="textarea"
            :rows="3"
            resize="none"
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            :disabled="store.isStreaming || store.isPreparing"
            @keydown.enter.exact="onEnterKey"
          />
          <div class="input-actions">
            <el-button
              v-if="!store.isStreaming && !store.isPreparing"
              type="primary"
              :icon="Promotion"
              :disabled="!inputText.trim()"
              @click="handleSend"
              >发送</el-button
            >
            <el-button v-else type="warning" :icon="VideoPause" @click="store.stop('已停止对话')"
              >停止</el-button
            >
          </div>
        </div>
      </template>

      <el-empty
        v-else
        class="chat-empty"
        description="选择或创建一个助手开始对话"
        :image-size="120"
      />
    </section>

    <!-- 新建 / 编辑助手 -->
    <el-dialog
      v-model="showDialog"
      :title="editingId ? '编辑助手' : '新建助手'"
      width="min(640px, 94vw)"
    >
      <el-form :model="form" label-width="90px">
        <el-form-item label="名称" required>
          <el-input
            v-model="form.name"
            maxlength="30"
            show-word-limit
            placeholder="例如：情节构思助手"
          />
        </el-form-item>
        <el-form-item label="人设提示词">
          <el-input
            v-model="form.persona"
            type="textarea"
            :rows="6"
            maxlength="2000"
            show-word-limit
            placeholder="描述这个助手的角色、专长与语气，将作为 system 提示词发送"
          />
        </el-form-item>
        <el-form-item label="默认模型">
          <el-select
            v-model="form.defaultModel"
            clearable
            filterable
            placeholder="跟随全局配置"
            style="width: 100%"
          >
            <el-option v-for="model in modelOptions" :key="model" :label="model" :value="model" />
          </el-select>
        </el-form-item>
        <el-form-item label="上下文设置">
          <el-radio-group v-model="form.contextPolicyMode">
            <el-radio value="global">跟随全局</el-radio>
            <el-radio value="custom">自定义</el-radio>
          </el-radio-group>
        </el-form-item>
        <p v-if="form.contextPolicyMode === 'global'" class="policy-hint">
          使用系统设置中的上下文策略。切换策略保留完整会话，摘要会在下次需要时重新生成。
        </p>
        <template v-else>
          <el-form-item label="上下文策略">
            <el-radio-group v-model="form.contextPolicy.strategy">
              <el-radio value="truncation">硬截断</el-radio>
              <el-radio value="summary">滚动摘要</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="Token 预算">
            <el-input-number
              v-model="form.contextPolicy.maxTokens"
              aria-label="Token 预算"
              :min="0"
              :max="1000000"
              :step="1000"
            />
            <span class="policy-hint">0 = 不限</span>
          </el-form-item>
          <el-form-item label="消息条数">
            <el-input-number
              v-model="form.contextPolicy.maxTurns"
              aria-label="消息条数"
              :min="0"
              :max="500"
            />
            <span class="policy-hint">用户和助手各算一条；0 = 不限</span>
          </el-form-item>
          <template v-if="form.contextPolicy.strategy === 'summary'">
            <el-form-item label="摘要阈值">
              <el-input-number
                v-model="form.contextPolicy.summaryThreshold"
                aria-label="摘要阈值"
                :min="1"
                :max="100"
              />
              <span class="policy-hint">达到预算的百分比时触发摘要</span>
            </el-form-item>
            <el-form-item label="保留原文">
              <el-input-number
                v-model="form.contextPolicy.retainTurns"
                aria-label="保留原文"
                :min="0"
                :max="500"
              />
              <span class="policy-hint">最近保留的消息条数</span>
            </el-form-item>
          </template>
          <p class="policy-hint">只影响发送给模型的上下文，本地会话保留完整原文。</p>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" :disabled="!form.name.trim()" @click="saveDialog">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed } from 'vue'
import { useVirtualMessages } from '@/composables/useVirtualMessages'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, DeleteFilled, Edit, Plus, Promotion, VideoPause } from '@element-plus/icons-vue'
import { useAssistantStore } from '@/stores/assistant'
import { useApiConfig } from '@/services/apiConfig'
import { FALLBACK_MODELS } from '@/services/aiProviders'
import { estimateTokens } from '@/utils/tokenBudget'
import { normalizeContextPolicy } from '@/utils/contextPolicy'
import type { AssistantInfo } from '@/types/api'

const store = useAssistantStore()
const { activeConfig } = useApiConfig()

const inputText = ref('')
const messagesRef = ref<HTMLElement | null>(null)

const isPendingCompaction = computed(() =>
  Boolean(store.activeAssistant && store.pendingCompaction[store.activeAssistant.id])
)

const contextTokens = computed(() =>
  estimateTokens(store.activeConversation.map((entry) => entry.content).join('\n'))
)

const contextText = computed(() => {
  const budget = store.activePolicy.maxTokens
  const current = `${(contextTokens.value / 1000).toFixed(1)}K`
  return budget > 0 ? `${current} / ${(budget / 1000).toFixed(1)}K` : current
})

const showDialog = ref(false)
const editingId = ref<number | null>(null)
const form = reactive({
  name: '',
  persona: '',
  defaultModel: '',
  contextPolicyMode: 'global' as 'global' | 'custom',
  contextPolicy: normalizeContextPolicy(undefined),
})

const modelOptions = computed(() =>
  Array.from(
    new Set([activeConfig.value.selectedModel, ...FALLBACK_MODELS.map((model) => model.id)])
  ).filter(Boolean)
)

const { visibleItems, window: messageWindow, following, measure, onScroll, onScrollIntent, onScrollKey, scrollToBottom } = useVirtualMessages(
  computed(() => store.activeConversation),
  computed(() => store.activeAssistantId),
  messagesRef,
)

function openCreateDialog(): void {
  editingId.value = null
  form.name = ''
  form.persona = ''
  form.defaultModel = ''
  form.contextPolicyMode = 'global'
  form.contextPolicy = normalizeContextPolicy(store.activePolicy)
  showDialog.value = true
}

function openEditDialog(assistant: AssistantInfo): void {
  editingId.value = assistant.id
  form.name = assistant.name
  form.persona = assistant.persona
  form.defaultModel = assistant.defaultModel ?? ''
  form.contextPolicyMode = assistant.contextPolicyMode === 'custom' ? 'custom' : 'global'
  form.contextPolicy = normalizeContextPolicy(assistant.contextPolicy)
  showDialog.value = true
}

function saveDialog(): void {
  const name = form.name.trim()
  if (!name) return
  if (
    form.contextPolicyMode === 'custom' &&
    form.contextPolicy.strategy === 'summary' &&
    form.contextPolicy.maxTurns > 0 &&
    form.contextPolicy.retainTurns >= form.contextPolicy.maxTurns
  ) {
    ElMessage.warning('保留原文条数须小于消息预算，为摘要留出空间')
    return
  }

  if (editingId.value !== null) {
    store.updateAssistant(editingId.value, {
      name,
      persona: form.persona,
      defaultModel: form.defaultModel,
      contextPolicyMode: form.contextPolicyMode,
      contextPolicy: normalizeContextPolicy(form.contextPolicy),
    })
    ElMessage.success('助手已更新')
  } else {
    store.addAssistant({
      name,
      persona: form.persona,
      defaultModel: form.defaultModel || undefined,
      contextPolicyMode: form.contextPolicyMode,
      contextPolicy: normalizeContextPolicy(form.contextPolicy),
    })
    ElMessage.success('助手已创建')
  }
  showDialog.value = false
}

async function confirmRemove(assistant: AssistantInfo): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `删除助手「${assistant.name}」将同时删除其全部会话记录，且不可恢复。确定删除吗？`,
      '确认删除',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  if (store.isStreaming) {
    store.stop('已停止对话')
  }
  store.removeAssistant(assistant.id)
  ElMessage.success('助手已删除')
}

async function confirmClearConversation(): Promise<void> {
  const assistant = store.activeAssistant
  if (!assistant) return
  try {
    await ElMessageBox.confirm(
      `确定清空与「${assistant.name}」的全部会话记录吗？此操作不可恢复。`,
      '确认清空',
      { confirmButtonText: '清空', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  store.clearConversation(assistant.id)
  ElMessage.success('会话已清空')
}

/** 中文输入法组合期间按 Enter 是确认候选词，不触发发送 */
function onEnterKey(event: Event): void {
  const keyEvent = event as KeyboardEvent
  if (keyEvent.isComposing || keyEvent.keyCode === 229) return
  keyEvent.preventDefault()
  void handleSend()
}

async function handleSend(): Promise<void> {
  const text = inputText.value.trim()
  if (!text || store.isStreaming || store.isPreparing || !store.activeAssistant) return
  const assistantId = store.activeAssistantId

  inputText.value = ''
  scrollToBottom()
  const reply = await store.sendMessage(text)
  if (
    reply === null &&
    !store.isStreaming &&
    !store.isPreparing &&
    store.activeAssistantId === assistantId &&
    !inputText.value.trim()
  ) {
    // 发送失败：把内容还原回输入框，避免用户丢失输入
    inputText.value = text
  }
}
</script>

<style scoped>
.policy-hint {
  margin: 8px 0 8px 12px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.assistant-page {
  display: flex;
  gap: 16px;
  height: calc(100vh - 120px);
  min-height: 480px;
}

.assistant-list {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--ink-50, #f6f7fb);
  border: 1px solid var(--ink-200);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--ink-100);
}

.list-header h3 {
  margin: 0;
  font-size: 15px;
  color: var(--ink-900);
}

.list-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.assistant-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.assistant-item:hover {
  background: var(--ink-100);
}

.assistant-item.active {
  background: var(--brand-50);
  box-shadow: inset 3px 0 0 var(--brand-500);
}

.assistant-avatar {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--brand-600), var(--brand-400));
  color: #fff;
  font-size: 16px;
}

.assistant-meta {
  flex: 1;
  min-width: 0;
}

.assistant-name {
  font-size: 14px;
  color: var(--ink-900);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-persona {
  font-size: 12px;
  color: var(--ink-500);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-actions {
  display: none;
  flex-shrink: 0;
}

.assistant-item:hover .assistant-actions,
.assistant-item.active .assistant-actions,
.assistant-item:focus-within .assistant-actions {
  display: flex;
}

.chat-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--ink-50, #f6f7fb);
  border: 1px solid var(--ink-200);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ink-100);
}

.chat-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.context-meter {
  font-size: 12px;
  color: var(--ink-500);
  font-variant-numeric: tabular-nums;
}

.pending-tag {
  cursor: pointer;
}

.chat-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink-900);
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  overflow-anchor: none;
}

.virtual-message {
  padding-bottom: 12px;
}

.latest-button {
  align-self: center;
  margin: 4px 0;
}

.chat-empty {
  margin: auto;
}

.message-row {
  display: flex;
}

.message-row.user {
  justify-content: flex-end;
}

.bubble {
  max-width: 78%;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--el-bg-color);
  color: var(--ink-900);
  border: 1px solid var(--ink-200);
  box-shadow: var(--shadow-card);
}

.message-row.user .bubble {
  background: var(--brand-500);
  color: #fff;
  border-color: var(--brand-500);
}

.chat-input {
  border-top: 1px solid var(--ink-100);
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.input-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
