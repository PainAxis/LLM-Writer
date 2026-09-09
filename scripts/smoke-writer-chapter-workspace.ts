import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'
import { useChapterContentWorkspace } from '../src/composables/useChapterContentWorkspace'
import type {
  PromptTemplate,
  WriterChapter,
  WriterCharacter,
  WriterCorpusItem,
  WriterEvent,
  WriterNovel,
  WriterWorldSetting,
} from '../src/types/writer'

const currentNovel = ref<WriterNovel | null>({ id: 1, title: '雾港纪事' })
const chapters = ref<WriterChapter[]>([
  { id: 11, title: '潮声', description: '沈砚抵达雾港', content: '<p>第一章&nbsp;正文</p>' },
  { id: 12, title: '空章', description: '', content: '' },
  { id: 13, title: '灯塔', description: '灯塔熄灭', content: `<p>${'旧日线索'.repeat(140)}</p>` },
  { id: 14, title: '议会', description: '参加司灯议会' },
  { id: 15, title: '未来', description: '尚未发生', content: '<p>未来正文</p>' },
])
const characters = ref<WriterCharacter[]>([
  { id: 21, name: '沈砚', role: 'protagonist', personality: '克制而敏锐' },
])
const worldSettings = ref<WriterWorldSetting[]>([
  { id: 31, title: '雾港', description: '终年被潮雾笼罩' },
])
const corpusData = ref<WriterCorpusItem[]>([
  { id: 41, title: '航海笔记', content: '潮线每天向北移动。' },
])
const events = ref<WriterEvent[]>([
  { id: 51, title: '灯塔熄灭', chapter: 3, description: '港口失去航标', time: '午夜' },
])

const workspace = useChapterContentWorkspace({
  currentNovel,
  chapters,
  characters,
  worldSettings,
  corpusData,
  events,
})

workspace.open(chapters.value[3])
assert.equal(workspace.visible.value, true)
assert.equal(workspace.targetChapterId.value, 14)
assert.deepEqual(workspace.availableContextChapters.value.map(chapter => chapter.id), [11, 13])
assert.deepEqual(workspace.selectedContextChapterIds.value, [11, 13])
assert.ok(workspace.availableContextChapters.value.every(chapter => chapter.id !== 14 && chapter.id !== 15))
console.log('✓ 打开工作区仅初始化目标章之前最近两个有效章节')

workspace.selectedContextChapterIds.value = [15, 11, 14, 11, 999]
assert.deepEqual(workspace.selectedContextChapterIds.value, [11])
workspace.toggleContextChapter(15)
assert.deepEqual(workspace.selectedContextChapterIds.value, [11])
workspace.selectAllContextChapters()
assert.deepEqual(workspace.selectedContextChapterIds.value, [11, 13])
console.log('✓ v-model 与操作入口都会剔除目标章、未来章、重复和未知 ID')

workspace.clearContextSelection()
workspace.generateConfig.value.wordCount = 3200
chapters.value[1].description = '后来补写的大纲'
assert.deepEqual(workspace.selectedContextChapterIds.value, [])
console.log('✓ 用户清空上下文后，配置或章节变化不会偷偷恢复默认选择')

const prompt: PromptTemplate = {
  id: 61,
  title: '全素材模板',
  category: 'content',
  content: [
    '{小说标题}/{章节标题}/{章节大纲}',
    '{目标字数}/{写作视角}/{重点内容}',
    '{主要人物}',
    '{世界观设定}',
    '{参考语料}',
    '{事件线}',
    '{前文概要}',
    '{自定义要求}',
  ].join('\n'),
}

workspace.selectPrompt(prompt)
assert.equal(workspace.promptVariables.value.小说标题, '雾港纪事')
assert.equal(workspace.promptVariables.value.章节标题, '议会')
assert.equal(workspace.promptVariables.value.目标字数, '3200')
assert.equal(workspace.promptVariables.value.前文概要, '')
assert.equal(workspace.promptVariables.value.自定义要求, '')

