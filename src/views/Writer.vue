<template>
  <div class="writer-container">
    <!-- 顶部标题栏 -->
    <div class="title-bar">
      <div class="title-left">
        <el-button @click="goBack" size="small">
          <el-icon><ArrowLeft /></el-icon>
          返回列表
        </el-button>
        <span class="novel-title">{{ currentNovel?.title || '小说编辑' }}</span>
      </div>
    </div>

    <!-- 标签栏 -->
    <div class="tabs-bar">
      <el-tabs v-model="activeTab" class="main-tabs">
        <el-tab-pane label="📝 编辑" name="editor"></el-tab-pane>
        <el-tab-pane label="👥 人物" name="characters"></el-tab-pane>
        <el-tab-pane label="🌍 世界观" name="worldview"></el-tab-pane>
        <el-tab-pane label="📚 语料库" name="corpus"></el-tab-pane>
        <el-tab-pane label="📊 事件线" name="events"></el-tab-pane>
      </el-tabs>
    </div>

    <!-- 主要内容区域 -->
    <div class="main-content">
      <!-- 左侧面板 -->
      <div class="left-panel">
        <!-- 章节列表面板 -->
        <div v-show="activeTab === 'editor'" class="panel-content">
          <ChapterPanel
            :chapters="chapters"
            :selected-chapter-id="currentChapter?.id"
            @select="selectChapter"
            @create="addNewChapter"
            @generate-single="openAISingleChapterDialog"
            @generate-batch="openAIBatchChapterDialog"
            @edit="editChapterTitle"
            @generate="openChapterGenerateDialog"
            @delete="deleteChapter"
          />
        </div>



        <!-- 人物管理面板 -->
        <div v-show="activeTab === 'characters'" class="panel-content">
          <CharacterPanel
            :characters="characters"
            @add="addCharacter"
            @batch-generate="showBatchGenerateDialog"
            @edit="editCharacter"
            @delete="deleteCharacter"
          />
        </div>

        <!-- 世界观管理面板 -->
        <div v-show="activeTab === 'worldview'" class="panel-content">
          <WorldviewPanel
            :world-settings="worldSettings"
            @add="addWorldSetting"
            @generate="openWorldGenerateDialog"
            @edit="editWorldSetting"
            @duplicate="duplicateWorldSetting"
            @delete="deleteWorldSetting"
          />
        </div>

        <!-- 语料库面板 -->
        <div v-show="activeTab === 'corpus'" class="panel-content">
          <CorpusPanel
            :corpus-data="corpusData"
            @add="addCorpus"
            @edit="editCorpus"
            @delete="deleteCorpus"
          />
        </div>

        <!-- 事件线面板 -->
        <div v-show="activeTab === 'events'" class="panel-content">
          <EventPanel
            :events="events"
            :chapters="chapters"
            :characters="characters"
            @add="addEvent"
            @edit="editEvent"
            @delete="deleteEvent"
          />
        </div>
      </div>

      <!-- 右侧编辑器区域 -->
      <div class="editor-panel">
        <el-card shadow="never" v-if="currentChapter">
          <template #header>
            <div class="editor-header">
              <div class="editor-header-left">
                <h3 class="chapter-title">{{ currentChapter.title }}</h3>
                <div class="chapter-meta">
                  <span class="word-count">{{ contentWordCount }}字</span>
                  <el-select 
                    v-if="currentChapter.status" 
                    v-model="currentChapter.status" 
                    size="small" 
                    style="width: 80px;"
                    @change="updateChapterStatus"
                    popper-class="chapter-status-dropdown"
                  >
                    <el-option label="草稿" value="draft" />
                    <el-option label="完成" value="completed" />
                    <el-option label="发表" value="published" />
                  </el-select>
                  <span v-if="isSaving" class="saving-indicator">● 保存中...</span>
                  <el-button v-else-if="saveError" type="danger" size="small" @click="saveCurrentChapter">保存失败，点击重试</el-button>
                </div>
              </div>
              <div class="editor-header-right">
                <el-button-group>
                  <el-button size="small" @click="generateFromOutline" :disabled="!currentChapter.description">
                    <el-icon><Star /></el-icon>
                    根据大纲生成
                  </el-button>
                  <el-button size="small" @click="openContinueDialog">
                    <el-icon><ArrowRight /></el-icon>
                    续写
                  </el-button>
                  <el-button size="small" @click="enhanceContent">
                    <el-icon><Tools /></el-icon>
                    优化
                  </el-button>
                </el-button-group>
              </div>
            </div>
          </template>
          
          
          <WriterEditor ref="editorRef" v-model="content" @change="onContentChange" />
          



        </el-card>
        
        <!-- 未选择章节状态 -->
        <el-card shadow="never" v-else>
          <div class="empty-editor">
            <el-icon class="empty-icon"><Document /></el-icon>
            <p>请选择或创建一个章节开始编辑</p>
            <el-button type="primary" @click="addNewChapter">创建第一章</el-button>
          </div>
        </el-card>
      </div>
    </div>

    <!-- 章节编辑对话框 -->
    <ChapterEditDialog
      v-model="showChapterDialog"
      v-model:form="chapterForm"
      :editing="Boolean(editingChapter)"
      :generating-outline="isGeneratingOutline"
      :streaming-content="chapterEditOutlineStreamingContent"
      @generate-outline="generateChapterOutline"
      @save="saveChapter"
    />

    <!-- 人物编辑对话框 -->
    <CharacterEditDialog
      v-model="showCharacterDialog"
      v-model:form="characterForm"
      :generating="isGeneratingCharacter"
      :show-streaming="isGeneratingCharacter"
      :streaming-content="characterFormStreamingContent"
      @generate-character="generateCharacterAI"
      @choose-prompt="openCharacterPromptSelector"
      @save="saveCharacter"
    />

    <!-- 世界观编辑对话框 -->
    <WorldviewEditDialog
      v-model="showWorldDialog"
      v-model:form="worldForm"
      :generating="isGeneratingWorldSetting"
      :show-streaming="isGeneratingWorldSetting"
      :streaming-content="worldFormStreamingContent"
      @generate-description="generateWorldSettingAI"
      @save="saveWorldSetting"
    />

    <!-- 语料库编辑对话框 -->
    <CorpusEditDialog
      v-model="showCorpusDialog"
      v-model:form="corpusForm"
      :categories="corpusCategories"
      @save="saveCorpus"
    />

    <!-- 事件编辑对话框 -->
    <EventEditDialog
      v-model="showEventDialog"
      v-model:form="eventForm"
      :chapters="chapters"
      :characters="characters"
      @save="saveEvent"
    />

    <!-- 章节内容生成对话框 -->
    <ChapterGenerateDialog
      v-model="showChapterGenerateDialog"
      v-model:config="generateConfig"
      v-model:content-category="selectedContentCategory"
      v-model:prompt-variables="promptVariables"
      v-model:context-chapter-ids="selectedContextChapters"
      :chapter="targetChapter"
      :selected-prompt="selectedPrompt"
      :final-prompt="finalPrompt"
      :selected-materials="selectedMaterials"
      :characters="characters"
      :world-settings="worldSettings"
      :corpus="corpusData"
      :events="events"
      :context-chapters="availableContextChapters"
      :prompts="availablePrompts"
      :generating="isGeneratingContent"
      @generate="generateChapterContentWithDialog"
      @clear-materials="clearAllMaterials"
      @select-all-materials="selectAllMaterials"
      @toggle-material="toggleMaterial"
      @recommend-corpus="recommendCorpusForContext"
      @create-character="addCharacter"
      @create-world-setting="addWorldSetting"
      @create-corpus="addCorpus"
      @create-event="addEvent"
      @create-chapter="addNewChapter"
      @toggle-context-chapter="toggleContextChapter"
      @select-all-context="selectAllContextChapters"
      @clear-context="clearContextSelection"
      @select-prompt="selectPromptForChapter"
      @use-default-prompt="useDefaultPrompt"
      @refresh-prompts="refreshPrompts"
      @auto-fill-variables="autoFillVariables"
      @copy-prompt="copyPrompt"
      @create-prompt="createPromptForCategory"
    />

    <!-- 批量生成角色对话框 -->
    <BatchCharacterGenerateDialog
      v-model="showBatchGenerateCharacterDialog"
      v-model:config="batchGenerateConfig"
      v-model:results="generatedCharacters"
      :generating="batchGenerating"
      :importing="batchCharacterImporting"
      :selected-prompt="batchCharacterSelectedPrompt"
      :streaming-content="batchCharacterStreamingContent"
      @request-prompt="openBatchCharacterPromptSelector"
      @clear-prompt="clearBatchCharacterPrompt"
      @generate="batchGenerateCharacters"
      @import="confirmAddGeneratedCharacters"
    />

    <!-- 世界观AI生成对话框 -->
    <WorldGenerateDialog
      v-model="showWorldGenerateDialog"
      v-model:config="worldGenerateConfig"
      v-model:results="generatedWorldSettings"
      :generating="worldGenerating"
      :importing="worldGenerationImporting"
      :selected-prompt="worldSettingSelectedPrompt"
      :streaming-content="worldGenerationStreamingContent"
      @request-prompt="openWorldSettingPromptSelector"
      @clear-prompt="clearWorldSettingPrompt"
      @generate="generateWorldSettings"
      @import="confirmAddGeneratedWorldSettings"
    />

    <!-- 提示词选择对话框 -->
    <PromptPickerDialog
      v-model="showPromptDialog"
      v-model:selected-prompt="pickerSelectedPrompt"
      v-model:variables="pickerPromptVariables"
      v-model:final-prompt="pickerFinalPrompt"
      :category="selectedPromptCategory"
      :prompts="availablePrompts"
      @close="resetPromptDialog"
      @select="selectPrompt"
      @variables-change="generatePickerFinalPrompt"
      @open-library="goToPromptLibrary"
      @copy="copyPromptToClipboard"
      @confirm="useSelectedPrompt"
    />

    <!-- AI生成单章对话框 -->
    <SingleChapterGenerateDialog
      v-model="showAISingleChapterDialog"
      v-model:form="aiSingleChapterForm"
      :selected-prompt="singleChapterSelectedPrompt"
      :streaming-content="chapterOutlineStreamingContent"
      :streaming="isChapterOutlineStreaming && chapterOutlineMode === 'single'"
      :generating="isGeneratingChapters"
      :committing="isCommittingChapterOutlines"
      @close="resetAISingleChapterDialog"
      @choose-prompt="selectPromptForSingleChapter"
      @generate="generateSingleChapter"
    />

    <!-- AI批量生成章节对话框 -->
    <BatchChapterGenerateDialog
      v-model="showAIBatchChapterDialog"
      v-model:form="aiBatchChapterForm"
      :selected-prompt="batchChapterSelectedPrompt"
      :final-prompt="batchChapterFinalPrompt"
      :streaming-content="chapterOutlineStreamingContent"
      :streaming="isChapterOutlineStreaming && chapterOutlineMode === 'batch'"
      :generating="isGeneratingChapters"
      :committing="isCommittingChapterOutlines"
      @close="resetAIBatchChapterDialog"
      @choose-prompt="selectPromptForBatchChapter"
      @generate="generateBatchChapters"
    />

    <!-- 新的AI优化对话框 -->
    <OptimizeDialog
      v-model="showNewOptimizeDialog"
      v-model:form="optimizeForm"
      :prompts="optimizePrompts"
      :streaming-content="optimizeStreamingContent"
      :streaming="isOptimizeStreaming"
      :applying="isApplyingOptimize"
      :can-start="Boolean(canStartOptimize)"
      @close="resetOptimizeDialog"
      @select-prompt="selectNewOptimizePrompt"
      @open-prompt-library="goToPromptLibrary"
      @copy="copyOptimizedContent"
      @stop="stopOptimizeStreaming"
      @start="startNewOptimize"
      @apply-selection="replaceSelectedContent"
      @apply-full="replaceFullContent"
    />

    <!-- 新的AI续写对话框 -->
    <ContinueDialog
      v-model="showNewContinueDialog"
      v-model:form="continueForm"
      :current-content="currentFullContent"
      :content-word-count="contentWordCount"
      :streaming-content="continueStreamingContent"
      :streaming="isContinueStreaming"
      :appending="isAppendingContinue"
      :can-start="canStartContinue"
      @close="resetContinueDialog"
      @copy="copyContinueContent"
      @stop="stopContinueStreaming"
      @start="startNewContinue"
      @append="appendContinueContent"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, shallowRef, defineAsyncComponent } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowLeft, Document, Star, Tools, ArrowRight
} from '@element-plus/icons-vue'
import { useWriterProject } from '@/composables/useWriterProject'
import { useWriterChapterCrud } from '@/composables/useWriterChapterCrud'
import { useWriterChapterContentGeneration } from '@/composables/useWriterChapterContentGeneration'
import { useWriterMaterialCrud } from '@/composables/useWriterMaterialCrud'
import { useWriterBatchCharacterGeneration } from '@/composables/useWriterBatchCharacterGeneration'
import { useWriterBatchWorldGeneration } from '@/composables/useWriterBatchWorldGeneration'
import { useWriterChapterEditOutlineGeneration } from '@/composables/useWriterChapterEditOutlineGeneration'
import { useWriterChapterOutlineGeneration } from '@/composables/useWriterChapterOutlineGeneration'
import { useWriterGenerationArbiter } from '@/composables/useWriterGenerationArbiter'
import { useWriterPromptCatalog } from '@/composables/useWriterPromptCatalog'
import { useWriterPromptOrchestration } from '@/composables/useWriterPromptOrchestration'
import {
  useWriterCharacterFormGeneration,
  useWriterWorldSettingFormGeneration,
} from '@/composables/useWriterFormGeneration'
import { useWriterContinue } from '@/composables/useWriterContinue'
import { useWriterOptimize } from '@/composables/useWriterOptimize'
import BatchChapterGenerateDialog from '@/components/writer/dialogs/BatchChapterGenerateDialog.vue'
import BatchCharacterGenerateDialog from '@/components/writer/dialogs/BatchCharacterGenerateDialog.vue'
import ChapterEditDialog from '@/components/writer/dialogs/ChapterEditDialog.vue'
import ChapterGenerateDialog from '@/components/writer/dialogs/ChapterGenerateDialog.vue'
import CharacterEditDialog from '@/components/writer/dialogs/CharacterEditDialog.vue'
import ContinueDialog from '@/components/writer/dialogs/ContinueDialog.vue'
import CorpusEditDialog from '@/components/writer/dialogs/CorpusEditDialog.vue'
import EventEditDialog from '@/components/writer/dialogs/EventEditDialog.vue'
import OptimizeDialog from '@/components/writer/dialogs/OptimizeDialog.vue'
import PromptPickerDialog from '@/components/writer/dialogs/PromptPickerDialog.vue'
import SingleChapterGenerateDialog from '@/components/writer/dialogs/SingleChapterGenerateDialog.vue'
import WorldGenerateDialog from '@/components/writer/dialogs/WorldGenerateDialog.vue'
import WorldviewEditDialog from '@/components/writer/dialogs/WorldviewEditDialog.vue'
import ChapterPanel from '@/components/writer/panels/ChapterPanel.vue'
import CharacterPanel from '@/components/writer/panels/CharacterPanel.vue'
import CorpusPanel from '@/components/writer/panels/CorpusPanel.vue'
import EventPanel from '@/components/writer/panels/EventPanel.vue'
import WorldviewPanel from '@/components/writer/panels/WorldviewPanel.vue'
const WriterEditor = defineAsyncComponent(() => import('@/components/writer/WriterEditor.vue'))
import { useAIStream } from '@/composables/useAIStream'
import { useApiConfig } from '../services/apiConfig'
import { useNovelStore } from '../stores/novel'
import { parseChapterResponse } from '../utils/chapterParser'
import { describeWriterGenre } from '@/utils/writer/chapterContentPrompt'
import {
  buildCharacterFormPrompt,
  buildWorldSettingFormPrompt,
  parseCharacterFormResponse,
  parseWorldSettingFormResponse,
} from '@/utils/writer/materialFormGeneration'
import {
  buildBatchChapterOutlinePrompt,
  buildSingleChapterOutlinePrompt,
} from '@/utils/writer/chapterOutlinePrompts'

