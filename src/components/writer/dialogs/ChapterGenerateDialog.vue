<template>
  <el-dialog
    v-model="visible"
    title="AI生成章节内容"
    width="1200px"
    @close="visible = false"
  >
    <div class="chapter-generate-content">
      <div class="generate-config-section">
        <el-card shadow="hover" class="config-card-modern">
          <template #header>
            <div class="config-header">
              <div class="config-left">
                <span class="config-title">生成配置</span>
                <el-tag type="info" size="small">{{ chapter?.title || '未选择章节' }}</el-tag>
              </div>
              <el-button
                type="primary"
                :loading="generating"
                :disabled="!selectedPrompt"
                size="small"
                @click="emit('generate')"
              >
                <el-icon><MagicStick /></el-icon>
                {{ generating ? '生成中' : '生成' }}
              </el-button>
            </div>
          </template>

          <el-row :gutter="16">
            <el-col :span="8">
              <el-form-item label="目标字数" class="config-item">
                <el-input-number
                  v-model="config.wordCount"
                  :min="500"
                  :max="5000"
                  size="small"
                  controls-position="right"
                />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="写作视角" class="config-item">
                <el-select v-model="config.style" size="small" style="width: 100%">
                  <el-option label="第一人称" value="first-person" />
                  <el-option label="第三人称" value="third-person" />
                  <el-option label="全知视角" value="omniscient" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="重点内容" class="config-item">
                <el-input
                  v-model="config.focus"
                  placeholder="本章重点内容..."
                  size="small"
                />
              </el-form-item>
            </el-col>
          </el-row>
        </el-card>
      </div>

      <el-row :gutter="20" style="margin-top: 16px">
        <el-col :span="14">
          <div class="materials-section">
            <div class="section-header">
              <h4 class="section-title">📚 创作素材</h4>
              <el-button size="small" @click="emit('clear-materials')">清空选择</el-button>
            </div>

            <el-tabs v-model="activeMaterialTab" class="materials-tabs">
              <el-tab-pane label="👥 人物角色" name="characters">
                <div class="tab-header">
                  <span class="tab-count">
                    已选择 {{ selectedMaterials.characters.length }}/{{ characters.length }}
                  </span>
                  <el-button
                    v-if="characters.length > 0"
                    size="small"
                    @click="emit('select-all-materials', 'characters')"
                  >
                    全选
                  </el-button>
                </div>
                <div class="materials-grid">
                  <div
                    v-for="character in characters"
                    :key="character.id"
                    class="material-card"
                    :class="{
                      selected: selectedMaterials.characters.some((item) => item.id === character.id),
                    }"
                    @click="emit('toggle-material', 'characters', character)"
                  >
                    <div class="material-header">
                      <span class="material-name">{{ character.name }}</span>
                      <el-tag :type="getRoleType(character.role)" size="small">
                        {{ getRoleText(character.role) }}
                      </el-tag>
                    </div>
                    <p class="material-desc">
                      {{ character.personality?.substring(0, 40) || '暂无描述' }}...
                    </p>
                    <div class="material-tags">
                      <el-tag
                        v-for="tag in character.tags?.slice(0, 2)"
                        :key="tag"
                        size="small"
                      >
                        {{ tag }}
                      </el-tag>
                    </div>
                  </div>
                </div>
                <div v-if="characters.length === 0" class="empty-materials">
                  <p>暂无人物角色</p>
                  <el-button size="small" @click="emit('create-character')">创建角色</el-button>
                </div>
              </el-tab-pane>

              <el-tab-pane label="🌍 世界观" name="worldSettings">
                <div class="tab-header">
                  <span class="tab-count">
                    已选择 {{ selectedMaterials.worldSettings.length }}/{{ worldSettings.length }}
                  </span>
                  <el-button
                    v-if="worldSettings.length > 0"
                    size="small"
                    @click="emit('select-all-materials', 'worldSettings')"
                  >
                    全选
                  </el-button>
                </div>
                <div class="materials-grid">
                  <div
                    v-for="setting in worldSettings"
                    :key="setting.id"
                    class="material-card"
                    :class="{
                      selected: selectedMaterials.worldSettings.some((item) => item.id === setting.id),
                    }"
                    @click="emit('toggle-material', 'worldSettings', setting)"
                  >
                    <div class="material-header">
                      <span class="material-name">{{ setting.title }}</span>
                      <el-tag v-if="setting.category" size="small">{{ setting.category }}</el-tag>
                    </div>
                    <p class="material-desc">
                      {{ setting.description?.substring(0, 50) || '暂无描述' }}...
                    </p>
                  </div>
                </div>
                <div v-if="worldSettings.length === 0" class="empty-materials">
                  <p>暂无世界观设定</p>
                  <el-button size="small" @click="emit('create-world-setting')">
                    创建设定
                  </el-button>
                </div>
              </el-tab-pane>

              <el-tab-pane label="📝 语料库" name="corpus">
                <div class="tab-header">
                  <span class="tab-count">
                    已选择 {{ selectedMaterials.corpus.length }}/{{ corpus.length }}
                  </span>
                  <div>
                    <el-button
                      size="small"
                      type="primary"
                      plain
                      :disabled="corpus.length === 0"
                      @click="emit('recommend-corpus')"
                    >
                      🛰️ 按上下文推荐
                    </el-button>
                    <el-button
                      v-if="corpus.length > 0"
                      size="small"
                      @click="emit('select-all-materials', 'corpus')"
                    >
                      全选
                    </el-button>
                  </div>
                </div>
                <div class="materials-grid">
                  <div
                    v-for="corpusItem in corpus"
                    :key="corpusItem.id"
                    class="material-card"
                    :class="{
                      selected: selectedMaterials.corpus.some((item) => item.id === corpusItem.id),
                    }"
                    @click="emit('toggle-material', 'corpus', corpusItem)"
                  >
                    <div class="material-header">
                      <span class="material-name">{{ corpusItem.title }}</span>
                    </div>
                    <p class="material-desc">
                      {{ corpusItem.content?.substring(0, 40) || '暂无内容' }}...
                    </p>
                  </div>
                </div>
                <div v-if="corpus.length === 0" class="empty-materials">
                  <p>暂无语料库</p>
                  <el-button size="small" @click="emit('create-corpus')">创建语料</el-button>
                </div>
              </el-tab-pane>

              <el-tab-pane label="📅 事件线" name="events">
                <div class="tab-header">
                  <span class="tab-count">
                    已选择 {{ selectedMaterials.events.length }}/{{ events.length }}
                  </span>
                  <el-button
                    v-if="events.length > 0"
                    size="small"
                    @click="emit('select-all-materials', 'events')"
                  >
                    全选
                  </el-button>
                </div>
                <div class="materials-grid">
                  <div
                    v-for="event in events"
                    :key="event.id"
                    class="material-card"
                    :class="{
                      selected: selectedMaterials.events.some((item) => item.id === event.id),
                    }"
                    @click="emit('toggle-material', 'events', event)"
                  >
                    <div class="material-header">
                      <span class="material-name">{{ event.title }}</span>
                      <el-tag :type="getImportanceType(event.importance)" size="small">
                        第{{ event.chapter }}章
                      </el-tag>
                    </div>
                    <p class="material-desc">
                      {{ event.description?.substring(0, 40) || '暂无描述' }}...
                    </p>
                    <div class="material-meta">
                      <span class="event-time">{{ event.time || '时间未定' }}</span>
                    </div>
                  </div>
                </div>
                <div v-if="events.length === 0" class="empty-materials">
                  <p>暂无事件线</p>
                  <el-button size="small" @click="emit('create-event')">创建事件</el-button>
                </div>
              </el-tab-pane>

              <el-tab-pane label="📖 上下文内容" name="chapters">
                <div class="tab-header">
                  <span class="tab-count">
                    已选择 {{ contextChapterIds.length }}/{{ contextChapters.length }}
                  </span>
                  <div class="context-tab-actions">
                    <el-button
                      v-if="contextChapters.length > 0"
                      size="small"
                      @click="emit('select-all-context')"
                    >
                      全选
                    </el-button>
                  </div>
                </div>
                <div class="materials-list">
                  <div
                    v-for="contextChapter in contextChapters"
                    :key="contextChapter.id"
                    class="chapter-material-card"
                    :class="{ selected: contextChapterIds.includes(contextChapter.id) }"
                    @click="emit('toggle-context-chapter', contextChapter.id)"
                  >
                    <div class="chapter-material-header">
                      <span class="chapter-material-name">
                        第{{ contextChapter.chapterIndex }}章 {{ contextChapter.title }}
                      </span>
                      <div class="chapter-material-tags">
                        <el-tag
                          :type="getChapterStatusType(contextChapter.status)"
                          size="small"
                        >
                          {{ getChapterStatusText(contextChapter.status) }}
                        </el-tag>
                        <el-tag size="small" type="info">{{ contextChapter.wordCount }}字</el-tag>
                      </div>
                    </div>
                    <p class="chapter-material-desc">
                      {{ contextChapter.description || '暂无大纲' }}
                    </p>
                    <div v-if="contextChapter.content" class="chapter-material-content">
                      <span class="content-preview">
                        {{ cleanHtmlForPreview(contextChapter.content, 80) }}...
                      </span>
                    </div>
                  </div>
                </div>
                <div v-if="contextChapters.length === 0" class="empty-materials">
                  <p>暂无可选择的章节</p>
                  <el-button size="small" @click="emit('create-chapter')">创建章节</el-button>
                </div>
              </el-tab-pane>
            </el-tabs>
          </div>
        </el-col>

        <el-col :span="10">
          <div class="prompt-section">
            <div class="section-header">
              <h4 class="section-title">📝 提示词模板</h4>
              <el-button size="small" @click="emit('use-default-prompt')">使用默认</el-button>
            </div>

            <div class="category-selection-modern">
              <div class="category-header">
                <span>🏷️ 正文类型</span>
              </div>
              <div class="category-grid">
                <div
                  v-for="category in contentCategories"
                  :key="category.key"
                  class="category-card"
                  :class="{ active: contentCategory === category.key }"
                  @click="contentCategory = category.key"
                >
                  <span class="category-icon">{{ category.icon }}</span>
                  <span class="category-name">{{ category.name }}</span>
                </div>
              </div>
            </div>

            <div class="prompt-selection-modern">
              <div class="prompt-header">
                <span>可用模板 ({{ filteredPrompts.length }})</span>
                <el-button size="small" @click="emit('refresh-prompts')">刷新</el-button>
              </div>
              <div class="prompt-list-modern">
                <div
                  v-for="prompt in filteredPrompts"
                  :key="prompt.id"
                  class="prompt-item-modern"
                  :class="{ active: selectedPrompt?.id === prompt.id }"
                  @click="emit('select-prompt', prompt)"
                >
                  <div class="prompt-content">
                    <h5 class="prompt-title">{{ prompt.title }}</h5>
                    <p class="prompt-desc">{{ prompt.description }}</p>
                    <div class="prompt-meta">
                      <div class="prompt-tags">
                        <el-tag
                          v-for="tag in prompt.tags?.slice(0, 2)"
                          :key="tag"
                          size="small"
                        >
                          {{ tag }}
                        </el-tag>
                      </div>
                    </div>
                  </div>
                  <div class="prompt-actions">
                    <el-icon v-if="selectedPrompt?.id === prompt.id" class="selected-icon">
                      <Check />
                    </el-icon>
                  </div>
                </div>
              </div>
              <div v-if="filteredPrompts.length === 0" class="empty-prompts">
                <p>暂无该类型的提示词模板</p>
                <el-button size="small" @click="emit('create-prompt')">创建模板</el-button>
              </div>
            </div>

            <div
              v-if="selectedPrompt && Object.keys(promptVariables).length > 0"
              class="variables-section"
            >
              <div class="variables-header">
                <span>📋 变量配置</span>
                <el-button size="small" @click="emit('auto-fill-variables')">
                  智能填充
                </el-button>
              </div>
              <div class="variables-form">
                <div
                  v-for="(_value, variable) in promptVariables"
                  :key="variable"
                  class="variable-item"
                >
                  <label class="variable-label">{{ variable }}</label>

                  <div v-if="variable === '前文概要'" class="context-variable-container">
                    <el-select
                      v-model="contextChapterIds"
                      multiple
                      placeholder="选择章节作为前文参考"
                      size="small"
                      style="width: 100%"
                      :max-collapse-tags="3"
                    >
                      <el-option
                        v-for="contextChapter in contextChapters"
                        :key="contextChapter.id"
                        :label="`第${contextChapter.chapterIndex}章 ${contextChapter.title} (${contextChapter.wordCount}字)`"
                        :value="contextChapter.id"
                      >
                        <div class="context-chapter-option">
                          <span class="chapter-title">
                            第{{ contextChapter.chapterIndex }}章 {{ contextChapter.title }}
                          </span>
                          <div class="chapter-meta">
                            <el-tag
                              :type="getChapterStatusType(contextChapter.status)"
                              size="small"
                            >
                              {{ getChapterStatusText(contextChapter.status) }}
                            </el-tag>
                            <span class="word-count">{{ contextChapter.wordCount }}字</span>
                          </div>
                        </div>
                      </el-option>
                    </el-select>
                    <div class="context-actions">
                      <el-button
                        v-if="contextChapterIds.length > 0"
                        size="small"
                        @click="emit('clear-context')"
                      >
                        清空
                      </el-button>
                    </div>
                  </div>

                  <el-input
                    v-else
                    v-model="promptVariables[variable]"
                    :type="isMultilineVariable(variable) ? 'textarea' : 'text'"
                    :rows="2"
                    :placeholder="'请输入' + variable"
                    size="small"
                  />
                </div>
              </div>
            </div>

            <div v-if="selectedPrompt" class="preview-section">
              <div class="preview-header">
                <span>👀 最终提示词</span>
                <div class="preview-actions">
                  <el-button size="small" @click="emit('copy-prompt')">复制</el-button>
                </div>
              </div>
              <div class="preview-content">
                <el-input
                  :model-value="finalPrompt"
                  type="textarea"
                  :rows="8"
                  readonly
                  placeholder="请选择提示词并填充变量"
                  class="preview-textarea"
                />
              </div>
            </div>
          </div>
        </el-col>
      </el-row>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <div class="action-buttons">
          <el-button @click="visible = false">取消</el-button>
          <el-button
            type="primary"
            :loading="generating"
            :disabled="!selectedPrompt"
            @click="emit('generate')"
          >
            <el-icon><MagicStick /></el-icon>
            {{ generating ? '生成中...' : '开始生成' }}
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, MagicStick } from '@element-plus/icons-vue'
import type {
  PromptTemplate,
  WriterChapter,
  WriterChapterGenerationConfig,
  WriterChapterStatus,
  WriterCharacter,
  WriterCharacterRole,
  WriterCorpusItem,
  WriterEvent,
  WriterEventImportance,
  WriterPromptVariables,
  WriterSelectedMaterials,
  WriterWorldSetting,
} from '@/types/writer'