workspace.toggleMaterial('characters', characters.value[0])
workspace.selectAllMaterials('worldSettings')
workspace.selectAllMaterials('corpus')
workspace.selectAllMaterials('events')
workspace.toggleContextChapter(13)
assert.match(workspace.promptVariables.value.主要人物, /沈砚（protagonist）：克制而敏锐/)
assert.match(workspace.promptVariables.value.世界观设定, /雾港：终年被潮雾笼罩/)
assert.match(workspace.promptVariables.value.参考语料, /【航海笔记】潮线每天向北移动/)
assert.match(workspace.promptVariables.value.事件线, /灯塔熄灭（第3章）：港口失去航标，时间：午夜/)
assert.match(workspace.promptVariables.value.前文概要, /第3章《灯塔》/)
assert.match(workspace.promptVariables.value.前文概要, /章节内容：旧日线索/)
assert.match(workspace.promptVariables.value.前文概要, /\.\.\.$/)
assert.match(workspace.finalPrompt.value, /雾港纪事\/议会\/参加司灯议会/)
assert.match(workspace.finalPrompt.value, /\{自定义要求\}/)
assert.deepEqual(Object.keys(workspace.selectedMaterials.value).sort(), [
  'characters', 'corpus', 'events', 'worldSettings',
])
console.log('✓ 四类素材与唯一上下文 ID 同步填充模板，不保存章节副本')

workspace.selectedMaterials.value.corpus.push({
  id: 42,
  title: '推荐语料',
  content: '由当前推荐逻辑直接合并。',
})
assert.match(workspace.promptVariables.value.参考语料, /【推荐语料】由当前推荐逻辑直接合并/)
console.log('✓ 兼容现有语料推荐逻辑对选中数组的直接合并')

workspace.promptVariables.value.自定义要求 = '保留伏笔'
workspace.generateConfig.value.style = 'first-person'
workspace.generateConfig.value.focus = '揭示议长的谎言'
currentNovel.value!.title = '新雾港'
assert.equal(workspace.promptVariables.value.自定义要求, '保留伏笔')
assert.equal(workspace.promptVariables.value.写作视角, '第一人称')
assert.equal(workspace.promptVariables.value.重点内容, '揭示议长的谎言')
assert.match(workspace.finalPrompt.value, /新雾港/)
assert.match(workspace.finalPrompt.value, /保留伏笔/)
console.log('✓ 输入和配置变化重算自动变量，同时保留用户自定义变量')

const snapshot = workspace.createSnapshot()
assert.ok(snapshot)
workspace.generateConfig.value.wordCount = 888
workspace.selectedMaterials.value.characters[0].name = '已变化'
chapters.value[2].content = '上下文已变化'
currentNovel.value!.title = '小说名已变化'
workspace.clearContextSelection()
assert.equal(snapshot.config.wordCount, 3200)
assert.equal(snapshot.materials.characters[0].name, '沈砚')
assert.deepEqual(snapshot.contextChapters.map(chapter => chapter.id), [13])
assert.match(snapshot.contextChapters[0].content ?? '', /旧日线索/)
assert.equal(snapshot.novel.title, '新雾港')
assert.equal(snapshot.characterNamesById[21], '沈砚')
assert.match(snapshot.prompt, /保留伏笔/)
console.log('✓ 生成快照与后续工作区变化隔离，可安全跨章节切换')

workspace.clearAllSelections()
assert.deepEqual(workspace.selectedContextChapterIds.value, [])
assert.equal(workspace.promptVariables.value.前文概要, '')
assert.ok(Object.values(workspace.selectedMaterials.value).every(items => items.length === 0))
workspace.clearPrompt()
assert.equal(workspace.selectedPrompt.value, null)
assert.equal(workspace.finalPrompt.value, '')

workspace.selectPrompt(prompt)
workspace.selectedContentCategory.value = 'content-dialogue'
assert.equal(workspace.selectedPrompt.value, null)
assert.equal(workspace.finalPrompt.value, '')
console.log('✓ 切换正文分类会清除不可见的旧分类模板')

workspace.open(chapters.value[2])
assert.deepEqual(workspace.selectedContextChapterIds.value, [11, 12])
workspace.reset()
assert.equal(workspace.targetChapter.value, null)
assert.equal(workspace.visible.value, false)
console.log('✓ 只有再次 open 新目标章时才重新初始化最近上下文，reset 完整收口状态')

const source = readFileSync(
  new URL('../src/composables/useChapterContentWorkspace.ts', import.meta.url),
  'utf8',
)
assert.doesNotMatch(source, /element-plus|vue-router|@\/services\/api|useAIStream/)
console.log('✓ 工作区保持纯同步边界，不依赖 UI、路由、AI 或持久化')

console.log('\n=== WRITER CHAPTER WORKSPACE TESTS PASSED ===')