const route = useRoute()
const router = useRouter()
const novelStore = useNovelStore()
const {
  currentNovel, chapters, currentChapter, content, characters, worldSettings,
  corpusData, events, contentWordCount, hasUnsavedChanges, isSaving, saveError,
  saveNovelData, saveCurrentChapter, selectChapter: selectProjectChapter, initNovel, onContentChange, dispose,
} = useWriterProject({ novelStore, notifyError: message => ElMessage.error(message) })
const { activeConfig } = useApiConfig()
const generatedMaterialImport = { owner: '' }

// 检查API配置
const checkApiConfig = () => {
  const config = activeConfig.value
  if (!config.apiKey || !config.baseURL) {
    ElMessageBox.confirm(
      '检测到您还未配置AI API，需要先配置API密钥才能使用AI功能。是否前往配置？',
      '需要配置API',
      {
        confirmButtonText: '去配置',
        cancelButtonText: '稍后配置',
        type: 'warning'
      }
    ).then(() => {
      router.push('/config')
    }).catch(() => {
      // 用户选择稍后配置
    })
    return false
  }
  return true
}

const generationArbiter = useWriterGenerationArbiter({
  checkApiReady: checkApiConfig,
  notifyBlocked: message => ElMessage.warning(message),
})
const prepareIndependentWriterAI = owner => generationArbiter.prepare(owner)

