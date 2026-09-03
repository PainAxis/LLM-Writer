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
              <p>支持所有 <strong>OpenAI 兼容格式</strong> 的 API 接口。</p>

              <div class="params-info">
                <h5>参数说明：</h5>
                <ul>
                  <li><strong>API地址</strong> - 您的 API 服务地址</li>
                  <li><strong>API密钥</strong> - 身份验证密钥</li>
                  <li><strong>模型选择</strong> - 如果没有想要的模型，支持自定义模型</li>
                  <li><strong>Token限制</strong> - 控制生成长度</li>
                  <li><strong>创造性</strong> - 0保守，1创新</li>
                </ul>
              </div>

              <div class="supported-apis">
                <h5>特殊说明：</h5>
                <ul>
                  <li>openai格式api是大模型通用格式，支持所有大模型</li>
                  <li>支持本地部署大模型，如ollama、llmstudio等，自行学习怎么获取openai格式api</li>
                </ul>
              </div>

              <div class="tips-note">
                <p>💡 建议先测试连接再保存配置</p>
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
              <div class="form-tip">非 OpenAI 兼容的服务商由 AI SDK 原生适配，其余走 OpenAI 兼容层</div>
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
                placeholder="例如：https://api.openai.com/v1"
                :disabled="!currentPreset.editableBaseURL"
                clearable
              />
              <div class="form-tip">{{ currentPreset.editableBaseURL ? 'OpenAI 兼容格式的服务地址' : '由所选服务商预设，无需修改' }}</div>
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

            <el-form-item label="最大Token">
              <div class="max-tokens-control">
                <el-checkbox v-model="form.unlimitedTokens" @change="handleUnlimitedTokensChange">
                  无限制Token
                </el-checkbox>
                <el-input-number
                  v-if="!form.unlimitedTokens"
                  v-model="form.maxTokens"
                  :min="1"
                  :max="10000000"
                  :step="1000"
                  style="width: 100%"
                />
              </div>
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
import { reactive, ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useApiConfig } from '@/services/apiConfig'
import { PROVIDER_PRESETS, getPreset, fetchProviderModels, FALLBACK_MODELS } from '@/services/aiProviders'
import apiService from '@/services/api'

const { customModels: storedCustomModels, providerModels, activeConfig, isApiConfigured, updateConfig, setCustomModels, setProviderModels, resetConfig } = useApiConfig()

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
  maxTokens: 2000000,
  unlimitedTokens: false,
  temperature: 0.7,
  customHeaders: {},
  proxyUrl: '',
})

// 自定义请求头行（表单编辑用）
const headerRows = ref([])

const currentPreset = computed(() => getPreset(form.provider))

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

const syncHeaderRows = (headers) => {
  headerRows.value = Object.entries(headers ?? {}).map(([key, value]) => ({ key, value: String(value) }))
}

// 切换服务商：带入预设地址与默认模型
const onProviderChange = (providerId) => {
  const preset = getPreset(providerId)
  form.baseURL = preset.baseURL
  if (preset.defaultModel) {
    form.selectedModel = preset.defaultModel
  }
}

// 当前服务商从服务端拉取到的模型列表
const currentServerModels = computed(() => providerModels.value[form.provider] ?? [])

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
  if (!form.apiKey?.trim()) {
    ElMessage.warning('请先填写API密钥')
    return
  }

  fetchingModels.value = true
  try {
    form.customHeaders = collectHeaders()
    updateConfig({ provider: form.provider, apiKey: form.apiKey, baseURL: form.baseURL, customHeaders: form.customHeaders })
    const models = await fetchProviderModels(activeConfig.value)

    setProviderModels(form.provider, models)

    if (models.length === 0) {
      ElMessage.warning('服务商未返回任何模型')
    } else {
      // 当前选择为空或不在线上列表中时，自动切到第一个可用模型
      if (!models.includes(form.selectedModel)) {
        form.selectedModel = models[0]
        updateConfig({ selectedModel: form.selectedModel })
      }
      ElMessage.success(`已同步 ${models.length} 个模型`)
    }
  } catch (error) {
    ElMessage.error(error.message)
  } finally {
    fetchingModels.value = false
  }
}

const formatTemperature = (value) => {
  if (value <= 0.3) return '保守'
  if (value <= 0.7) return '平衡'
  return '创新'
}

const handleUnlimitedTokensChange = () => {
  form.maxTokens = form.unlimitedTokens ? null : 2000000
}

// 从模块状态同步到表单
const loadSavedConfig = () => {
  const saved = activeConfig.value
  form.provider = saved.provider ?? 'custom'
  form.apiKey = saved.apiKey ?? ''
  form.baseURL = saved.baseURL ?? 'https://api.openai.com/v1'
  form.selectedModel = saved.selectedModel ?? 'gpt-5.4-mini'
  form.maxTokens = saved.maxTokens ?? null
  form.unlimitedTokens = Boolean(saved.unlimitedTokens)
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
  if (!validateForm()) return

  validating.value = true
  try {
    form.customHeaders = collectHeaders()
    updateConfig({ ...form })
    const isValid = await apiService.validateAPIKey()

    if (isValid) {
      ElMessage.success('配置保存成功')
    } else {
      ElMessage.warning('配置已保存，但连接测试未通过，请检查密钥与地址')
    }
  } catch (error) {
    ElMessage.error('配置保存失败：' + error.message)
  } finally {
    validating.value = false
  }
}

const testConnection = async () => {
  if (!form.apiKey?.trim()) {
    ElMessage.warning('请先填写API密钥')
    return
  }

  validating.value = true
  try {
    form.customHeaders = collectHeaders()
    updateConfig({ ...form })
    const isValid = await apiService.validateAPIKey()

    if (isValid) {
      ElMessage.success('连接测试成功')
    } else {
      ElMessage.error('连接测试失败')
    }
  } catch (error) {
    ElMessage.error('连接测试失败：' + error.message)
  } finally {
    validating.value = false
  }
}

const resetForm = () => {
  resetConfig()
  loadSavedConfig()
  ElMessage.success('配置已重置')
}

// 自定义模型管理
const addCustomModel = () => {
  const modelName = customModelInput.value.trim()
  if (!modelName) return

  if (availableModels.value.some((model) => model.id === modelName)) {
    ElMessage.warning('该模型已存在')
    return
  }

  customModels.value.push({
    id: modelName,
    name: modelName,
    description: '自定义模型'
  })

  customModelInput.value = ''
  ElMessage.success('自定义模型添加成功')
  setCustomModels([...customModels.value])
}

const removeCustomModel = (modelId) => {
  const index = customModels.value.findIndex((model) => model.id === modelId)
  if (index > -1) {
    customModels.value.splice(index, 1)

    if (form.selectedModel === modelId) {
      form.selectedModel = 'gpt-5.4-mini'
    }

    ElMessage.success('自定义模型删除成功')
    setCustomModels([...customModels.value])
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
