import assert from 'node:assert/strict'
import { ref } from 'vue'
import { DEFAULT_PROMPTS, PROMPTS_VERSION } from '../src/config/defaultPrompts'
import { PROMPT_PICKER_TARGET } from '../src/composables/usePromptPicker'
import { useWriterPromptCatalog } from '../src/composables/useWriterPromptCatalog'
import {
  useWriterPromptOrchestration,
  type WriterPromptSelectionSnapshot,
} from '../src/composables/useWriterPromptOrchestration'
import type {
  PromptTemplate,
  WriterBatchChapterGenerationForm,
  WriterBatchCharacterGenerationConfig,
  WriterCharacterForm,
  WriterNovel,
  WriterSingleChapterGenerationForm,
  WriterWorldGenerationConfig,
} from '../src/types/writer'
import { StorageKeys } from '../src/utils/storage'

const values = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size },
  },
})

const notifications = {
  success: [] as string[],
  info: [] as string[],
  warning: [] as string[],
  error: [] as string[],
}
const notify = {
  success: (message: string) => notifications.success.push(message),
  info: (message: string) => notifications.info.push(message),
  warning: (message: string) => notifications.warning.push(message),
  error: (message: string) => notifications.error.push(message),
}

values.set(StorageKeys.prompts, JSON.stringify([
  {
    ...DEFAULT_PROMPTS[0],
    title: '待升级的内置模板',
  },
  {
    id: 999,
    title: '用户模板',
    category: 'content',
    content: '用户正文 {章节标题}',
  },
]))
values.set(StorageKeys.promptsVersion, JSON.stringify(PROMPTS_VERSION - 1))

let navigationCount = 0
const catalog = useWriterPromptCatalog({
  notify,
  navigateToPromptLibrary: () => { navigationCount += 1 },
})
catalog.loadPrompts()
assert.equal(
  catalog.availablePrompts.value.find(prompt => prompt.id === DEFAULT_PROMPTS[0].id)?.title,
  DEFAULT_PROMPTS[0].title,
)
assert.equal(catalog.availablePrompts.value.find(prompt => prompt.id === 999)?.title, '用户模板')
assert.equal(JSON.parse(values.get(StorageKeys.promptsVersion) ?? '-1'), PROMPTS_VERSION)

let contentPrompt: PromptTemplate | null = null
assert.equal(catalog.useDefaultPrompt('content', prompt => { contentPrompt = prompt }), true)
assert.equal(contentPrompt?.isDefault, true)
assert.equal(notifications.info.at(-1), '已切换到默认提示词')
assert.equal(catalog.useDefaultPrompt('missing-category', () => undefined), false)
assert.equal(notifications.warning.at(-1), '当前正文类型暂无可用的默认提示词')
catalog.refreshPrompts()
assert.equal(notifications.success.at(-1), '提示词列表已刷新')
catalog.goToPromptLibrary()
catalog.createPromptForCategory()
assert.equal(navigationCount, 2)

values.clear()
const freshCatalog = useWriterPromptCatalog({
  notify,
  navigateToPromptLibrary: () => undefined,
})
freshCatalog.loadPrompts()
assert.equal(freshCatalog.availablePrompts.value.length, DEFAULT_PROMPTS.length)
freshCatalog.availablePrompts.value[0].title = '本地变更'
assert.notEqual(DEFAULT_PROMPTS[0].title, '本地变更')
console.log('✓ 提示词目录：默认库升级、用户模板保留、刷新、默认选择与入口')