const editorRef = shallowRef()
const activeTab = ref('editor')

const promptCatalog = useWriterPromptCatalog({
  notify: {
    success: message => ElMessage.success(message),
    info: message => ElMessage.info(message),
    warning: message => ElMessage.warning(message),
  },
  navigateToPromptLibrary: () => router.push('/prompts'),
})
const availablePrompts = promptCatalog.availablePrompts
const loadPrompts = promptCatalog.loadPrompts
const refreshPrompts = promptCatalog.refreshPrompts
const goToPromptLibrary = promptCatalog.goToPromptLibrary
const createPromptForCategory = promptCatalog.createPromptForCategory

// 章节正文的弹窗草稿、切章、流式请求与保存由独立协调器管理。
const chapterContentGeneration = useWriterChapterContentGeneration({
  currentNovel,
  chapters,
  currentChapter,
  content,
  hasUnsavedChanges,
  characters,
  worldSettings,
  corpusData,
  events,
  prepare: () => prepareIndependentWriterAI('chapterContent'),
  selectChapter: selectProjectChapter,
  persist: saveCurrentChapter,
  notify: {
    success: message => ElMessage.success(message),
    info: message => ElMessage.info(message),
    warning: message => ElMessage.warning(message),
    error: message => ElMessage.error(message),
  },
  stream: useAIStream(),
})
const chapterContentWorkspace = chapterContentGeneration.workspace
const showChapterGenerateDialog = chapterContentWorkspace.visible
const targetChapter = chapterContentWorkspace.targetChapter
const selectedContentCategory = chapterContentWorkspace.selectedContentCategory
const selectedMaterials = chapterContentWorkspace.selectedMaterials
const selectedContextChapters = chapterContentWorkspace.selectedContextChapterIds
const generateConfig = chapterContentWorkspace.generateConfig
const selectedPrompt = chapterContentWorkspace.selectedPrompt
const promptVariables = chapterContentWorkspace.promptVariables
const finalPrompt = chapterContentWorkspace.finalPrompt
const isGeneratingContent = chapterContentGeneration.isBusy