type TagType = 'primary' | 'success' | 'warning' | 'info' | 'danger'
type MaterialType = 'characters' | 'worldSettings' | 'corpus' | 'events'
type Material = WriterCharacter | WriterWorldSetting | WriterCorpusItem | WriterEvent
type ContextChapter = WriterChapter & {
  chapterIndex: number
  wordCount: number
}

const props = defineProps<{
  chapter: WriterChapter | null
  selectedPrompt: PromptTemplate | null
  finalPrompt: string
  selectedMaterials: Readonly<WriterSelectedMaterials>
  characters: readonly WriterCharacter[]
  worldSettings: readonly WriterWorldSetting[]
  corpus: readonly WriterCorpusItem[]
  events: readonly WriterEvent[]
  contextChapters: readonly ContextChapter[]
  prompts: readonly PromptTemplate[]
  generating: boolean
}>()

const visible = defineModel<boolean>({ required: true })
const config = defineModel<WriterChapterGenerationConfig>('config', { required: true })
const contentCategory = defineModel<string>('contentCategory', { required: true })
const promptVariables = defineModel<WriterPromptVariables>('promptVariables', { required: true })
const contextChapterIds = defineModel<number[]>('contextChapterIds', { required: true })

const emit = defineEmits<{
  generate: []
  'clear-materials': []
  'select-all-materials': [type: MaterialType]
  'toggle-material': [type: MaterialType, material: Material]
  'recommend-corpus': []
  'create-character': []
  'create-world-setting': []
  'create-corpus': []
  'create-event': []
  'create-chapter': []
  'toggle-context-chapter': [chapterId: number]
  'select-all-context': []
  'clear-context': []
  'select-prompt': [prompt: PromptTemplate]
  'use-default-prompt': []
  'refresh-prompts': []
  'auto-fill-variables': []
  'copy-prompt': []
  'create-prompt': []
}>()

