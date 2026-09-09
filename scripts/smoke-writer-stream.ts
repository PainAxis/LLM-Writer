/** Writer chapter-content races against the real project and request scope. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectScope, reactive, ref } from 'vue'
import { useWriterChapterContentGeneration } from '../src/composables/useWriterChapterContentGeneration'
import { useWriterProject, type WriterNovel } from '../src/composables/useWriterProject'
import type { StreamCallback } from '../src/types/api'
import type { PromptTemplate } from '../src/types/writer'
import { createAIRequestScope } from '../src/utils/aiRequestScope'

const writerSource = readFileSync(
  new URL('../src/views/Writer.vue', import.meta.url),
  'utf8',
)

assert.match(writerSource, /useWriterChapterContentGeneration/)
assert.match(
  writerSource,
  /const chapterContentGeneration\s*=\s*useWriterChapterContentGeneration\s*\(\s*\{/,
)
assert.match(writerSource, /stream:\s*useAIStream\(\)/)
assert.match(
  writerSource,
  /const isGeneratingContent\s*=\s*chapterContentGeneration\.isBusy/,
)
assert.match(
  writerSource,
  /chapterContentGeneration\.isExpectedChapterSelection\(currentChapter\.value\)/,
)
assert.match(
  writerSource,
  /registerBarrier\('chapterContentCommit',[\s\S]*?wait:\s*chapterContentGeneration\.waitForCommit/,
)
assert.match(writerSource, /chapterContentGeneration\.dispose\(\)/)
assert.doesNotMatch(
  writerSource,
  /const generateContentWithPrompt\s*=/,
  'Writer.vue 不应重新拥有已下沉的正文请求实现',
)

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function requestScopeFixture() {
  const streamingContent = ref('')
  const isStreaming = ref(false)
  const pending: Array<{
    signal: AbortSignal
    callback: StreamCallback | null
    resolve(value: string): void
    reject(reason?: unknown): void
  }> = []
  const requestScope = createAIRequestScope((_prompt, options, callback) => {
    const request = deferred<string>()
    pending.push({
      signal: options.signal!,
      callback,
      resolve: request.resolve,
      reject: request.reject,
    })
    return request.promise
  }, (state) => {
    streamingContent.value = state.streamingContent
    isStreaming.value = state.isStreaming
  })
  return { ...requestScope, streamingContent, isStreaming, pending }
}

const prompt: PromptTemplate = {
  id: 9,
  title: '正文回归模板',
  category: 'content',
  content: '请生成《{章节标题}》正文',
}

async function fixture() {
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
  let disk: WriterNovel[] = [{
    id: 1,
    title: '测试小说',
    chapterList: [
      { id: 1, title: 'A', content: '<p>A原文</p>', status: 'draft' },
      { id: 2, title: 'B', content: '<p>B原文</p>', status: 'draft' },
    ],
  }]
  let saveGate: ReturnType<typeof deferred<void>> | null = null
  let saveStarted: ReturnType<typeof deferred<void>> | null = null
  const projectMessages: string[] = []
  const project = useWriterProject({
    novelStore: reactive({ worldSettings: [] }),
    notifyError: message => projectMessages.push(message),
    persistence: {
      load: () => clone(disk),
      save: async (novels) => {
        if (saveGate) {
          saveStarted?.resolve()
          await saveGate.promise
        }
        disk = clone(novels)
      },
    },
  })
  assert.equal(await project.initNovel('1'), true)

  const stream = requestScopeFixture()
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
    buildPrompt: snapshot => ({ prompt: snapshot.prompt, contextLabels: [] }),
    formatContent: response => `<p>${response}</p>`,
  }))
  assert.ok(controller)

  const beginGeneration = () => {
    assert.ok(project.currentChapter.value)
    assert.equal(controller.open(project.currentChapter.value), true)
    controller.selectPrompt(prompt)
    return controller.generateChapterContentWithDialog()
  }

  // Mirrors Writer's cancellation + persistence barrier + project switch order.
  const selectChapterLikeWriter = async (chapterIndex: number) => {
    if (controller.isBusy.value && !controller.isCommitting.value) controller.cancel()
    if (!(await controller.waitForCommit())) return false
    controller.reset()
    return project.selectChapter(project.chapters.value[chapterIndex])
  }

  return {
    project,
    controller,
    stream,
    messages,
    projectMessages,
    beginGeneration,
    selectChapterLikeWriter,
    disk: () => disk,
    delaySave: () => {
      saveGate = deferred<void>()
      saveStarted = deferred<void>()
      return saveStarted.promise
    },
    releaseSave: () => {
      assert.ok(saveGate)
      saveGate.resolve()
      saveGate = null
      saveStarted = null
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

async function testChapterSwitchCancelsLateContent() {
  const f = await fixture()
  const stale = f.beginGeneration()
  assert.equal(f.stream.pending.length, 1)
  f.stream.pending[0].callback?.('半截', 'A 的半截正文')

  assert.equal(await f.selectChapterLikeWriter(1), true)
  assert.equal(f.project.currentChapter.value?.id, 2)
  assert.equal(f.project.content.value, '<p>B原文</p>')
  assert.equal(f.stream.pending[0].signal.aborted, true)

  f.stream.pending[0].callback?.('迟到', 'A 的迟到正文')
  f.stream.pending[0].resolve('A 的迟到正文')
  assert.equal(await stale, false)
  assert.equal(f.project.content.value, '<p>B原文</p>')
  assert.equal(f.disk()[0].chapterList?.[0].content, '<p>A原文</p>')
  assert.equal(f.disk()[0].chapterList?.[1].content, '<p>B原文</p>')
  assert.deepEqual(f.messages, [])
  f.close()
  console.log('✓ 真实 project + request scope：切章取消半截流，迟到正文不跨章写入')
}

async function testEditorConflictKeepsUserText() {
  const f = await fixture()
  const stale = f.beginGeneration()
  assert.equal(f.stream.pending.length, 1)

  f.project.content.value = '<p>用户在生成期间继续编辑</p>'
  f.project.onContentChange()
  assert.equal(f.stream.pending[0].signal.aborted, true)
  f.stream.pending[0].resolve('迟到的 AI 正文')

  assert.equal(await stale, false)
  assert.equal(f.project.content.value, '<p>用户在生成期间继续编辑</p>')
  assert.equal(f.disk()[0].chapterList?.[0].content, '<p>A原文</p>')
  assert.ok(f.messages.includes('warning:正文已在生成期间发生修改，已保留当前编辑内容'))
  assert.equal(await f.project.saveCurrentChapter(), true)
  assert.equal(f.disk()[0].chapterList?.[0].content, '<p>用户在生成期间继续编辑</p>')
  f.close()
  console.log('✓ 同章编辑同步作废请求，并保留用户正文直至显式保存')
}

async function testCommitBarrierUsesProjectPersistence() {
  const f = await fixture()
  const saveStarted = f.delaySave()
  const generation = f.beginGeneration()
  f.stream.pending[0].resolve('完整正文')
  await saveStarted
  await flushUntil(() => f.controller.isCommitting.value)

  const barrier = f.controller.waitForCommit()
  assert.equal(barrier, generation, '页面保存屏障必须覆盖完整正文 action')
  assert.equal(f.controller.reset(), false, '落盘期间不能清空正文工作区')
  let settled = false
  void barrier.then(() => { settled = true })
  await Promise.resolve()
  assert.equal(settled, false)

  f.releaseSave()
  assert.equal(await barrier, true)
  assert.equal(await generation, true)
  assert.equal(f.disk()[0].chapterList?.[0].content, '<p>完整正文</p>')
  assert.equal(f.controller.targetChapter.value, null, '保存完成后执行延迟 reset')
  assert.deepEqual(f.projectMessages, [])
  f.close()
  console.log('✓ 正文提交屏障等待真实 project 落盘，期间 reset 被延迟')
}

async function main() {
  await testChapterSwitchCancelsLateContent()
  await testEditorConflictKeepsUserText()
  await testCommitBarrierUsesProjectPersistence()
  console.log('\n=== WRITER STREAM TESTS PASSED ===')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