// 文本优化使用独立控制器与流式请求作用域。
const {
  visible: showNewOptimizeDialog,
  form: optimizeForm,
  prompts: optimizePrompts,
  canStart: canStartOptimize,
  streamingContent: optimizeStreamingContent,
  isStreaming: isOptimizeStreaming,
  isApplying: isApplyingOptimize,
  isCommitting: isCommittingOptimize,
  openFromEditor: enhanceContent,
  selectPrompt: selectNewOptimizePrompt,
  reset: resetOptimizeDialog,
  start: startNewOptimize,
  stop: stopOptimizeStreaming,
  copy: copyOptimizedContent,
  applySelection: replaceSelectedContent,
  applyFull: replaceFullContent,
  waitForCommit: waitForOptimizeCommit,
} = useWriterOptimize({
  currentChapter,
  content,
  hasUnsavedChanges,
  availablePrompts,
  ensureApiReady: () => prepareIndependentWriterAI('optimize'),
  saveCurrentChapter,
  confirmFullReplace: () => ElMessageBox.confirm(
    '确定要用润色后的内容替换整篇文章吗？此操作不可撤销。',
    '确认替换',
    {
      confirmButtonText: '确定替换',
      cancelButtonText: '取消',
      type: 'warning',
    },
  ),
  notify: {
    success: message => ElMessage.success(message),
    info: message => ElMessage.info(message),
    warning: message => ElMessage.warning(message),
    error: message => ElMessage.error(message),
  },
  writeText: text => navigator.clipboard.writeText(text),
  editor: {
    readSelection: () => editorRef.value?.getSelectionText() || '',
    insertText: text => editorRef.value?.insertText(text),
    getHtml: () => editorRef.value?.getHtml() || content.value,
  },
  stream: useAIStream(),
})

