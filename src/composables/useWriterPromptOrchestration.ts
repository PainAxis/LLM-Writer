import { watch, type Ref } from 'vue'
import {
  PROMPT_PICKER_TARGET,
  usePromptPicker,
  type PromptPickerTarget,
} from '@/composables/usePromptPicker'
import type {
  PromptTemplate,
  WriterBatchChapterGenerationForm,
  WriterBatchCharacterGenerationConfig,
  WriterChapter,
  WriterCharacterForm,
  WriterNovel,
  WriterSingleChapterGenerationForm,
  WriterWorldGenerationConfig,
} from '@/types/writer'
import { describeWriterGenre } from '@/utils/writer/chapterContentPrompt'
import {
  describeChapterTemplate,
  formatRecentChapterDetails,
} from '@/utils/writer/chapterOutlinePrompts'
import {
  getBatchCharacterTypes,
  getBatchWorldSettingTypes,
} from '@/utils/writer/materialGenerationPrompts'

export interface WriterPromptNotifications {
  success(message: string): unknown
  info(message: string): unknown
  warning(message: string): unknown
  error(message: string): unknown
}

export interface WriterPromptSelectionSnapshot {
  readonly target: PromptPickerTarget
  readonly novelId: number | null
  readonly novel: Readonly<Pick<WriterNovel, 'id' | 'title' | 'genre' | 'description'>> | null
  readonly chapters: ReadonlyArray<Readonly<Pick<
    WriterChapter,
    'id' | 'title' | 'description' | 'wordCount'
  >>>
  readonly prompt: Readonly<PromptTemplate>
  readonly renderedPrompt: string
}

export interface WriterPromptCharacterDestination {
  form: Readonly<Ref<WriterCharacterForm>>
  generate(
    renderedPrompt: string,
    snapshot: WriterPromptSelectionSnapshot,
  ): unknown
}

export interface WriterPromptBatchCharacterDestination {
  config: Readonly<Ref<WriterBatchCharacterGenerationConfig>>
  usePrompt(
    prompt: PromptTemplate,
    renderedPrompt: string,
    snapshot: WriterPromptSelectionSnapshot,
  ): boolean
}

export interface WriterPromptBatchWorldDestination {
  config: Readonly<Ref<WriterWorldGenerationConfig>>
  usePrompt(
    prompt: PromptTemplate,
    renderedPrompt: string,
    snapshot: WriterPromptSelectionSnapshot,
  ): boolean
}

export interface WriterPromptChapterOutlineDestination {
  singleForm: Readonly<Ref<WriterSingleChapterGenerationForm>>
  batchForm: Readonly<Ref<WriterBatchChapterGenerationForm>>
  useSinglePrompt(
    prompt: PromptTemplate,
    renderedPrompt: string,
    snapshot: WriterPromptSelectionSnapshot,
  ): boolean
  useBatchPrompt(
    prompt: PromptTemplate,
    renderedPrompt: string,
    snapshot: WriterPromptSelectionSnapshot,
  ): boolean
}

export interface WriterPromptOrchestrationOptions {
  currentNovel: Readonly<Ref<WriterNovel | null | undefined>>
  chapters: Readonly<Ref<WriterChapter[]>>
  characterFormGeneration: WriterPromptCharacterDestination
  batchCharacterGeneration: WriterPromptBatchCharacterDestination
  batchWorldGeneration: WriterPromptBatchWorldDestination
  chapterOutlineGeneration: WriterPromptChapterOutlineDestination
  notify: WriterPromptNotifications
  writeText(text: string): void | Promise<void>
}

interface PickerProjectSource {
  novel: WriterNovel | null | undefined
  novelId: number | null
  chapters: WriterChapter[]
}

const roleDescriptions: Readonly<Record<string, string>> = Object.freeze({
  protagonist: '主角',
  supporting: '配角',
  antagonist: '反派',
  minor: '次要角色',
})

const clonePrompt = (prompt: PromptTemplate): PromptTemplate => ({
  ...prompt,
  tags: prompt.tags ? [...prompt.tags] : undefined,
})

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * Owns the reusable picker draft and all five Writer picker destinations. An
 * opened picker belongs to the exact novel object and chapter
 * collection that opened it, so a same-id project reload cannot consume stale
 * prompt state.
 */