const activeMaterialTab = ref('characters')

const contentCategories = [
  { key: 'content', name: '基础正文', icon: '📝' },
  { key: 'content-dialogue', name: '对话生成', icon: '💬' },
  { key: 'content-scene', name: '场景描写', icon: '🏞️' },
  { key: 'content-action', name: '动作情节', icon: '⚡' },
  { key: 'content-psychology', name: '心理描写', icon: '🧠' },
] as const

const filteredPrompts = computed(() =>
  props.prompts.filter((prompt) => prompt.category === contentCategory.value),
)

const roleTypes: Record<string, TagType> = {
  protagonist: 'danger',
  supporting: 'primary',
  antagonist: 'warning',
  minor: 'info',
}

const roleTexts: Record<string, string> = {
  protagonist: '主角',
  supporting: '配角',
  antagonist: '反派',
  minor: '次要角色',
}

const importanceTypes: Record<string, TagType> = {
  high: 'danger',
  normal: 'primary',
  low: 'info',
}

const chapterStatusTypes: Record<string, TagType> = {
  draft: 'warning',
  completed: 'success',
  published: 'primary',
}

const chapterStatusTexts: Record<string, string> = {
  draft: '草稿',
  completed: '完成',
  published: '发表',
}

const multilineVariables = new Set(['章节大纲', '主要人物', '世界观设定', '参考语料'])