// 新的续写对话框相关数据
const {
  visible: showNewContinueDialog,
  form: continueForm,
  currentText: currentFullContent,
  canStart: canStartContinue,
  streamingContent: continueStreamingContent,
  isStreaming: isContinueStreaming,
  isAppending: isAppendingContinue,
  isCommitting: isCommittingContinue,
  open: openContinueDialog,
  reset: resetContinueDialog,
  start: startNewContinue,
  stop: stopContinueStreaming,
  copy: copyContinueContent,
  append: appendContinueContent,
  waitForCommit: waitForContinueCommit,
} = useWriterContinue({
  currentNovel,
  currentChapter,
  content,
  characters,
  hasUnsavedChanges,
  ensureApiReady: () => prepareIndependentWriterAI('continue'),
  saveCurrentChapter,
  describeGenre: describeWriterGenre,
  notify: {
    success: message => ElMessage.success(message),
    warning: message => ElMessage.warning(message),
    error: message => ElMessage.error(message),
  },
  writeText: text => navigator.clipboard.writeText(text),
  stream: useAIStream(),
})


const materialCrud = useWriterMaterialCrud({
  currentNovel,
  chapters,
  currentChapter,
  characters,
  worldSettings,
  corpusData,
  events,
  saveNovelData,
  confirmDelete: async request => {
    try {
      await ElMessageBox.confirm(request.message, request.title, { type: 'warning' })
      return true
    } catch {
      return false
    }
  },
  notify: {
    success: message => ElMessage.success(message),
    warning: message => ElMessage.warning(message),
  },
})
const showCharacterDialog = materialCrud.showCharacterDialog
const showWorldDialog = materialCrud.showWorldDialog
const showCorpusDialog = materialCrud.showCorpusDialog
const showEventDialog = materialCrud.showEventDialog
const characterForm = materialCrud.characterForm
const worldForm = materialCrud.worldForm
const corpusForm = materialCrud.corpusForm
const eventForm = materialCrud.eventForm
const addCharacter = materialCrud.addCharacter
const editCharacter = materialCrud.editCharacter
const saveCharacter = materialCrud.saveCharacter
const deleteCharacter = materialCrud.deleteCharacter
const addWorldSetting = materialCrud.addWorldSetting
const editWorldSetting = materialCrud.editWorldSetting
const saveWorldSetting = materialCrud.saveWorldSetting
const deleteWorldSetting = materialCrud.deleteWorldSetting
const duplicateWorldSetting = materialCrud.duplicateWorldSetting
const addCorpus = materialCrud.addCorpus
const editCorpus = materialCrud.editCorpus
const saveCorpus = materialCrud.saveCorpus
const deleteCorpus = materialCrud.deleteCorpus
const addEvent = materialCrud.addEvent
const editEvent = materialCrud.editEvent
const saveEvent = materialCrud.saveEvent
const deleteEvent = materialCrud.deleteEvent

const persistGeneratedMaterial = async (owner, save) => {
  if (generatedMaterialImport.owner) return false
  generatedMaterialImport.owner = owner
  try {
    return await save()
  } finally {
    if (generatedMaterialImport.owner === owner) generatedMaterialImport.owner = ''
  }
}

const batchCharacterGeneration = useWriterBatchCharacterGeneration({
  currentNovel,
  ensureApiReady: () => prepareIndependentWriterAI('batchCharacter'),
  saveGeneratedCharacters: characters => persistGeneratedMaterial(
    'characters',
    () => materialCrud.importGeneratedCharacters(characters),
  ),
  notify: {
    success: message => ElMessage.success(message),
    warning: message => ElMessage.warning(message),
    error: message => ElMessage.error(message),
  },
  stream: useAIStream(),
})
const showBatchGenerateCharacterDialog = batchCharacterGeneration.visible
const batchGenerateConfig = batchCharacterGeneration.config
const generatedCharacters = batchCharacterGeneration.results
const batchCharacterSelectedPrompt = batchCharacterGeneration.selectedPrompt
const batchGenerating = batchCharacterGeneration.isGenerating
const batchCharacterImporting = batchCharacterGeneration.isImporting
const batchCharacterStreamingContent = batchCharacterGeneration.streamingContent
const showBatchGenerateDialog = batchCharacterGeneration.open
const clearBatchCharacterPrompt = batchCharacterGeneration.clearPrompt
const batchGenerateCharacters = batchCharacterGeneration.generate
const confirmAddGeneratedCharacters = batchCharacterGeneration.importSelected

const batchWorldGeneration = useWriterBatchWorldGeneration({
  currentNovel,
  ensureApiReady: () => prepareIndependentWriterAI('batchWorld'),
  saveGeneratedWorldSettings: settings => persistGeneratedMaterial(
    'worldSettings',
    () => materialCrud.importGeneratedWorldSettings(settings),
  ),
  notify: {
    success: message => ElMessage.success(message),
    warning: message => ElMessage.warning(message),
    error: message => ElMessage.error(message),
  },
  stream: useAIStream(),
})
const showWorldGenerateDialog = batchWorldGeneration.visible
const worldGenerateConfig = batchWorldGeneration.config
const generatedWorldSettings = batchWorldGeneration.results
const worldSettingSelectedPrompt = batchWorldGeneration.selectedPrompt
const worldGenerating = batchWorldGeneration.isGenerating
const worldGenerationImporting = batchWorldGeneration.isImporting
const worldGenerationStreamingContent = batchWorldGeneration.streamingContent
const openWorldGenerateDialog = batchWorldGeneration.open
const clearWorldSettingPrompt = batchWorldGeneration.clearPrompt
const generateWorldSettings = batchWorldGeneration.generate
const confirmAddGeneratedWorldSettings = batchWorldGeneration.importSelected

