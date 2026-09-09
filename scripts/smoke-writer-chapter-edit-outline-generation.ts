import assert from 'node:assert/strict'
import { ref, watch } from 'vue'
import { useWriterChapterEditOutlineGeneration } from '../src/composables/useWriterChapterEditOutlineGeneration'
import { AIRequestCancelledError } from '../src/utils/aiRequestScope'
import {
  buildChapterOutlinePrompt,
  createChapterOutlinePromptSnapshot,
} from '../src/utils/writer/chapterOutlinePrompts'
import type { GenerateOptions, StreamCallback } from '../src/types/api'
import type {
  WriterChapter,
  WriterChapterForm,
  WriterCharacter,
  WriterNovel,
  WriterWorldSetting,
} from '../src/types/writer'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function fakeStream() {
  const requests: Array<{
    prompt: string
    options: GenerateOptions
    callback: StreamCallback | null
    resolve(value: string): void
    reject(reason?: unknown): void
  }> = []
  let stops = 0

  return {
    requests,
    stopCount: () => stops,
    generate(
      prompt: string,
      options: GenerateOptions = {},
      callback: StreamCallback | null = null,
    ) {
      const request = deferred<string>()
      requests.push({
        prompt,
        options,
        callback,
        resolve: request.resolve,
        reject: request.reject,
      })
      return request.promise
    },
    stop() {
      stops += 1
    },
  }
}

const novel = (): WriterNovel => ({
  id: 7,
  title: '雾海纪',
  genre: 'fantasy',
  description: '灯塔熄灭后的群岛。',
})

const chapterList = (): WriterChapter[] => [
  { id: 1, title: '潮汐', description: '船队抵达港口', wordCount: 1200 },
  { id: 2, title: '熄灯', description: '守塔人离奇失踪', wordCount: 900 },
  { id: 3, title: '议会', description: '议会追查真相', wordCount: 500 },
]

const characterList = (): WriterCharacter[] => [
  { id: 1, name: '沈砚', role: 'protagonist' },
  { id: 2, name: '顾潮', role: 'antagonist' },
]

const worldSettingList = (): WriterWorldSetting[] => [
  { id: 1, title: '倒流潮汐', description: '每夜倒流' },
]

const chapterForm = (): WriterChapterForm => ({
  title: '议会之夜',
  description: '用户原有大纲',
  status: 'draft',
})

function fixture(options: { editing?: boolean; apiReady?: boolean } = {}) {
  const currentNovel = ref<WriterNovel | null>(novel())
  const chapters = ref(chapterList())
  const characters = ref(characterList())
  const worldSettings = ref(worldSettingList())
  const form = ref(chapterForm())
  const editingChapter = ref<WriterChapter | null>(
    options.editing === false ? null : chapters.value[2],
  )
  const visible = ref(true)
  const stream = fakeStream()
  const messages: string[] = []
  const controller = useWriterChapterEditOutlineGeneration({
    currentNovel,
    chapters,
    characters,
    worldSettings,
    form,
    editingChapter,
    visible,
    ensureApiReady: () => options.apiReady ?? true,
    stream,
    notify: {
      success: message => messages.push(`success:${message}`),
      warning: message => messages.push(`warning:${message}`),
      error: message => messages.push(`error:${message}`),
    },
  })

  return {
    controller,
    currentNovel,
    chapters,
    characters,
    worldSettings,
    form,
    editingChapter,
    visible,
    stream,
    messages,
  }
}

