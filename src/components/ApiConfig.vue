<template>
  <div class="api-config">
    <el-card class="config-card">
      <template #header>
        <div class="card-header">
          <span>API配置</span>
          <el-tag :type="isApiConfigured ? 'success' : 'danger'" size="small">
            {{ isApiConfigured ? '已配置' : '未配置' }}
          </el-tag>
        </div>
      </template>

      <!-- 主要内容区域 - 左右分栏 -->
      <div class="config-main-content">
        <!-- 左侧：配置说明 -->
        <div class="config-tips-panel">
          <div class="config-tips">
            <h4>⚙️ 配置说明</h4>
            <div class="tips-content">
              <p>支持官方 API，以及自定义 <strong>OpenAI / Anthropic 兼容格式</strong> 的 API 接口。</p>

              <div class="params-info">
                <h5>参数说明：</h5>
                <ul>
                  <li><strong>API地址</strong> - 您的 API 服务地址</li>
                  <li><strong>API密钥</strong> - 身份验证密钥</li>
                  <li><strong>模型选择</strong> - 如果没有想要的模型，支持自定义模型</li>
                  <li><strong>输出预算</strong> - 限制生成 Token，部分模型包含思考消耗</li>
                  <li><strong>思考设置</strong> - 按模型能力设置开关、强度或预算</li>
                  <li><strong>创造性</strong> - 0保守，1创新</li>
                </ul>
              </div>

              <div class="supported-apis">
                <h5>特殊说明：</h5>
                <ul>
                  <li>请按接口格式选择服务商；Anthropic 兼容网关也可调用非 Claude 模型</li>
                  <li>本地部署的 Ollama、LM Studio 等服务，可选择 OpenAI 兼容格式接入</li>
                </ul>
              </div>

              <div class="tips-note">
                <p>💡 连接测试只检查地址与身份验证；是否支持预算参数，以实际生成请求为准。</p>
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧：配置表单 -->
        <div class="config-form-panel">
          <el-form :model="form" label-width="80px" size="small" class="config-form">
            <el-form-item label="服务商" required>
              <el-select v-model="form.provider" style="width: 100%" @change="onProviderChange">
                <el-option
                  v-for="preset in PROVIDER_PRESETS"
                  :key="preset.id"
                  :label="preset.label"
                  :value="preset.id"
                />
              </el-select>
              <div class="form-tip">自定义网关请按接口格式选择 OpenAI 兼容或 Anthropic，再填写服务地址。</div>
            </el-form-item>

            <el-form-item label="API密钥" required>
              <el-input
                v-model="form.apiKey"
                type="password"
                placeholder="请输入API密钥"
                show-password
                clearable
              />
            </el-form-item>

            <el-form-item label="API地址" :required="currentPreset.editableBaseURL">
              <el-input
                v-model="form.baseURL"
                :placeholder="currentPreset.kind === 'anthropic' ? '例如：https://api.anthropic.com/v1' : '例如：https://api.openai.com/v1'"
                :disabled="!currentPreset.editableBaseURL"
                clearable
              />
              <div class="form-tip">{{ baseURLHint }}</div>
            </el-form-item>

            <el-form-item label="模型选择">
              <el-select v-model="form.selectedModel" placeholder="选择模型" style="width: 100%" filterable>
                <el-option-group
                  v-if="currentServerModels.length > 0"
                  label="🛰️ 服务端模型列表"
                >
                  <el-option
                    v-for="model in currentServerModels"
                    :key="`srv-${model}`"
                    :label="model"
                    :value="model"
                  />
                </el-option-group>
                <el-option-group label="📌 常用与自定义模型">
                  <el-option
                    v-for="model in localModels"
                    :key="model.id"
                    :label="model.name"
                    :value="model.id"
                  >
                    <div class="model-option">
                      <span class="model-name">{{ model.name }}</span>
                      <span v-if="model.description" class="model-description-inline">{{ model.description }}</span>
                    </div>
                  </el-option>
                </el-option-group>
              </el-select>
              <div class="model-fetch-bar">
                <el-button size="small" :loading="fetchingModels" @click="fetchModels">
                  {{ currentServerModels.length > 0 ? '同步模型列表' : '获取模型列表' }}
                </el-button>
                <span class="form-tip">
                  {{ modelListHint }}
                </span>
              </div>
            </el-form-item>

            <el-form-item label="输出预算">
              <div class="max-tokens-control">
                <el-checkbox v-model="form.unlimitedTokens" @change="handleUnlimitedTokensChange">
                  服务商默认
                </el-checkbox>
                <el-input-number
                  v-if="!form.unlimitedTokens"
                  v-model="form.maxTokens"
                  :min="1"
                  :max="10000000"
                  :step="1000"
                  style="width: 100%"
                />
                <div class="form-tip">单位为 Token；部分推理模型的输出预算包含思考 Token。服务商默认表示由服务商或 SDK 采用默认上限，仍受模型限制。</div>
              </div>
            </el-form-item>

            <el-form-item v-if="showThinkingProtocol" label="思考协议">
              <el-select v-model="form.thinkingProtocol" style="width: 100%">
                <el-option
                  v-for="protocol in thinkingProtocolOptions"
                  :key="protocol.value"
                  :label="protocol.label"
                  :value="protocol.value"
                />
              </el-select>
              <div class="form-tip">{{ thinkingProtocolHint }}</div>
            </el-form-item>

            <el-form-item label="思考设置">
              <div class="thinking-control">
                <el-select v-model="form.thinkingMode" style="width: 100%" @change="onThinkingModeChange">
                  <el-option
                    v-for="mode in thinkingCapability.modes"
                    :key="mode.value"
                    :label="mode.label"
                    :value="mode.value"
                  />
                </el-select>
                <div class="form-tip">{{ thinkingCapability.label }}：{{ thinkingCapability.hint }}</div>
              </div>
            </el-form-item>

            <el-form-item v-if="form.thinkingMode === 'effort'" label="思考强度">
              <el-select v-model="form.thinkingEffort" style="width: 100%">
                <el-option
                  v-for="effort in thinkingCapability.efforts"
                  :key="effort.value"
                  :label="effort.label"
                  :value="effort.value"
                />
              </el-select>
            </el-form-item>

            <el-form-item v-if="form.thinkingMode === 'budget'" label="思考预算">
              <el-input-number
                v-model="form.thinkingBudget"
                :min="thinkingCapability.budgetMin"
                :max="thinkingCapability.budgetMax"
                :step="1024"
                style="width: 100%"
              />
              <div class="form-tip">按 Token 设置思考预算，仅适用于支持此参数的模型。实际消耗与模型有关，部分模型将其作为目标值。</div>
            </el-form-item>

            <el-form-item label="创造性">
              <el-slider
                v-model="form.temperature"
                :min="0"
                :max="1"
                :step="0.1"
                show-input
                :show-input-controls="false"
              />
              <div class="form-tip">{{ formatTemperature(form.temperature) }}</div>
            </el-form-item>

            <!-- 自定义模型管理 -->
            <el-form-item label="自定义模型">
              <div class="custom-models-manager">
                <div class="custom-model-input">
                  <el-input
                    v-model="customModelInput"
                    placeholder="输入模型名称，如 qwen-max"
                    clearable
                    @keyup.enter="addCustomModel"
                  />
                  <el-button type="primary" @click="addCustomModel">添加</el-button>
                </div>
                <div v-if="customModels.length > 0" class="custom-models-list">
                  <el-tag
                    v-for="model in customModels"
                    :key="model.id"
                    closable
                    class="custom-model-tag"
                    @close="removeCustomModel(model.id)"
                  >
                    {{ model.name }}
                  </el-tag>
                </div>
              </div>
            </el-form-item>

            <!-- 代理前缀（CORS 逃生舱） -->
            <el-form-item label="代理前缀">
              <el-input
                v-model="form.proxyUrl"
                clearable
                placeholder="可选，如 https://your-proxy.example.com/"
              />
              <div class="form-tip">填写后，实际请求地址 = 代理前缀 + API 地址（代理需完整转发后续路径）。留空则直连。</div>
            </el-form-item>

            <!-- 自定义请求头（CORS 逃生舱） -->
            <el-form-item label="请求头">
              <div class="custom-headers-manager">
                <div v-for="(row, index) in headerRows" :key="index" class="header-row">
                  <el-input v-model="row.key" placeholder="Header 名称" />
                  <el-input v-model="row.value" placeholder="值" />
                  <el-button type="danger" plain @click="removeHeaderRow(index)">删除</el-button>
                </div>
                <el-button size="small" @click="addHeaderRow">添加请求头</el-button>
                <div class="form-tip">例如直连 Anthropic 需要的浏览器访问声明已由服务商预设自动附加，其余特殊情况可在此补充</div>
              </div>
            </el-form-item>

            <el-form-item>
              <div class="form-actions">
                <el-button type="primary" :loading="validating" @click="saveConfig">
                  保存配置
                </el-button>
                <el-button :loading="validating" @click="testConnection">
                  测试连接
                </el-button>
                <el-button @click="resetForm">重置</el-button>
              </div>
            </el-form-item>
          </el-form>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { reactive, ref, computed, watch, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { useApiConfig } from '@/services/apiConfig'
import { PROVIDER_PRESETS, getPreset, fetchProviderModels, FALLBACK_MODELS } from '@/services/aiProviders'
import { DEFAULT_OUTPUT_TOKENS, THINKING_PROTOCOL_OPTIONS, getThinkingCapability, validateGenerationBudget } from '@/utils/generationBudget'
import apiService from '@/services/api'

const { customModels: storedCustomModels, getProviderModels, activeConfig, isApiConfigured, updateConfig, setCustomModels, setProviderModels, resetConfig } = useApiConfig()

const validating = ref(false)
const fetchingModels = ref(false)
const customModelInput = ref('')
const customModels = storedCustomModels

// 配置表单
const form = reactive({
  provider: 'custom',
  apiKey: '',
  baseURL: 'https://api.openai.com/v1',
  selectedModel: 'gpt-5.4-mini',
  maxTokens: DEFAULT_OUTPUT_TOKENS,
  unlimitedTokens: false,
  thinkingProtocol: 'auto',
  thinkingMode: 'default',
  thinkingBudget: 4096,
  thinkingEffort: 'medium',
  temperature: 0.7,
  customHeaders: {},
  proxyUrl: '',
})

// 自定义请求头行（表单编辑用）
const headerRows = ref([])

const currentPreset = computed(() => getPreset(form.provider))
const baseURLHint = computed(() => currentPreset.value.kind === 'anthropic'
  ? '支持 Anthropic 官方或兼容网关；填写基础地址（如 https://opencode.ai/zen/go/v1），不要附加 /messages。'
  : currentPreset.value.editableBaseURL ? 'OpenAI 兼容格式的服务地址' : '由所选服务商预设，无需修改')
const showThinkingProtocol = computed(() => form.provider !== 'google')
const thinkingProtocolOptions = computed(() => form.provider === 'anthropic'
  ? [THINKING_PROTOCOL_OPTIONS[0], { value: 'anthropic', label: 'Anthropic 兼容思考预算' }]
  : THINKING_PROTOCOL_OPTIONS)
const thinkingProtocolHint = computed(() => form.provider === 'anthropic'
  ? 'Claude 按模型能力识别；非 Claude 模型默认不附加思考参数，确认网关支持后可选择兼容思考预算。'
  : '自动识别模型与服务商；使用自定义模型别名时，可手动选择网关实际支持的协议。')
const thinkingCapability = computed(() => getThinkingCapability(form))

// A mode supported by one model need not be accepted by the next one.
watch(() => [form.provider, form.selectedModel, form.thinkingProtocol], ([provider], [previousProvider]) => {
  form.thinkingMode = 'default'
  if (provider !== previousProvider) form.thinkingProtocol = 'auto'
}, { flush: 'sync' })

const onThinkingModeChange = () => {
  const capability = thinkingCapability.value
  if (form.thinkingMode === 'effort') {
    const efforts = capability.efforts
    form.thinkingEffort = efforts.find(effort => effort.value === 'medium')?.value
      ?? efforts[Math.floor(efforts.length / 2)]?.value
      ?? 'medium'
  } else if (form.thinkingMode === 'budget') {
    const maximum = capability.budgetMax ?? Number.MAX_SAFE_INTEGER
    if (!Number.isSafeInteger(form.thinkingBudget) || form.thinkingBudget < capability.budgetMin || form.thinkingBudget > maximum) {
      form.thinkingBudget = Math.max(capability.budgetMin, Math.min(4096, maximum))
    }
  }
}

const addHeaderRow = () => {
  headerRows.value.push({ key: '', value: '' })
}

const removeHeaderRow = (index) => {
  headerRows.value.splice(index, 1)
}

const collectHeaders = () => {
  const headers = {}
  for (const row of headerRows.value) {
    if (row.key.trim()) {
      headers[row.key.trim()] = row.value
    }
  }
  return headers
}

const snapshotForm = () => ({ ...form, customHeaders: collectHeaders() })
// This identity stays in memory; persisted model-cache keys never contain credentials.
const connectionIdentity = config => JSON.stringify([
  config.provider, config.baseURL, config.apiKey, config.proxyUrl,
  Object.entries(config.customHeaders ?? {}).sort(([left], [right]) => left.localeCompare(right)),
])
let modelRequest = null
let validationRequest = null
let disposed = false
const cancelRequests = () => {
  modelRequest?.controller.abort()
  validationRequest?.controller.abort()
  modelRequest = validationRequest = null
  fetchingModels.value = validating.value = false
}
const beginRequest = (kind, draft) => {
  const request = { controller: new AbortController(), identity: connectionIdentity(draft) }
  if (kind === 'models') {
    modelRequest?.controller.abort()
    modelRequest = request
    fetchingModels.value = true
  } else {
    validationRequest?.controller.abort()
    validationRequest = request
    validating.value = true
  }
  return request
}
const isCurrentRequest = (kind, request) => !disposed && !request.controller.signal.aborted
  && (kind === 'models' ? modelRequest : validationRequest) === request
  && request.identity === connectionIdentity(snapshotForm())
const finishRequest = (kind, request) => {
  if (kind === 'models' && modelRequest === request) {
    modelRequest = null
    fetchingModels.value = false
  } else if (kind === 'validation' && validationRequest === request) {
    validationRequest = null
    validating.value = false
  }
}
watch(() => connectionIdentity(snapshotForm()), cancelRequests, { flush: 'sync' })
onBeforeUnmount(() => {
  disposed = true
  cancelRequests()
})
defineExpose({ cancelRequests })

const syncHeaderRows = (headers) => {
  headerRows.value = Object.entries(headers ?? {}).map(([key, value]) => ({ key, value: String(value) }))
}

// 切换服务商：带入预设地址与默认模型
const onProviderChange = (providerId) => {
  const preset = getPreset(providerId)
  form.thinkingProtocol = 'auto'
  form.thinkingMode = 'default'
  form.baseURL = preset.baseURL
  if (preset.defaultModel) {
    form.selectedModel = preset.defaultModel
  }
}

// 当前服务商从服务端拉取到的模型列表
const currentServerModels = computed(() => getProviderModels(snapshotForm()))

// 本地模型（共享兜底清单 + 用户自定义），剔除与服务端列表重复的项
const localModels = computed(() => {
  const serverSet = new Set(currentServerModels.value)
  const all = [...FALLBACK_MODELS, ...customModels.value]
  const deduped = []
  for (const model of all) {
    if (!deduped.some((m) => m.id === model.id) && !serverSet.has(model.id)) {
      deduped.push(model)
    }
  }
  return deduped
})

// 下拉可选项全集（用于自定义模型去重判断）
const availableModels = computed(() => {
  const all = [...FALLBACK_MODELS, ...customModels.value]
  for (const id of currentServerModels.value) {
    if (!all.some((m) => m.id === id)) {
      all.push({ id, name: id })
    }
  }
  return all
})

const modelListHint = computed(() => {
  if (fetchingModels.value) return '正在获取...'
  if (currentServerModels.value.length > 0) {
    return `已同步 ${currentServerModels.value.length} 个模型（${getPreset(form.provider).label}）`
  }
  return '未同步，可从服务商拉取最新可用模型'
})

// 从服务商拉取可用模型列表
const fetchModels = async () => {
  if (disposed || fetchingModels.value || !validateForm()) return

  const draft = snapshotForm()
  const request = beginRequest('models', draft)
  try {
    const models = await fetchProviderModels(draft, { signal: request.controller.signal })
    if (!isCurrentRequest('models', request)) return
    setProviderModels(draft, models)

    if (models.length === 0) {
      ElMessage.warning('服务商未返回任何模型')
    } else {
      // 当前选择为空或不在线上列表中时，自动切到第一个可用模型
      if (form.selectedModel === draft.selectedModel && !models.includes(form.selectedModel)) {
        form.selectedModel = models[0]
      }
      ElMessage.success(`已同步 ${models.length} 个模型`)
    }
  } catch (error) {
    if (isCurrentRequest('models', request)) ElMessage.error(error.message)
  } finally {
    finishRequest('models', request)
  }
}

const formatTemperature = (value) => {
  if (value <= 0.3) return '保守'
  if (value <= 0.7) return '平衡'
  return '创新'
}

const handleUnlimitedTokensChange = () => {
  // Keep the previous numeric draft while the provider decides the output limit.
  if (!form.unlimitedTokens && form.maxTokens == null) form.maxTokens = DEFAULT_OUTPUT_TOKENS
}

// 从模块状态同步到表单
const loadSavedConfig = () => {
  const saved = activeConfig.value
  form.provider = saved.provider ?? 'custom'
  form.apiKey = saved.apiKey ?? ''
  form.baseURL = saved.baseURL ?? 'https://api.openai.com/v1'
  form.selectedModel = saved.selectedModel ?? 'gpt-5.4-mini'
  form.maxTokens = saved.maxTokens ?? DEFAULT_OUTPUT_TOKENS
  form.unlimitedTokens = Boolean(saved.unlimitedTokens) || saved.maxTokens === null
  form.thinkingProtocol = saved.thinkingProtocol ?? 'auto'
  form.thinkingMode = saved.thinkingMode ?? 'default'
  form.thinkingBudget = saved.thinkingBudget ?? 4096
  form.thinkingEffort = saved.thinkingEffort ?? 'medium'
  form.temperature = saved.temperature ?? 0.7
  form.customHeaders = saved.customHeaders ?? {}
  form.proxyUrl = saved.proxyUrl ?? ''
  syncHeaderRows(saved.customHeaders)
}

// 表单校验
const validateForm = () => {
  if (!form.apiKey?.trim()) {
    ElMessage.warning('请输入API密钥')
    return false
  }
  if (currentPreset.value.editableBaseURL && !form.baseURL?.trim()) {
    ElMessage.warning('请输入API地址')
    return false
  }
  return true
}

const saveConfig = async () => {
  if (disposed || validating.value || !validateForm()) return

  const draft = snapshotForm()
  const budgetError = validateGenerationBudget(draft)
  if (budgetError) {
    ElMessage.warning(budgetError)
    return
  }
  try {
    updateConfig(draft)
  } catch (error) {
    ElMessage.error('配置保存失败：' + error.message)
    return
  }
  ElMessage.success('配置保存成功')
  const request = beginRequest('validation', draft)
  try {
    const isValid = await apiService.validateAPIKey(draft, { signal: request.controller.signal })
    if (isCurrentRequest('validation', request) && !isValid) {
      ElMessage.warning('配置已保存，但连接测试未通过，请检查密钥与地址')
    }
  } catch (error) {
    if (isCurrentRequest('validation', request)) ElMessage.warning('配置已保存，但连接测试未通过：' + error.message)
  } finally {
    finishRequest('validation', request)
  }
}

const testConnection = async () => {
  if (disposed || validating.value || !validateForm()) return

  const draft = snapshotForm()
  const request = beginRequest('validation', draft)
  try {
    const isValid = await apiService.validateAPIKey(draft, { signal: request.controller.signal })
    if (!isCurrentRequest('validation', request)) return

    if (isValid) {
      ElMessage.success('连接测试成功')
    } else {
      ElMessage.error('连接测试失败')
    }
  } catch (error) {
    if (isCurrentRequest('validation', request)) ElMessage.error('连接测试失败：' + error.message)
  } finally {
    finishRequest('validation', request)
  }
}

const resetForm = () => {
  cancelRequests()
  try {
    resetConfig()
    loadSavedConfig()
    ElMessage.success('配置已重置')
  } catch (error) {
    ElMessage.error('重置失败，配置已保留：' + error.message)
  }
}

// 自定义模型管理
const addCustomModel = () => {
  const modelName = customModelInput.value.trim()
  if (!modelName) return

  if (availableModels.value.some((model) => model.id === modelName)) {
    ElMessage.warning('该模型已存在')
    return
  }

  try {
    setCustomModels([...customModels.value, {
      id: modelName,
      name: modelName,
      description: '自定义模型'
    }])
    customModelInput.value = ''
    ElMessage.success('自定义模型添加成功')
  } catch (error) {
    ElMessage.error('添加失败，输入已保留：' + error.message)
  }
}

const removeCustomModel = (modelId) => {
  if (!customModels.value.some((model) => model.id === modelId)) return
  try {
    setCustomModels(customModels.value.filter((model) => model.id !== modelId))
    if (form.selectedModel === modelId) {
      form.selectedModel = 'gpt-5.4-mini'
    }

    ElMessage.success('自定义模型删除成功')
  } catch (error) {
    ElMessage.error('删除失败，模型已保留：' + error.message)
  }
}

loadSavedConfig()
</script>

<style scoped>
.api-config {
  padding: 20px;
  max-width: 100%;
}

.config-card {
  max-width: 1600px;
  margin: 0 auto;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.config-main-content {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}

.config-tips-panel {
  flex: 0 0 280px;
}

.config-form-panel {
  flex: 1;
  min-width: 0;
}

.config-tips {
  background: var(--el-fill-color-light);
  border-radius: 8px;
  padding: 16px;
}

.config-tips h4 {
  margin: 0 0 12px;
  font-size: 16px;
}

.tips-content h5 {
  margin: 12px 0 6px;
  font-size: 13px;
}

.tips-content p,
.tips-content li {
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 1.7;
}

.tips-content ul,
.tips-content ol {
  margin: 0;
  padding-left: 18px;
}

.tips-note {
  margin-top: 12px;
}

.form-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
  margin-top: 4px;
}

.model-fetch-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  width: 100%;
}

.max-tokens-control {
  width: 100%;
}

.thinking-control {
  width: 100%;
}

.custom-models-manager {
  width: 100%;
}

.custom-model-input {
  display: flex;
  gap: 8px;
}

.custom-models-list {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.custom-headers-manager {
  width: 100%;
}

.header-row {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}

.model-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.model-description-inline {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-left: 12px;
}

.form-actions {
  display: flex;
  gap: 8px;
  width: 100%;
}

@media (max-width: 900px) {
  .config-main-content {
    flex-direction: column;
  }
  .config-tips-panel {
    flex: none;
    width: 100%;
  }
}
</style>
