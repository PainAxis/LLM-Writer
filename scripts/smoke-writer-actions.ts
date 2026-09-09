/** Writer.vue wiring plus project-backed chapter-content actions. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectScope, reactive, ref } from 'vue'
import { useWriterChapterContentGeneration } from '../src/composables/useWriterChapterContentGeneration'
import { useWriterProject, type WriterNovel } from '../src/composables/useWriterProject'
import type { PromptTemplate } from '../src/types/writer'

const writerSource = readFileSync(
  new URL('../src/views/Writer.vue', import.meta.url),
  'utf8',
)

const controllerAliases = [
  'openChapterGenerateDialog = chapterContentGeneration.open',
  'generateFromOutline = chapterContentGeneration.openFromOutline',
  'autoFillVariables = chapterContentGeneration.autoFillVariables',
  'toggleMaterial = chapterContentGeneration.toggleMaterial',
  'selectPromptForChapter = chapterContentGeneration.selectPrompt',
  'recommendCorpusForContext = chapterContentGeneration.recommendCorpusForContext',
  'availableContextChapters = chapterContentGeneration.availableContextChapters',
  'toggleContextChapter = chapterContentGeneration.toggleContextChapter',
  'clearContextSelection = chapterContentGeneration.clearContextSelection',
  'selectAllContextChapters = chapterContentGeneration.selectAllContextChapters',
  'clearAllMaterials = chapterContentGeneration.clearAllMaterials',
  'selectAllMaterials = chapterContentGeneration.selectAllMaterials',
  'generateChapterContentWithDialog = chapterContentGeneration.generateChapterContentWithDialog',
]
for (const alias of controllerAliases) {
  assert.ok(writerSource.includes(alias), `Writer.vue 必须由正文 controller 提供：${alias}`)
}
assert.match(writerSource, /<ChapterGenerateDialog[\s\S]*?@generate="generateChapterContentWithDialog"/)
assert.match(writerSource, /<ChapterPanel[\s\S]*?@generate="openChapterGenerateDialog"/)
assert.match(
  writerSource,
  /registerScope\('chapterContent',[\s\S]*?reset: chapterContentGeneration\.reset/,
)
assert.match(
  writerSource,
  /if \(chapterContentGeneration\.isBusy\.value[\s\S]*?chapterContentGeneration\.cancel\(\)/,
)
assert.match(
  writerSource,
  /isExpectedChapterSelection\(currentChapter\.value\)\) return/,
)
assert.doesNotMatch(writerSource, /chapterContentLaunch|writerOperation|cancelWriterStream/)

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
  const streamingContent = ref('')
  const isStreaming = ref(false)
  const requests: Array<{
    prompt: string
    resolve(value: string): void
    reject(reason?: unknown): void
  }> = []
  return {
    streamingContent,
    isStreaming,
    requests,
    reset() {
      streamingContent.value = ''
      isStreaming.value = false
    },
    generate(promptText: string) {
      const request = deferred<string>()
      requests.push({ prompt: promptText, resolve: request.resolve, reject: request.reject })
      isStreaming.value = true
      return request.promise.then(
        (value) => {
          isStreaming.value = false
          streamingContent.value = value
          return value
        },
        (error: unknown) => {
          isStreaming.value = false
          throw error
        },
      )
    },
  }
}

const prompt: PromptTemplate = {
  id: 7,
  title: '动作测试模板',
  category: 'content',
  content: '{章节标题}|{目标字数}|{主要人物}|{参考语料}|{前文概要}|{自定义要求}',
}

async function fixture() {
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  let disk: WriterNovel[] = [{
    id: 1,
    title: '测试小说',
    characters: [{ id: 701, name: '人物-X' }],
    worldSettings: [{ id: 702, title: '世界-X' }],
    corpusData: [{ id: 703, title: '语料-X任选', content: '内容-X' }],
    events: [{ id: 704, title: '事件-X' }],
    chapterList: [
      {
        id: 100,
        title: '第一章',
        description: '前文概要-X',
        content: '<p>原始正文</p>',
        status: 'draft',
      },
      {
        id: 101,
        title: '第二章',
        description: '目标大纲-X',
        content: '<p>第二章旧正文</p>',
        status: 'draft',
      },
    ],
  }]
  let delayGate: ReturnType<typeof deferred<void>> | null = null
  let delayStarted: ReturnType<typeof deferred<void>> | null = null
  let delayOnce = false
  let failOnce = false
  const projectMessages: string[] = []
  const novelStore = reactive({ worldSettings: [] as any[] })
  const project = useWriterProject({
    novelStore,
    notifyError: message => projectMessages.push(message),
    persistence: {
      load: () => clone(disk),
      save: async (novels) => {
        if (failOnce) {
          failOnce = false
          throw new Error('模拟保存失败')
        }
        if (delayOnce) {
          delayOnce = false
          const gate = delayGate
          delayStarted?.resolve()
          assert.ok(gate)
          await gate.promise
        }
        disk = clone(novels)
      },
    },
  })
  assert.equal(await project.initNovel('1'), true)

  const stream = fakeStream()
  const messages: string[] = []
  const scope = effectScope()
  const controller = scope.run(() => useWriterChapterContentGeneration({
    currentNovel: project.currentNovel,
    chapters: project.chapters,
    currentChapter: project.currentChapter,
    content: project.content,
    hasUnsavedChanges: project.hasUnsavedChanges,
    characters: project.characters,
    worldSettings: project.worldSettings,
    corpusData: project.corpusData,
    events: project.events,
    prepare: () => true,
    selectChapter: project.selectChapter,
    persist: project.saveCurrentChapter,
    notify: {
      success: message => messages.push(`success:${message}`),
      info: notice => messages.push(`info:${typeof notice === 'string' ? notice : notice.message}`),
      warning: message => messages.push(`warning:${message}`),
      error: message => messages.push(`error:${message}`),
    },
    stream,
    buildPrompt: snapshot => ({
      prompt: [
        snapshot.chapter.title,
        snapshot.config.wordCount,
        snapshot.config.focus,
        snapshot.materials.characters[0]?.name ?? '-',
        snapshot.materials.worldSettings[0]?.title ?? '-',
        snapshot.materials.corpus[0]?.title ?? '-',
        snapshot.materials.events[0]?.title ?? '-',
        snapshot.contextChapters[0]?.title ?? '-',
        snapshot.prompt,
      ].join(':'),
      contextLabels: [],
    }),
    formatContent: response => `<p>${response}</p>`,
  }))
  assert.ok(controller)

  const configureDialog = (chapterIndex: number) => {
    assert.equal(controller.open(project.chapters.value[chapterIndex]), true)
    controller.selectPrompt(prompt)
    controller.promptVariables.value.自定义要求 = '要求-X'
    controller.generateConfig.value = {
      wordCount: 3333,
      style: 'first-person',
      focus: '焦点-X',
    }
    controller.selectAllMaterials('characters')
    controller.selectAllMaterials('worldSettings')
    controller.selectAllMaterials('corpus')
    controller.selectAllMaterials('events')
  }

  return {
    project,
    controller,
    stream,
    messages,
    projectMessages,
    configureDialog,
    disk: () => disk,
    failNextSave: () => { failOnce = true },
    delayNextSave: () => {
      delayOnce = true
      delayGate = deferred<void>()
      delayStarted = deferred<void>()
      return delayStarted.promise
    },
    releaseSave: () => {
      assert.ok(delayGate)
      delayGate.resolve()
      delayGate = null
      delayStarted = null
    },
    close: () => {
      controller.dispose()
      scope.stop()
      void project.dispose()
    },
  }
}

async function flushUntil(predicate: () => boolean) {
  for (let turn = 0; turn < 20 && !predicate(); turn += 1) await Promise.resolve()
  assert.equal(predicate(), true)
}

async function testDialogActionWaitsForProjectSelection() {
  const f = await fixture()
  f.configureDialog(1)
  const saveStarted = f.delayNextSave()
  const generation = f.controller.generateChapterContentWithDialog()

  await saveStarted
  assert.equal(f.project.currentChapter.value?.id, 100)
  assert.equal(f.stream.requests.length, 0, '旧章保存完成前不得开始正文请求')
  assert.equal(f.controller.isExpectedChapterSelection(f.project.chapters.value[1]), true)

  // Snapshot values must survive later dialog mutations while selection is pending.
  f.controller.generateConfig.value.wordCount = 999
  f.project.characters.value[0].name = '后来改名'
  f.releaseSave()
  await flushUntil(() => f.stream.requests.length === 1)

  assert.equal(f.project.currentChapter.value?.id, 101)
  assert.match(
    f.stream.requests[0].prompt,
    /^第二章:3333:焦点-X:人物-X:世界-X:语料-X任选:事件-X:第一章:/,
  )
  f.stream.requests[0].resolve('完整新正文')
  assert.equal(await generation, true)
  assert.equal(f.project.content.value, '<p>完整新正文</p>')
  assert.equal(f.disk()[0].chapterList?.[1].content, '<p>完整新正文</p>')
  assert.ok(f.messages.includes('success:正文生成成功'))
  f.close()
  console.log('✓ 页面动作经真实 controller 等待旧章落盘，再用冻结快照生成目标章')
}

async function testSelectionPersistenceSignal() {
  const stale = await fixture()
  const saveStarted = stale.delayNextSave()
  let current = true
  const persisted: boolean[] = []
  const selection = stale.project.selectChapter(stale.project.chapters.value[1], {
    isCurrent: () => current,
    onPersisted: saved => persisted.push(saved),
  })
  await saveStarted
  current = false
  stale.releaseSave()
  assert.equal(await selection, false)
  assert.deepEqual(persisted, [true], 'stale intent 与保存成功必须分开报告')
  assert.equal(stale.project.currentChapter.value?.id, 100)
  stale.close()

  const failed = await fixture()
  failed.failNextSave()
  const failedPersistence: boolean[] = []
  assert.equal(await failed.project.selectChapter(failed.project.chapters.value[1], {
    onPersisted: saved => failedPersistence.push(saved),
  }), false)
  assert.deepEqual(failedPersistence, [false])
  assert.equal(failed.project.currentChapter.value?.id, 100)
  assert.equal(failed.projectMessages.length, 1)
  failed.close()
  console.log('✓ project selection 分别报告“已保存但 intent 失效”与“保存失败”')
}

async function testGeneratedContentSaveFailureIsRecoverable() {
  const f = await fixture()
  f.configureDialog(0)
  f.failNextSave()
  const generation = f.controller.generateChapterContentWithDialog()
  assert.equal(f.stream.requests.length, 1)
  f.stream.requests[0].resolve('已生成但未保存')

  assert.equal(await generation, false)
  assert.equal(f.project.content.value, '<p>已生成但未保存</p>')
  assert.equal(f.project.hasUnsavedChanges.value, true)
  assert.equal(f.disk()[0].chapterList?.[0].content, '<p>原始正文</p>')
  assert.equal(f.projectMessages.length, 1)
  assert.equal(f.messages.includes('success:正文生成成功'), false)

  assert.equal(await f.project.saveCurrentChapter(), true)
  assert.equal(f.disk()[0].chapterList?.[0].content, '<p>已生成但未保存</p>')
  f.close()
  console.log('✓ 正文落盘失败时保留可重试编辑状态，不误报成功')
}

async function main() {
  await testDialogActionWaitsForProjectSelection()
  await testSelectionPersistenceSignal()
  await testGeneratedContentSaveFailureIsRecoverable()
  console.log('\n=== ALL WRITER-ACTIONS TESTS PASSED ===')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