async function testAtomicSuccessAndDefaultPrompt() {
  const f = fixture()
  const originalForm = f.form.value
  let replacements = 0
  watch(f.form, () => { replacements += 1 }, { flush: 'sync' })

  const generation = f.controller.generate()
  const request = f.stream.requests[0]
  const expectedPrompt = buildChapterOutlinePrompt(createChapterOutlinePromptSnapshot({
    novel: f.currentNovel.value,
    form: originalForm,
    chapters: f.chapters.value.slice(0, 2),
    characters: f.characters.value,
    worldSettings: f.worldSettings.value,
  }))

  assert.equal(request.prompt, expectedPrompt)
  assert.equal(request.options.type, 'outline')
  assert.equal(request.options.maxTokens, null)
  assert.equal(request.options.temperature, 0.8)
  assert.ok(!request.prompt.includes('议会追查真相'), '编辑章节不能把自身或后文章节作为前文')

  request.callback?.('第一段', '第一段：港口封锁')
  request.callback?.('第二段', '第一段：港口封锁\n第二段：议员倒戈')
  assert.equal(f.controller.preview.value, '第一段：港口封锁\n第二段：议员倒戈')
  assert.strictEqual(f.form.value, originalForm)
  assert.equal(f.form.value.description, '用户原有大纲')
  assert.equal(replacements, 0)

  const finalOutline = '第一段：港口封锁\n第二段：议员倒戈\n第三段：灯塔重燃'
  request.resolve(finalOutline)
  assert.equal(await generation, true)
  assert.equal(replacements, 1)
  assert.notStrictEqual(f.form.value, originalForm)
  assert.deepEqual(f.form.value, { ...chapterForm(), description: finalOutline })
  assert.equal(f.controller.preview.value, finalOutline)
  assert.equal(f.controller.isGenerating.value, false)
  assert.deepEqual(f.messages, ['success:章节大纲生成成功'])
  console.log('✓ 默认提示词使用前文章节快照，chunk 仅进预览，完整结果原子写入一次')
}

async function testUserEditPermanentlyInvalidatesRequest() {
  const f = fixture()
  const generation = f.controller.generate()
  const request = f.stream.requests[0]
  request.callback?.('旧', '旧请求预览')

  f.form.value.description = '用户生成期间手工修改'
  f.form.value.description = '用户原有大纲'
  assert.equal(f.controller.isGenerating.value, false)
  assert.equal(f.controller.preview.value, '')
  assert.equal(f.stream.stopCount(), 1)

  request.callback?.('迟到', '迟到的旧预览')
  request.resolve('迟到的完整结果')
  assert.equal(await generation, false)
  assert.equal(f.form.value.description, '用户原有大纲')
  assert.deepEqual(f.messages, [])
  console.log('✓ 用户中途编辑即永久作废请求，改回原值也不能恢复旧结果权限')
}

async function testFormAndEditingChapterReplacement() {
  const replacedForm = fixture()
  const formGeneration = replacedForm.controller.generate()
  const replacement = { ...chapterForm(), title: '另一个草稿' }
  replacedForm.form.value = replacement
  replacedForm.stream.requests[0].resolve('不能写入新草稿')
  assert.equal(await formGeneration, false)
  assert.deepEqual(replacedForm.form.value, replacement)
  assert.equal(replacedForm.form.value.description, '用户原有大纲')

  const replacedChapter = fixture()
  const chapterGeneration = replacedChapter.controller.generate()
  replacedChapter.editingChapter.value = { ...replacedChapter.chapters.value[2] }
  replacedChapter.stream.requests[0].resolve('不能串入另一个编辑会话')
  assert.equal(await chapterGeneration, false)
  assert.equal(replacedChapter.form.value.description, '用户原有大纲')
  assert.equal(replacedChapter.stream.stopCount(), 1)
  console.log('✓ 表单或 editingChapter 对象替换都会隔离迟到结果')
}