const currentNovel = ref<WriterNovel>({
  id: 7,
  title: '雾城',
  genre: 'modern',
  description: '侦探寻找失踪的证人',
})
const chapters = ref([
  { id: 1, title: '雨夜', description: '证人在车站失踪', wordCount: 1800 },
  { id: 2, title: '空房', description: '侦探找到一把钥匙', wordCount: 2100 },
])
const characterForm = ref<WriterCharacterForm>({
  id: null,
  name: '林砚',
  role: 'supporting',
  gender: 'male',
  age: 29,
  appearance: '',
  personality: '',
  background: '',
  tags: [],
  avatar: '',
})
const batchCharacterConfig = ref<WriterBatchCharacterGenerationConfig>({
  count: 4,
  includeMainCharacters: true,
  includeSupportingCharacters: false,
  includeMinorCharacters: true,
  customPrompt: '姓名不要重复',
  autoAssignRoles: true,
})
const worldConfig = ref<WriterWorldGenerationConfig>({
  count: 2,
  includeGeography: true,
  includeCulture: false,
  includeHistory: true,
  includeMagic: false,
  includeTechnology: false,
  includePolitics: false,
  includeReligion: false,
  includeEconomy: false,
  includeRaces: false,
  includeLanguage: false,
  customPrompt: '规则应可验证',
})
const singleForm = ref<WriterSingleChapterGenerationForm>({
  title: '第三章 旧钟',
  plotRequirement: '发现时间线矛盾',
  template: 'turning',
})
const batchForm = ref<WriterBatchChapterGenerationForm>({
  count: 3,
  plotRequirement: '逐步揭示幕后组织',
  template: 'general',
})

type DestinationCall = {
  target: string
  prompt: string
  snapshot: WriterPromptSelectionSnapshot
}
const calls: DestinationCall[] = []
const copied: string[] = []
let rejectCopy = false

const orchestration = useWriterPromptOrchestration({
  currentNovel,
  chapters,
  characterFormGeneration: {
    form: characterForm,
    generate: (prompt, snapshot) => calls.push({ target: 'character-edit', prompt, snapshot }),
  },
  batchCharacterGeneration: {
    config: batchCharacterConfig,
    usePrompt: (_prompt, renderedPrompt, snapshot) => {
      calls.push({ target: 'character-batch', prompt: renderedPrompt, snapshot })
      return true
    },
  },
  batchWorldGeneration: {
    config: worldConfig,
    usePrompt: (_prompt, renderedPrompt, snapshot) => {
      calls.push({ target: 'world-batch', prompt: renderedPrompt, snapshot })
      return true
    },
  },
  chapterOutlineGeneration: {
    singleForm,
    batchForm,
    useSinglePrompt: (_prompt, renderedPrompt, snapshot) => {
      calls.push({ target: 'chapter-single', prompt: renderedPrompt, snapshot })
      return true
    },
    useBatchPrompt: (_prompt, renderedPrompt, snapshot) => {
      calls.push({ target: 'chapter-batch', prompt: renderedPrompt, snapshot })
      return true
    },
  },
  notify,
  writeText: async text => {
    if (rejectCopy) throw new Error('clipboard unavailable')
    copied.push(text)
  },
})

const templates: Record<string, PromptTemplate> = {
  character: {
    id: 101,
    title: '人物',
    category: 'character',
    content: '{小说标题}/{姓名}/{性别}/{年龄}/{角色定位}/{职业设定}',
  },
  batchCharacter: {
    id: 102,
    title: '批量人物',
    category: 'character',
    content: '{小说标题}/{小说类型}/{生成数量}/{角色类型}/{特殊要求}',
  },
  world: {
    id: 103,
    title: '世界观',
    category: 'worldview',
    content: '{小说标题}/{生成数量}/{设定类型}/{特殊要求}',
  },
  single: {
    id: 104,
    title: '单章',
    category: 'outline',
    content: '{小说标题}/{章节标题}/{情节要求}/{模板类型}/{已有章节}',
  },
  batch: {
    id: 105,
    title: '批量章节',
    category: 'outline',
    content: '{小说标题}/{生成章节数量}/{情节要求}/{模板类型}/{已有章节}',
  },
}

orchestration.openCharacterPromptSelector()
assert.equal(orchestration.promptPickerTarget.value, PROMPT_PICKER_TARGET.CHARACTER_EDIT)
assert.equal(orchestration.selectedPromptCategory.value, 'character')
assert.equal(orchestration.selectPrompt(templates.character), true)
assert.match(orchestration.pickerFinalPrompt.value, /雾城\/林砚\/男\/29\/配角\/\{职业设定\}/)
characterForm.value.name = '周弥'
assert.match(orchestration.pickerFinalPrompt.value, /雾城\/周弥/)
await orchestration.copyPromptToClipboard()
assert.equal(copied.at(-1), orchestration.pickerFinalPrompt.value)
assert.equal(orchestration.useSelectedPrompt(), true)
assert.equal(calls.at(-1)?.target, 'character-edit')
assert.equal(calls.at(-1)?.snapshot.novelId, 7)
assert.ok(Object.isFrozen(calls.at(-1)?.snapshot))