const getRoleType = (role?: WriterCharacterRole): TagType => roleTypes[role ?? ''] ?? 'info'
const getRoleText = (role?: WriterCharacterRole): string => roleTexts[role ?? ''] ?? '配角'
const getImportanceType = (importance?: WriterEventImportance): TagType =>
  importanceTypes[importance ?? ''] ?? 'primary'
const getChapterStatusType = (status?: WriterChapterStatus): TagType =>
  chapterStatusTypes[status ?? ''] ?? 'warning'
const getChapterStatusText = (status?: WriterChapterStatus): string =>
  chapterStatusTexts[status ?? ''] ?? '草稿'
const isMultilineVariable = (variable: string): boolean => multilineVariables.has(variable)

const cleanHtmlForPreview = (htmlContent: string, maxLength = 80): string => {
  if (!htmlContent) return ''

  let cleanText = htmlContent.replace(/<[^>]*>/g, '')
  cleanText = cleanText
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  cleanText = cleanText.replace(/\s+/g, ' ').trim()

  return cleanText.length > maxLength ? cleanText.substring(0, maxLength) : cleanText
}
</script>

<style scoped>
.chapter-generate-content {
  max-height: 70vh;
  padding: 0;
  overflow: hidden;
}

.generate-config-section {
  margin-bottom: 16px;
}