async function testNovelDialogAndContextRaces() {
  const reloadedNovel = fixture()
  const novelGeneration = reloadedNovel.controller.generate()
  reloadedNovel.currentNovel.value = { ...novel(), title: '同 ID 的重新加载小说' }
  reloadedNovel.stream.requests[0].resolve('不能跨项目写入')
  assert.equal(await novelGeneration, false)
  assert.equal(reloadedNovel.form.value.description, '用户原有大纲')

  const closed = fixture()
  const closeGeneration = closed.controller.generate()
  closed.visible.value = false
  closed.visible.value = true
  closed.stream.requests[0].resolve('不能写入重新打开的对话框')
  assert.equal(await closeGeneration, false)
  assert.equal(closed.form.value.description, '用户原有大纲')
  assert.equal(closed.stream.stopCount(), 1)

  const changedContext = fixture()
  const contextGeneration = changedContext.controller.generate()
  changedContext.characters.value[0].role = 'supporting'
  changedContext.characters.value[0].role = 'protagonist'
  changedContext.stream.requests[0].resolve('不能使用过期人物上下文')
  assert.equal(await contextGeneration, false)
  assert.equal(changedContext.form.value.description, '用户原有大纲')
  assert.equal(changedContext.stream.stopCount(), 1)
  console.log('✓ 同 ID 项目重载、关闭重开及上下文改动均会永久作废旧请求')
}

async function testIndependentCancelAndSupersession() {
  const cancelled = fixture()
  const cancelledGeneration = cancelled.controller.generate()
  cancelled.stream.requests[0].callback?.('半', '半成品')
  cancelled.controller.cancel()
  cancelled.stream.requests[0].reject(new AIRequestCancelledError('半成品'))
  assert.equal(await cancelledGeneration, false)
  assert.equal(cancelled.form.value.description, '用户原有大纲')
  assert.equal(cancelled.controller.preview.value, '')
  assert.equal(cancelled.stream.stopCount(), 1)
  assert.deepEqual(cancelled.messages, [])

  const superseded = fixture()
  const first = superseded.controller.generate()
  const firstRequest = superseded.stream.requests[0]
  const second = superseded.controller.generate()
  const secondRequest = superseded.stream.requests[1]
  firstRequest.callback?.('旧', '迟到旧预览')
  firstRequest.resolve('旧完整结果')
  assert.equal(await first, false)
  assert.equal(superseded.controller.isGenerating.value, true)
  secondRequest.resolve('新完整结果')
  assert.equal(await second, true)
  assert.equal(superseded.form.value.description, '新完整结果')
  assert.equal(superseded.stream.stopCount(), 1)
  assert.deepEqual(superseded.messages, ['success:章节大纲生成成功'])
  console.log('✓ 独立取消及请求接管可屏蔽旧 chunk、旧完成值与旧 finally')
}

async function testValidationAndFailure() {
  const apiUnavailable = fixture({ apiReady: false })
  assert.equal(await apiUnavailable.controller.generate(), false)
  assert.equal(apiUnavailable.stream.requests.length, 0)

  const hidden = fixture()
  hidden.visible.value = false
  assert.equal(await hidden.controller.generate(), false)
  assert.deepEqual(hidden.messages, ['warning:章节编辑对话框已关闭，请重新打开后再生成'])

  const failed = fixture({ editing: false })
  const generation = failed.controller.generate()
  assert.ok(
    failed.stream.requests[0].prompt.includes('第3章：议会 - 议会追查真相'),
    '新增章节应使用全部已有章节作为上下文',
  )
  failed.stream.requests[0].reject(new Error('网络断开'))
  assert.equal(await generation, false)
  assert.equal(failed.form.value.description, '用户原有大纲')
  assert.deepEqual(failed.messages, ['error:大纲生成失败: 网络断开'])
  console.log('✓ 前置校验、创建态上下文与请求失败路径保持表单完整')
}

async function main() {
  await testAtomicSuccessAndDefaultPrompt()
  await testUserEditPermanentlyInvalidatesRequest()
  await testFormAndEditingChapterReplacement()
  await testNovelDialogAndContextRaces()
  await testIndependentCancelAndSupersession()
  await testValidationAndFailure()
  console.log('\n=== WRITER CHAPTER EDIT OUTLINE GENERATION TESTS PASSED ===')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