export function useWriterPromptOrchestration(options: WriterPromptOrchestrationOptions) {
  const picker = usePromptPicker()
  let projectSource: PickerProjectSource | null = null

  const projectIsCurrent = (): boolean => projectSource !== null
    && options.currentNovel.value === projectSource.novel
    && (options.currentNovel.value?.id ?? null) === projectSource.novelId
    && options.chapters.value === projectSource.chapters

  const resetPromptDialog = () => {
    picker.visible.value = false
    picker.reset()
    projectSource = null
  }

  const openPromptDialog = (target: PromptPickerTarget) => {
    projectSource = {
      novel: options.currentNovel.value,
      novelId: options.currentNovel.value?.id ?? null,
      chapters: options.chapters.value,
    }
    picker.open(target)
  }

  const autoFillCharacterVariables = () => {
    if (picker.target.value !== PROMPT_PICKER_TARGET.CHARACTER_EDIT
      || !picker.selectedPrompt.value) return

    const form = options.characterFormGeneration.form.value
    const novelGenre = options.currentNovel.value?.genre || '现代'
    const role = roleDescriptions[form.role] || '配角'
    picker.variables.value['小说标题'] = options.currentNovel.value?.title || '未命名小说'
    picker.variables.value['姓名'] = form.name || ''
    picker.variables.value['性别'] = form.gender === 'male'
      ? '男'
      : form.gender === 'female' ? '女' : '其他'
    picker.variables.value['年龄'] = form.age?.toString() || '25'
    picker.variables.value['角色定位'] = role
    picker.variables.value['角色类型'] = role
    picker.variables.value['小说类型'] = novelGenre

    if (form.role === 'antagonist') picker.variables.value['关系设定'] = '与主角对立的敌人'
    if (form.role === 'supporting') picker.variables.value['角色作用'] = '协助主角发展剧情'

    if (novelGenre.includes('古风') || novelGenre.includes('古代')) {
      picker.variables.value['社会地位'] = '普通百姓'
    } else if (novelGenre.includes('现代') || novelGenre.includes('都市')) {
      picker.variables.value['职业设定'] = '上班族'
    } else if (novelGenre.includes('玄幻') || novelGenre.includes('修仙')) {
      picker.variables.value['修为等级'] = '练气期'
    } else if (novelGenre.includes('科幻')) {
      picker.variables.value['科技设定'] = '星际文明时代'
    }

    picker.render()
  }

  const autoFillBatchCharacterVariables = () => {
    if (picker.target.value !== PROMPT_PICKER_TARGET.CHARACTER_BATCH
      || !picker.selectedPrompt.value) return

    const config = options.batchCharacterGeneration.config.value
    picker.variables.value['小说标题'] = options.currentNovel.value?.title || '未命名小说'
    picker.variables.value['小说类型'] = describeWriterGenre(options.currentNovel.value?.genre)
    picker.variables.value['小说简介'] = options.currentNovel.value?.description || '暂无简介'
    picker.variables.value['生成数量'] = config.count.toString()
    picker.variables.value['角色类型'] = getBatchCharacterTypes(config).join('、')
    picker.variables.value['特殊要求'] = config.customPrompt || '按小说设定生成'
    picker.render()
  }

  const autoFillWorldSettingVariables = () => {
    if (picker.target.value !== PROMPT_PICKER_TARGET.WORLD_BATCH
      || !picker.selectedPrompt.value) return

    const config = options.batchWorldGeneration.config.value
    picker.variables.value['小说标题'] = options.currentNovel.value?.title || '未命名小说'
    picker.variables.value['小说类型'] = describeWriterGenre(options.currentNovel.value?.genre)
    picker.variables.value['小说简介'] = options.currentNovel.value?.description || '暂无简介'
    picker.variables.value['生成数量'] = config.count.toString()
    picker.variables.value['设定类型'] = getBatchWorldSettingTypes(config).join('、')
    picker.variables.value['特殊要求'] = config.customPrompt || '符合小说世界观设定'
    picker.render()
  }

  const autoFillSingleChapterVariables = () => {
    if (picker.target.value !== PROMPT_PICKER_TARGET.CHAPTER_SINGLE
      || !picker.selectedPrompt.value) return

    const form = options.chapterOutlineGeneration.singleForm.value
    picker.variables.value['小说标题'] = options.currentNovel.value?.title || '未命名小说'
    picker.variables.value['小说类型'] = describeWriterGenre(options.currentNovel.value?.genre)
    picker.variables.value['小说简介'] = options.currentNovel.value?.description || '暂无简介'
    picker.variables.value['章节标题'] = form.title || ''
    picker.variables.value['情节要求'] = form.plotRequirement || '请根据章节标题合理发展'
    picker.variables.value['模板类型'] = describeChapterTemplate(form.template)
    picker.variables.value['已有章节'] = formatRecentChapterDetails(options.chapters.value)
    picker.render()
  }

  const autoFillBatchChapterVariables = () => {
    if (picker.target.value !== PROMPT_PICKER_TARGET.CHAPTER_BATCH
      || !picker.selectedPrompt.value) return

    const form = options.chapterOutlineGeneration.batchForm.value
    picker.variables.value['小说标题'] = options.currentNovel.value?.title || '未命名小说'
    picker.variables.value['小说类型'] = describeWriterGenre(options.currentNovel.value?.genre)
    picker.variables.value['小说简介'] = options.currentNovel.value?.description || '暂无简介'
    picker.variables.value['生成章节数量'] = form.count.toString()
    picker.variables.value['情节要求'] = form.plotRequirement || '请根据小说主题合理发展'
    picker.variables.value['模板类型'] = describeChapterTemplate(form.template)
    picker.variables.value['已有章节'] = formatRecentChapterDetails(options.chapters.value)
    picker.render()
  }

  const autoFillCurrentTarget = () => {
    switch (picker.target.value) {
      case PROMPT_PICKER_TARGET.CHARACTER_EDIT:
        autoFillCharacterVariables()
        break
      case PROMPT_PICKER_TARGET.CHARACTER_BATCH:
        autoFillBatchCharacterVariables()
        break
      case PROMPT_PICKER_TARGET.WORLD_BATCH:
        autoFillWorldSettingVariables()
        break
      case PROMPT_PICKER_TARGET.CHAPTER_SINGLE:
        autoFillSingleChapterVariables()
        break
      case PROMPT_PICKER_TARGET.CHAPTER_BATCH:
        autoFillBatchChapterVariables()
        break
    }
  }

  const selectPrompt = (prompt: PromptTemplate) => {
    if (!projectIsCurrent()) {
      options.notify.warning('小说上下文已失效，请重新打开提示词选择器')
      resetPromptDialog()
      return false
    }
    picker.select(prompt)
    autoFillCurrentTarget()
    return true
  }

  const createSelectionSnapshot = (): WriterPromptSelectionSnapshot | null => {
    const target = picker.target.value
    const prompt = picker.selectedPrompt.value
    if (!target || !prompt || !picker.finalPrompt.value || !projectIsCurrent()) return null

    const novel = options.currentNovel.value
    return Object.freeze({
      target,
      novelId: novel?.id ?? null,
      novel: novel
        ? Object.freeze({
            id: novel.id,
            title: novel.title,
            genre: novel.genre,
            description: novel.description,
          })
        : null,
      chapters: Object.freeze(options.chapters.value.map(chapter => Object.freeze({
        id: chapter.id,
        title: chapter.title,
        description: chapter.description,
        wordCount: chapter.wordCount,
      }))),
      prompt: Object.freeze(clonePrompt(prompt)),
      renderedPrompt: picker.finalPrompt.value,
    })
  }

  const closeAfterSelection = () => {
    picker.visible.value = false
    picker.reset()
    projectSource = null
  }

  const useSelectedPrompt = () => {
    if (!picker.selectedPrompt.value || !picker.finalPrompt.value) {
      options.notify.warning('请选择提示词并填充变量')
      return false
    }

    autoFillCurrentTarget()
    const selectedPrompt = picker.selectedPrompt.value
    const snapshot = createSelectionSnapshot()
    if (!snapshot) {
      options.notify.warning('小说上下文已失效，请重新打开提示词选择器')
      resetPromptDialog()
      return false
    }

    switch (snapshot.target) {
      case PROMPT_PICKER_TARGET.CHARACTER_EDIT: {
        closeAfterSelection()
        try {
          const pending = options.characterFormGeneration.generate(
            snapshot.renderedPrompt,
            snapshot,
          )
          if (pending instanceof Promise) {
            void pending.catch(error => {
              options.notify.error(`人物生成失败: ${errorMessage(error)}`)
            })
          }
        } catch (error) {
          options.notify.error(`人物生成失败: ${errorMessage(error)}`)
          return false
        }
        return true
      }
      case PROMPT_PICKER_TARGET.CHARACTER_BATCH:
        if (!options.batchCharacterGeneration.usePrompt(
          selectedPrompt,
          snapshot.renderedPrompt,
          snapshot,
        )) return false
        closeAfterSelection()
        options.notify.success('已选择批量生成角色提示词')
        return true
      case PROMPT_PICKER_TARGET.WORLD_BATCH:
        if (!options.batchWorldGeneration.usePrompt(
          selectedPrompt,
          snapshot.renderedPrompt,
          snapshot,
        )) return false
        closeAfterSelection()
        options.notify.success('已选择世界观生成提示词')
        return true
      case PROMPT_PICKER_TARGET.CHAPTER_SINGLE:
        if (!options.chapterOutlineGeneration.useSinglePrompt(
          selectedPrompt,
          snapshot.renderedPrompt,
          snapshot,
        )) return false
        closeAfterSelection()
        options.notify.success('已选择单章生成提示词，请点击"生成章节"按钮开始生成')
        return true
      case PROMPT_PICKER_TARGET.CHAPTER_BATCH:
        if (!options.chapterOutlineGeneration.useBatchPrompt(
          selectedPrompt,
          snapshot.renderedPrompt,
          snapshot,
        )) return false
        closeAfterSelection()
        options.notify.success('已选择批量生成章节提示词，请点击"批量生成"按钮开始生成')
        return true
    }
  }

  const copyPromptToClipboard = async () => {
    try {
      await options.writeText(picker.finalPrompt.value)
      options.notify.success('提示词已复制到剪贴板')
      return true
    } catch {
      options.notify.error('复制失败')
      return false
    }
  }

  const openCharacterPromptSelector = () => openPromptDialog(PROMPT_PICKER_TARGET.CHARACTER_EDIT)
  const openBatchCharacterPromptSelector = () => openPromptDialog(PROMPT_PICKER_TARGET.CHARACTER_BATCH)
  const openWorldSettingPromptSelector = () => openPromptDialog(PROMPT_PICKER_TARGET.WORLD_BATCH)
  const selectPromptForSingleChapter = () => openPromptDialog(PROMPT_PICKER_TARGET.CHAPTER_SINGLE)
  const selectPromptForBatchChapter = () => openPromptDialog(PROMPT_PICKER_TARGET.CHAPTER_BATCH)

  watch(
    [
      options.characterFormGeneration.form,
      options.batchCharacterGeneration.config,
      options.batchWorldGeneration.config,
      options.chapterOutlineGeneration.singleForm,
      options.chapterOutlineGeneration.batchForm,
    ],
    autoFillCurrentTarget,
    { deep: true, flush: 'sync' },
  )

  watch(
    [options.currentNovel, options.chapters],
    () => {
      if (!picker.visible.value) return
      if (!projectIsCurrent()) {
        resetPromptDialog()
        return
      }
      autoFillCurrentTarget()
    },
    { deep: true, flush: 'sync' },
  )

  return {
    showPromptDialog: picker.visible,
    promptPickerTarget: picker.target,
    selectedPromptCategory: picker.category,
    pickerSelectedPrompt: picker.selectedPrompt,
    pickerPromptVariables: picker.variables,
    pickerFinalPrompt: picker.finalPrompt,
    openPromptDialog,
    resetPromptDialog,
    selectPrompt,
    generatePickerFinalPrompt: picker.render,
    createSelectionSnapshot,
    useSelectedPrompt,
    autoFillCurrentTarget,
    autoFillCharacterVariables,
    autoFillBatchCharacterVariables,
    autoFillWorldSettingVariables,
    autoFillSingleChapterVariables,
    autoFillBatchChapterVariables,
    openCharacterPromptSelector,
    openBatchCharacterPromptSelector,
    openWorldSettingPromptSelector,
    selectPromptForSingleChapter,
    selectPromptForBatchChapter,
    copyPromptToClipboard,
  }
}