.config-card-modern {
  overflow: hidden;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
}

.config-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.config-left {
  display: flex;
  gap: 12px;
  align-items: center;
}

.config-title {
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.config-item {
  margin-bottom: 0;
}

.config-item .el-form-item__label {
  font-size: 12px;
  font-weight: 500;
  color: var(--el-text-color-regular);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.materials-section,
.prompt-section {
  height: 500px;
  overflow-y: auto;
}

.materials-section h4,
.prompt-section h4 {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.materials-tabs {
  overflow: hidden;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
}

.materials-tabs .el-tabs__header {
  margin: 0;
  background-color: var(--el-fill-color-light);
}

.materials-tabs .el-tabs__nav-wrap::after {
  display: none;
}

.tab-header {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: space-between;
  min-height: 48px;
  padding: 12px 16px;
  background-color: #fafbfc;
  border-bottom: 1px solid var(--el-border-color-light);
}

.tab-count {
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.materials-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  max-height: 300px;
  padding: 16px;
  overflow-y: auto;
}

.material-card {
  position: relative;
  padding: 12px;
  cursor: pointer;
  background-color: var(--el-bg-color);
  border: 2px solid var(--el-border-color-light);
  border-radius: 6px;
  transition: all 0.2s;
}

.material-card:hover {
  background-color: var(--brand-50);
  border-color: var(--brand-500);
  box-shadow: 0 2px 8px rgba(64, 158, 255, 0.1);
  transform: translateY(-1px);
}

.material-card.selected {
  background-color: #ecf5ff;
  border-color: var(--brand-500);
  box-shadow: 0 0 0 1px var(--brand-500);
}

.material-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 8px;
}

.material-name {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--el-text-color-primary);
}

.material-desc {
  display: -webkit-box;
  margin: 0 0 8px;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.4;
  color: var(--el-text-color-regular);
  text-overflow: ellipsis;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.material-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.event-time {
  margin-left: 8px;
  color: #c0c4cc;
}

.empty-materials,
.empty-prompts {
  padding: 40px 20px;
  color: var(--el-text-color-secondary);
  text-align: center;
}

.category-selection-modern {
  margin-bottom: 16px;
}

.category-header {
  margin-bottom: 12px;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.category-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}

.category-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 8px;
  cursor: pointer;
  background-color: var(--el-bg-color);
  border: 2px solid var(--el-border-color-light);
  border-radius: 6px;
  transition: all 0.2s;
}

.category-card:hover {
  background-color: var(--brand-50);
  border-color: var(--brand-500);
}

.category-card.active {
  color: var(--brand-500);
  background-color: #ecf5ff;
  border-color: var(--brand-500);
}

.category-icon {
  margin-bottom: 4px;
  font-size: 16px;
}

.category-name {
  font-size: 11px;
  font-weight: 500;
  line-height: 1.2;
  color: var(--el-text-color-regular);
  text-align: center;
}

.prompt-selection-modern {
  overflow: hidden;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
}

.prompt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  background-color: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-light);
}