const characterFormGeneration = useWriterCharacterFormGeneration({
  currentNovel,
  form: characterForm,
  ensureApiReady: () => prepareIndependentWriterAI('characterForm'),
  buildPrompt: context => buildCharacterFormPrompt(context),
  parseResponse: parseCharacterFormResponse,
  notify: {
    success: message => ElMessage.success(message),
    warning: message => ElMessage.warning(message),
    error: message => ElMessage.error(message),
  },
  stream: useAIStream(),
})
const isGeneratingCharacter = characterFormGeneration.isGenerating
const characterFormStreamingContent = characterFormGeneration.streamingContent
const generateCharacterWithPrompt = characterFormGeneration.generate
const generateCharacterAI = () => characterFormGeneration.generate()

const worldFormGeneration = useWriterWorldSettingFormGeneration({
  currentNovel,
  form: worldForm,
  ensureApiReady: () => prepareIndependentWriterAI('worldForm'),
  buildPrompt: context => buildWorldSettingFormPrompt(context),
  parseResponse: parseWorldSettingFormResponse,
  notify: {
    success: message => ElMessage.success(message),
    warning: message => ElMessage.warning(message),
    error: message => ElMessage.error(message),
  },
  stream: useAIStream(),
})
const isGeneratingWorldSetting = worldFormGeneration.isGenerating
const worldFormStreamingContent = worldFormGeneration.streamingContent
const generateWorldSettingAI = worldFormGeneration.generate

const chapterOutlineGeneration = useWriterChapterOutlineGeneration({
  currentNovel,
  chapters,
  ensureApiReady: () => prepareIndependentWriterAI('chapterOutline'),
  persist: saveNovelData,
  buildSinglePrompt: buildSingleChapterOutlinePrompt,
  buildBatchPrompt: buildBatchChapterOutlinePrompt,
  parseBatchResponse: parseChapterResponse,
  notify: {
    success: message => ElMessage.success(message),
    warning: message => ElMessage.warning(message),
    error: message => ElMessage.error(message),
  },
  stream: useAIStream(),
})
const showAISingleChapterDialog = chapterOutlineGeneration.singleVisible
const showAIBatchChapterDialog = chapterOutlineGeneration.batchVisible
const aiSingleChapterForm = chapterOutlineGeneration.singleForm
const aiBatchChapterForm = chapterOutlineGeneration.batchForm
const singleChapterSelectedPrompt = chapterOutlineGeneration.singleSelectedPrompt
const batchChapterSelectedPrompt = chapterOutlineGeneration.batchSelectedPrompt
const batchChapterFinalPrompt = chapterOutlineGeneration.batchTemplatePrompt
const chapterOutlineMode = chapterOutlineGeneration.activeMode
const isGeneratingChapters = chapterOutlineGeneration.isGenerating
const isCommittingChapterOutlines = chapterOutlineGeneration.isCommitting
const chapterOutlineStreamingContent = chapterOutlineGeneration.streamingContent
const isChapterOutlineStreaming = chapterOutlineGeneration.isStreaming
const openAISingleChapterDialog = chapterOutlineGeneration.openSingle
const openAIBatchChapterDialog = chapterOutlineGeneration.openBatch
const resetAISingleChapterDialog = chapterOutlineGeneration.resetSingle
const resetAIBatchChapterDialog = chapterOutlineGeneration.resetBatch
const generateSingleChapter = chapterOutlineGeneration.generateSingle
const generateBatchChapters = chapterOutlineGeneration.generateBatch

// 方法
const goBack = () => router.push('/novels')

const chapterCrud = useWriterChapterCrud({
  currentNovel,
  chapters,
  currentChapter,
  content,
  persist: saveNovelData,
  // The wrapper also cancels any generation owned by the chapter being left.
  selectChapter: chapter => selectChapter(chapter),
  confirmDelete: async chapter => {
    try {
      await ElMessageBox.confirm(`确定要删除章节《${chapter.title}》吗？`, '确认删除', {
        type: 'warning',
      })
      return true
    } catch {
      return false
    }
  },
  notify: {
    success: message => ElMessage.success(message),
    warning: message => ElMessage.warning(message),
  },
})
const showChapterDialog = chapterCrud.visible
const chapterForm = chapterCrud.form
const editingChapter = chapterCrud.editingChapter
const addNewChapter = chapterCrud.openCreate
const editChapterTitle = chapterCrud.openEdit
const saveChapter = chapterCrud.save
const deleteChapter = chapterCrud.remove

const chapterEditOutlineGeneration = useWriterChapterEditOutlineGeneration({
  currentNovel,
  chapters,
  characters,
  worldSettings,
  form: chapterForm,
  editingChapter,
  visible: showChapterDialog,
  ensureApiReady: () => prepareIndependentWriterAI('chapterEditOutline'),
  notify: {
    success: message => ElMessage.success(message),
    warning: message => ElMessage.warning(message),
    error: message => ElMessage.error(message),
  },
  stream: useAIStream(),
})
const isGeneratingOutline = chapterEditOutlineGeneration.isGenerating
const chapterEditOutlineStreamingContent = chapterEditOutlineGeneration.streamingContent
const generateChapterOutline = chapterEditOutlineGeneration.generate