orchestration.openBatchCharacterPromptSelector()
orchestration.selectPrompt(templates.batchCharacter)
assert.match(orchestration.pickerFinalPrompt.value, /都市言情\/4\/主角、次要角色\/姓名不要重复/)
batchCharacterConfig.value.count = 6
assert.match(orchestration.pickerFinalPrompt.value, /都市言情\/6\/主角、次要角色/)
assert.equal(orchestration.useSelectedPrompt(), true)
assert.equal(calls.at(-1)?.target, 'character-batch')

orchestration.openWorldSettingPromptSelector()
orchestration.selectPrompt(templates.world)
assert.match(orchestration.pickerFinalPrompt.value, /雾城\/2\/地理环境、历史背景\/规则应可验证/)
worldConfig.value.includeCulture = true
assert.match(orchestration.pickerFinalPrompt.value, /地理环境、文化社会、历史背景/)
assert.equal(orchestration.useSelectedPrompt(), true)
assert.equal(calls.at(-1)?.target, 'world-batch')

orchestration.selectPromptForSingleChapter()
orchestration.selectPrompt(templates.single)
assert.match(orchestration.pickerFinalPrompt.value, /第三章 旧钟\/发现时间线矛盾\/转折剧情模板/)
assert.match(orchestration.pickerPromptVariables.value['已有章节'], /第2章《空房》/)
singleForm.value.title = '第三章 停摆'
chapters.value.push({ id: 3, title: '暗门', description: '发现地下通道', wordCount: 900 })
assert.match(orchestration.pickerFinalPrompt.value, /第三章 停摆/)
assert.match(orchestration.pickerPromptVariables.value['已有章节'], /第3章《暗门》/)
const singleSnapshot = orchestration.createSelectionSnapshot()
assert.equal(singleSnapshot?.chapters.length, 3)
assert.ok(Object.isFrozen(singleSnapshot?.chapters))
assert.equal(orchestration.useSelectedPrompt(), true)
assert.equal(calls.at(-1)?.target, 'chapter-single')

orchestration.selectPromptForBatchChapter()
orchestration.selectPrompt(templates.batch)
assert.match(orchestration.pickerFinalPrompt.value, /雾城\/3\/逐步揭示幕后组织\/通用章节模板/)
batchForm.value.count = 5
assert.match(orchestration.pickerFinalPrompt.value, /雾城\/5/)
assert.equal(orchestration.useSelectedPrompt(), true)
assert.equal(calls.at(-1)?.target, 'chapter-batch')
assert.equal(calls.length, 5)
console.log('✓ 五类提示词路由：变量填充、表单与章节同步、生成目标回调')

orchestration.selectPromptForSingleChapter()
orchestration.selectPrompt(templates.single)
currentNovel.value.title = '雾城新版'
assert.match(orchestration.pickerFinalPrompt.value, /雾城新版/)
currentNovel.value = { ...currentNovel.value }
assert.equal(orchestration.showPromptDialog.value, false)
assert.equal(orchestration.pickerSelectedPrompt.value, null)

orchestration.selectPromptForSingleChapter()
orchestration.selectPrompt(templates.single)
currentNovel.value.id = 8
assert.equal(orchestration.showPromptDialog.value, false)
currentNovel.value = { ...currentNovel.value, id: 7 }

orchestration.selectPromptForBatchChapter()
orchestration.selectPrompt(templates.batch)
chapters.value = [...chapters.value]
assert.equal(orchestration.showPromptDialog.value, false)
assert.equal(orchestration.createSelectionSnapshot(), null)
assert.equal(orchestration.useSelectedPrompt(), false)
assert.equal(notifications.warning.at(-1), '请选择提示词并填充变量')
console.log('✓ 项目作用域：同 ID 小说重载与章节集合替换都会废弃旧选择')

orchestration.openBatchCharacterPromptSelector()
orchestration.selectPrompt(templates.batchCharacter)
rejectCopy = true
assert.equal(await orchestration.copyPromptToClipboard(), false)
assert.equal(notifications.error.at(-1), '复制失败')
console.log('✓ 提示词复制：成功与失败回调均有确定结果')

console.log('\n=== WRITER PROMPT ORCHESTRATION TESTS PASSED ===')