.prompt-list-modern {
  max-height: 250px;
  padding: 8px;
  overflow-y: auto;
}

.prompt-item-modern {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  margin-bottom: 8px;
  cursor: pointer;
  background-color: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  transition: all 0.2s;
}

.prompt-item-modern:hover {
  background-color: var(--brand-50);
  border-color: var(--brand-500);
}

.prompt-item-modern.active {
  background-color: #ecf5ff;
  border-color: var(--brand-500);
}

.prompt-content {
  flex: 1;
}

.prompt-title {
  margin: 0 0 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.prompt-desc {
  margin: 0 0 8px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--el-text-color-regular);
}

.prompt-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.prompt-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.prompt-tags .el-tag {
  height: 18px;
  font-size: 10px;
  line-height: 16px;
}

.prompt-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
}

.selected-icon {
  font-size: 18px;
  color: var(--brand-500);
}

.variables-section {
  margin-top: 16px;
  overflow: hidden;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
}

.variables-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  background-color: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-light);
}

.variables-form {
  padding: 16px;
}

.variable-item {
  margin-bottom: 16px;
}

.variable-label {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--el-text-color-regular);
}

.context-variable-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.context-actions,
.context-tab-actions,
.preview-actions {
  display: flex;
  gap: 8px;
}

.context-actions {
  justify-content: flex-end;
}

.context-chapter-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}

.context-chapter-option .chapter-title {
  flex: 1;
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  color: var(--el-text-color-primary);
}

.context-chapter-option .chapter-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.context-chapter-option .word-count {
  font-size: 11px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
}

.preview-section {
  margin-top: 16px;
  overflow: hidden;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  background-color: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-light);
}

.preview-content {
  padding: 16px;
  line-height: 1.8;
  color: var(--el-text-color-primary);
}

.preview-textarea {
  font-family: Monaco, Menlo, 'Ubuntu Mono', monospace;
  font-size: 12px;
  line-height: 1.5;
}

.dialog-footer,
.action-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.materials-list {
  max-height: 400px;
  overflow-y: auto;
}

.chapter-material-card {
  position: relative;
  min-height: 80px;
  padding: 14px;
  margin-bottom: 10px;
  cursor: pointer;
  background: #fafbfc;
  border: 1px solid #e1e8ed;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.chapter-material-card:hover {
  border-color: var(--brand-500);
  box-shadow: 0 2px 8px rgba(64, 158, 255, 0.1);
}

.chapter-material-card.selected {
  background-color: #e6f4ff;
  border-color: var(--brand-500);
}

.chapter-material-header {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  justify-content: space-between;
  min-height: 32px;
  margin-bottom: 8px;
}

.chapter-material-name {
  flex: 1;
  min-width: 0;
  margin-right: 8px;
  overflow-wrap: break-word;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.4;
  color: var(--el-text-color-primary);
  word-wrap: break-word;
}

.chapter-material-tags {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 4px;
  align-items: flex-start;
}

.chapter-material-desc {
  margin: 4px 0;
  overflow-wrap: break-word;
  font-size: 12px;
  line-height: 1.4;
  color: #666;
  word-wrap: break-word;
}

.chapter-material-content {
  padding-top: 8px;
  margin-top: 8px;
  border-top: 1px solid #eee;
}

.content-preview {
  display: block;
  max-height: 120px;
  padding: 12px;
  margin-top: 4px;
  overflow-y: auto;
  overflow-wrap: break-word;
  font-size: 11px;
  font-style: italic;
  line-height: 1.3;
  color: #999;
  word-wrap: break-word;
  background-color: var(--el-fill-color-light);
  border-radius: 6px;
}
</style>