const promptOrchestration = useWriterPromptOrchestration({
  currentNovel,
  chapters,
  characterFormGeneration: {
    form: characterForm,
    generate: generateCharacterWithPrompt,
  },
  batchCharacterGeneration,
  batchWorldGeneration,
  chapterOutlineGeneration,
  notify: {
    success: message => ElMessage.success(message),
    info: message => ElMessage.info(message),
    warning: message => ElMessage.warning(message),
    error: message => ElMessage.error(message),
  },
  writeText: text => navigator.clipboard.writeText(text),
})
const {
  showPromptDialog,
  selectedPromptCategory,
  pickerSelectedPrompt,
  pickerPromptVariables,
  pickerFinalPrompt,
  resetPromptDialog,
  selectPrompt,
  generatePickerFinalPrompt,
  useSelectedPrompt,
  openCharacterPromptSelector,
  openBatchCharacterPromptSelector,
  openWorldSettingPromptSelector,
  selectPromptForSingleChapter,
  selectPromptForBatchChapter,
  copyPromptToClipboard,
} = promptOrchestration

const resetContinueWorkspace = () => {
  const reset = resetContinueDialog()
  showNewContinueDialog.value = false
  return reset
}
const resetOptimizeWorkspace = () => {
  const reset = resetOptimizeDialog()
  showNewOptimizeDialog.value = false
  return reset
}
const interruptGeneration = controller => controller.isGenerating.value
  ? controller.cancel()
  : true

generationArbiter.registerScope('chapterContent', {
  reset: chapterContentGeneration.reset,
  interrupt: chapterContentGeneration.reset,
  revokeBeforeWait: () => {
    if (chapterContentGeneration.isBusy.value
      && !chapterContentGeneration.isCommitting.value) {
      chapterContentGeneration.cancel()
    }
  },
})
generationArbiter.registerScope('continue', {
  reset: resetContinueWorkspace,
  interrupt: resetContinueWorkspace,
  revokeBeforeWait: resetContinueWorkspace,
})
generationArbiter.registerScope('optimize', {
  reset: resetOptimizeWorkspace,
  interrupt: resetOptimizeWorkspace,
  revokeBeforeWait: resetOptimizeWorkspace,
})
for (const [owner, controller] of [
  ['batchCharacter', batchCharacterGeneration],
  ['batchWorld', batchWorldGeneration],
  ['characterForm', characterFormGeneration],
  ['worldForm', worldFormGeneration],
  ['chapterOutline', chapterOutlineGeneration],
  ['chapterEditOutline', chapterEditOutlineGeneration],
]) {
  generationArbiter.registerScope(owner, {
    reset: controller.reset,
    interrupt: () => interruptGeneration(controller),
    revokeBeforeWait: () => interruptGeneration(controller),
  })
}
generationArbiter.registerScope('promptPicker', {
  reset: resetPromptDialog,
  interrupt: resetPromptDialog,
  revokeBeforeWait: resetPromptDialog,
})

const isChapterContentPersisting = computed(
  () => chapterContentGeneration.isSelectingChapter.value
    || chapterContentGeneration.isCommitting.value,
)
generationArbiter.registerBarrier('materialMutation', {
  isPending: materialCrud.isMutating,
  wait: materialCrud.waitForMutation,
})
generationArbiter.registerBarrier('characterImport', {
  isPending: batchCharacterGeneration.isImporting,
  wait: batchCharacterGeneration.waitForImport,
})
generationArbiter.registerBarrier('worldImport', {
  isPending: batchWorldGeneration.isImporting,
  wait: batchWorldGeneration.waitForImport,
})
generationArbiter.registerBarrier('chapterOutlineCommit', {
  isPending: chapterOutlineGeneration.isCommitting,
  wait: chapterOutlineGeneration.waitForCommit,
})
generationArbiter.registerBarrier('chapterContentCommit', {
  isPending: isChapterContentPersisting,
  wait: chapterContentGeneration.waitForCommit,
})
generationArbiter.registerBarrier('continueCommit', {
  isPending: isCommittingContinue,
  wait: waitForContinueCommit,
})
generationArbiter.registerBarrier('optimizeCommit', {
  isPending: isCommittingOptimize,
  wait: waitForOptimizeCommit,
})

const waitForWorkspaceCommits = generationArbiter.waitForCommits

const getChapterStatusText = (status) => {
  const statusMap = {
    draft: '草稿',
    completed: '完成',
    published: '发表'
  }
  return statusMap[status] || '草稿'
}

// 章节正文生成对话框及操作。
const openChapterGenerateDialog = chapterContentGeneration.open
const generateFromOutline = chapterContentGeneration.openFromOutline
const autoFillVariables = chapterContentGeneration.autoFillVariables
const toggleMaterial = chapterContentGeneration.toggleMaterial
const selectPromptForChapter = chapterContentGeneration.selectPrompt
const recommendCorpusForContext = chapterContentGeneration.recommendCorpusForContext
const availableContextChapters = chapterContentGeneration.availableContextChapters
const toggleContextChapter = chapterContentGeneration.toggleContextChapter
const clearContextSelection = chapterContentGeneration.clearContextSelection
const selectAllContextChapters = chapterContentGeneration.selectAllContextChapters
const clearAllMaterials = chapterContentGeneration.clearAllMaterials
const selectAllMaterials = chapterContentGeneration.selectAllMaterials
const generateChapterContentWithDialog = chapterContentGeneration.generateChapterContentWithDialog

// 语料分类：读取 + 兜底显示
const getCorpusCategory = (corpus) => {
  const category = (corpus.category || '').trim()
  return category || ''
}

const corpusCategories = computed(() => {
  const categories = new Set()
  corpusData.value.forEach((corpus) => {
    const category = getCorpusCategory(corpus)
    if (category) categories.add(category)
  })
  return [...categories].sort()
})

// 更新章节状态
const updateChapterStatus = async () => {
  if (!currentChapter.value) return

  // 同步更新章节列表中的状态
  const chapterIndex = chapters.value.findIndex(ch => ch.id === currentChapter.value.id)
  if (chapterIndex > -1) {
    chapters.value[chapterIndex].status = currentChapter.value.status
    chapters.value[chapterIndex].updatedAt = new Date()
  }

  // 保存更新
  if (!(await saveCurrentChapter())) return
  
  ElMessage.success(`章节状态已更新为：${getChapterStatusText(currentChapter.value.status)}`)
}

const useDefaultPrompt = () => {
  promptCatalog.useDefaultPrompt(
    selectedContentCategory.value,
    prompt => chapterContentGeneration.selectPrompt(prompt),
  )
}

const copyPrompt = () => {
  if (finalPrompt.value) {
    navigator.clipboard.writeText(finalPrompt.value)
    ElMessage.success('提示词已复制到剪贴板')
  }
}

const stopWriterStreams = () => generationArbiter.resetAll()

watch(showCharacterDialog, opened => {
  if (!opened) characterFormGeneration.reset()
}, { flush: 'sync' })
watch(showWorldDialog, opened => {
  if (!opened) worldFormGeneration.reset()
}, { flush: 'sync' })

const selectChapter = async (chapter) => {
  if (!(await waitForWorkspaceCommits())) return false
  if (currentChapter.value && currentChapter.value.id !== chapter.id) stopWriterStreams()
  return selectProjectChapter(chapter)
}

// Deleting the selected chapter and loading another novel also change this ref.
watch(() => currentChapter.value?.id, (id, previousId) => {
  if (previousId === undefined || id === previousId) return
  if (chapterContentGeneration.isExpectedChapterSelection(currentChapter.value)) return
  stopWriterStreams()
}, { flush: 'sync' })

// 页面离开前等待真实保存完成，失败时保留当前编辑上下文。
onBeforeRouteLeave(async () => {
  if (!(await waitForWorkspaceCommits())) return false
  stopWriterStreams()
  return saveCurrentChapter()
})
onBeforeRouteUpdate(async (to, from) => {
  if (to.query.novelId === from.query.novelId) return true
  if (!(await waitForWorkspaceCommits())) return false
  stopWriterStreams()
  return saveCurrentChapter()
})
onMounted(async () => {
  const opened = await initNovel(route.query.novelId)
  if (!opened && !currentNovel.value) { void router.replace('/novels'); return }
  loadPrompts()
})
watch(() => route.query.novelId, async (id, previousId) => {
  if (id !== previousId) await initNovel(id)
})
onUnmounted(() => {
  stopWriterStreams()
  chapterContentGeneration.dispose()
  generationArbiter.dispose()
  void dispose()
})
</script>

<style scoped>
.writer-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: var(--el-fill-color-light);
}

.title-bar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  height: 50px;
  padding: 0 20px;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color-light);
}

.title-left {
  display: flex;
  gap: 15px;
  align-items: center;
}

.novel-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.tabs-bar {
  flex-shrink: 0;
  padding: 0 20px;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color-light);
}

.main-tabs,
.main-tabs .el-tabs__header {
  margin: 0;
}

.main-tabs .el-tabs__nav-wrap::after {
  display: none;
}

.main-content {
  display: flex;
  flex: 1;
  gap: 16px;
  padding: 16px;
  overflow: hidden;
}

.left-panel {
  flex-shrink: 0;
  width: 280px;
}

.panel-content {
  height: calc(100vh - 150px);
  overflow: hidden;
}

.editor-panel {
  flex: 1;
  min-width: 0;
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.editor-header-left {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
}

.chapter-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--el-text-color-primary);
}

.chapter-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.word-count {
  font-weight: 500;
  color: var(--el-text-color-regular);
}

.editor-header-right {
  flex-shrink: 0;
  margin-left: 20px;
}

.saving-indicator {
  color: var(--brand-500) !important;
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.6;
  }
}

.chapter-status-dropdown .el-select-dropdown__item {
  padding: 6px 16px;
  font-size: 12px;
}

.chapter-status-dropdown .el-select-dropdown__item.selected {
  font-weight: 600;
}

.chapter-meta .el-select {
  min-width: 70px;
}

.chapter-meta .el-select .el-input__wrapper {
  height: 24px;
  padding: 0 8px;
  font-size: 12px;
}

.empty-editor {
  padding: 80px 20px;
  color: var(--el-text-color-secondary);
  text-align: center;
}

.empty-icon {
  margin-bottom: 16px;
  font-size: 48px;
  opacity: 0.5;
}
</style>
