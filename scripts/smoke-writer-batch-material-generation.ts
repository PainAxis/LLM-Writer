import assert from 'node:assert/strict'
import { ref } from 'vue'
import { useWriterBatchCharacterGeneration } from '../src/composables/useWriterBatchCharacterGeneration'
import { useWriterBatchWorldGeneration } from '../src/composables/useWriterBatchWorldGeneration'
import { createAIRequestScope, isAIRequestCancelled } from '../src/utils/aiRequestScope'
import type { GenerateOptions, StreamCallback } from '../src/types/api'
import type { PromptTemplate, WriterCharacter, WriterWorldSetting } from '../src/types/writer'

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
  const isStreaming = ref(false)
  const streamingContent = ref('')
  const requests: Array<{
    prompt: string
    options: GenerateOptions
    callback: StreamCallback | null
    signal: AbortSignal
    resolve: (value: string) => void
    reject: (reason?: unknown) => void
  }> = []
  const scope = createAIRequestScope((prompt, options, callback) => {
    const result = deferred<string>()
    requests.push({
      prompt,
      options,
      callback,
      signal: options.signal!,
      resolve: result.resolve,
      reject: result.reject,
    })
    return result.promise
  }, state => {
    isStreaming.value = state.isStreaming
    streamingContent.value = state.streamingContent
  })

  return { ...scope, isStreaming, streamingContent, requests }
}

const template: PromptTemplate = {
  id: 1,
  title: '测试模板',
  category: 'character',
  content: '测试',
}

async function testCharacterGeneration() {
  const currentNovel = ref<any>({ id: 1, title: '雾港', genre: 'history', description: '简介' })
  const stream = fakeStream()
  const messages: string[] = []
  const savedBatches: WriterCharacter[][] = []
  let saveResult = false
  let parseCalls = 0
  const parsed: WriterCharacter[] = [
    { id: 101, name: '沈砚', role: 'antagonist', selected: true },
    { id: 102, name: '阿宁', role: 'protagonist', selected: false },
  ]
  const controller = useWriterBatchCharacterGeneration({
    currentNovel,
    ensureApiReady: () => true,
    saveGeneratedCharacters: async characters => {
      savedBatches.push([...characters])
      return saveResult
    },
    notify: {
      success: message => messages.push(`success:${message}`),
      warning: message => messages.push(`warning:${message}`),
      error: message => messages.push(`error:${message}`),
    },
    stream,
    parseCharacters: content => {
      parseCalls += 1
      assert.equal(content, '完整角色响应')
      return parsed
    },
  })

  controller.open()
  controller.config.value.count = 2
  controller.config.value.autoAssignRoles = false
  assert.equal(controller.usePrompt(template, '用户角色模板'), true)
  const generating = controller.generate()
  const request = stream.requests[0]
  assert.match(request.prompt, /用户角色模板/)
  assert.match(request.prompt, /不要自动改写或平衡角色定位/)
  assert.ok(request.prompt.indexOf('用户角色模板') < request.prompt.indexOf('Output format — MANDATORY'))
  request.callback?.('半成品', '半成品角色')
  assert.equal(parseCalls, 0, '流式增量不能触发结构化解析')
  assert.deepEqual(controller.results.value, [])
  request.resolve('完整角色响应')
  assert.equal(await generating, true)
  assert.equal(parseCalls, 1)
  assert.deepEqual(controller.results.value, parsed)
  assert.deepEqual(messages, ['success:成功生成 2 个角色'])
  console.log('✓ 批量角色完整响应仅解析一次，自定义模板仍保留最终格式契约')

  assert.equal(await controller.importSelected(), false)
  assert.deepEqual(savedBatches[0].map(character => character.id), [101])
  assert.equal(controller.visible.value, true)
  assert.deepEqual(controller.results.value, parsed)
  saveResult = true
  assert.equal(await controller.importSelected(), true)
  assert.deepEqual(savedBatches[1].map(character => character.id), [101])
  assert.equal(controller.visible.value, false)
  assert.match(messages.at(-1) ?? '', /^success:成功添加 1 个角色/)
  console.log('✓ 批量角色保存失败保留结果，重试仅提交当前选中项，成功后关闭')
}

async function testCharacterCancellation() {
  const currentNovel = ref<any>({ id: 1, title: '旧小说', genre: 'fantasy' })
  const stream = fakeStream()
  const messages: string[] = []
  let parseCalls = 0
  const controller = useWriterBatchCharacterGeneration({
    currentNovel,
    ensureApiReady: () => true,
    saveGeneratedCharacters: async () => true,
    notify: {
      success: message => messages.push(`success:${message}`),
      warning: message => messages.push(`warning:${message}`),
      error: message => messages.push(`error:${message}`),
    },
    stream,
    parseCharacters: () => {
      parseCalls += 1
      return [{ id: 1, name: '迟到角色' }]
    },
  })

  controller.open()
  const generating = controller.generate()
  const request = stream.requests[0]
  controller.visible.value = false
  assert.equal(request.signal.aborted, true)
  request.callback?.('迟到', '迟到内容')
  request.resolve('迟到完整响应')
  await generating.catch(isAIRequestCancelled)
  assert.equal(parseCalls, 0)
  assert.deepEqual(controller.results.value, [])
  assert.deepEqual(messages, [])
  console.log('✓ 关闭批量角色弹窗会取消请求并屏蔽迟到响应')
}

async function testCharacterPendingImportLifecycle() {
  const currentNovel = ref<any>({ id: 11, title: '归港', genre: 'suspense' })
  const stream = fakeStream()
  const save = deferred<boolean>()
  let ensureApiReadyCalls = 0
  const controller = useWriterBatchCharacterGeneration({
    currentNovel,
    ensureApiReady: () => {
      ensureApiReadyCalls += 1
      return true
    },
    saveGeneratedCharacters: async () => save.promise,
    notify: {
      success: () => undefined,
      warning: () => undefined,
      error: () => undefined,
    },
    stream,
  })

  assert.equal(controller.open(), true)
  controller.config.value.count = 2
  assert.equal(controller.usePrompt(template, '角色定制模板'), true)
  assert.equal(controller.selectedPrompt.value?.id, template.id)
  assert.equal(controller.selectedTemplatePrompt.value, '角色定制模板')
  controller.config.value.autoAssignRoles = false
  assert.equal(controller.selectedPrompt.value, null)
  assert.equal(controller.selectedTemplatePrompt.value, '')
  console.log('✓ 批量角色配置变化会作废旧的 rendered prompt')

  controller.results.value = [
    { id: 301, name: '陆离', role: 'protagonist', selected: true },
  ]
  const importing = controller.importSelected()
  const waiting = controller.waitForImport()
  assert.strictEqual(waiting, importing, 'waitForImport 应复用当前导入 promise')
  assert.equal(controller.isImporting.value, true)
  assert.equal(controller.canGenerate.value, false)
  assert.equal(await controller.generate(), false)
  assert.equal(ensureApiReadyCalls, 0, '导入期间生成应在 API 检查前被拒绝')
  assert.equal(stream.requests.length, 0)
  assert.equal(controller.open(), false)
  assert.equal(controller.cancel(), false)

  controller.visible.value = false
  assert.equal(controller.visible.value, true, '导入期间外部关闭应被同步恢复')
  assert.equal(controller.reset(), false, 'pending import 期间 reset 应延迟执行')
  assert.equal(controller.visible.value, true)
  assert.equal(controller.results.value.length, 1)

  save.resolve(true)
  assert.equal(await waiting, true, 'waitForImport 应返回真实保存成功结果')
  assert.equal(await importing, true)
  assert.equal(controller.isImporting.value, false)
  assert.equal(controller.visible.value, false)
  assert.deepEqual(controller.results.value, [], '延迟 reset 应在保存后清空生成结果')
  assert.equal(controller.config.value.count, 5)
  assert.equal(controller.config.value.autoAssignRoles, true)
  assert.equal(controller.selectedPrompt.value, null)
  assert.equal(controller.selectedTemplatePrompt.value, '')
  assert.equal(await controller.waitForImport(), true, '没有 pending import 时等待应立即成功')
  console.log('✓ 批量角色导入期间锁定操作，成功后执行延迟 reset')
}

async function testWorldGenerationAndNovelRace() {
  const currentNovel = ref<any>({ id: 7, title: '十洲记', genre: 'wuxia', description: '简介' })
  const stream = fakeStream()
  const messages: string[] = []
  let parseCalls = 0
  const parsed: WriterWorldSetting[] = [
    { id: 201, title: '雾港', type: '地理环境', category: 'geography' },
  ]
  const controller = useWriterBatchWorldGeneration({
    currentNovel,
    ensureApiReady: () => true,
    saveGeneratedWorldSettings: async () => true,
    notify: {
      success: message => messages.push(`success:${message}`),
      warning: message => messages.push(`warning:${message}`),
      error: message => messages.push(`error:${message}`),
    },
    stream,
    parseWorldSettings: content => {
      parseCalls += 1
      assert.equal(content, '完整世界观响应')
      return parsed
    },
  })

  controller.open()
  controller.config.value.count = 1
  assert.equal(controller.usePrompt({ ...template, category: 'worldview' }, '自由格式世界模板'), true)
  const generating = controller.generate()
  const request = stream.requests[0]
  assert.match(request.prompt, /自由格式世界模板/)
  assert.ok(request.prompt.indexOf('自由格式世界模板') < request.prompt.indexOf('Output format — MANDATORY'))
  request.callback?.('部分', '部分世界观')
  assert.equal(parseCalls, 0)
  request.resolve('完整世界观响应')
  assert.equal(await generating, true)
  assert.equal(parseCalls, 1)
  assert.deepEqual(controller.results.value, parsed)
  console.log('✓ 批量世界观控制器通过纯 builder 生成 prompt，并仅解析完整响应')

  controller.open()
  const staleGeneration = controller.generate()
  const staleRequest = stream.requests[1]
  currentNovel.value = { id: 8, title: '新小说', genre: 'scifi' }
  assert.equal(staleRequest.signal.aborted, true)
  staleRequest.resolve('旧小说迟到响应')
  await staleGeneration.catch(isAIRequestCancelled)
  assert.equal(controller.visible.value, false)
  assert.deepEqual(controller.results.value, [])
  assert.equal(parseCalls, 1, '切换小说后的旧响应不能再次解析')
  console.log('✓ 小说切换会重置世界观控制器，旧请求结果无法串入新小说')
}

async function testWorldPendingImportFailure() {
  const currentNovel = ref<any>({ id: 19, title: '冻土纪', genre: 'scifi' })
  const stream = fakeStream()
  const save = deferred<boolean>()
  const controller = useWriterBatchWorldGeneration({
    currentNovel,
    ensureApiReady: () => true,
    saveGeneratedWorldSettings: async () => save.promise,
    notify: {
      success: () => undefined,
      warning: () => undefined,
      error: () => undefined,
    },
    stream,
  })

  assert.equal(controller.open(), true)
  const worldTemplate = { ...template, category: 'worldview' as const }
  assert.equal(controller.usePrompt(worldTemplate, '世界观定制模板'), true)
  controller.config.value.includeMagic = true
  assert.equal(controller.selectedPrompt.value, null)
  assert.equal(controller.selectedTemplatePrompt.value, '')

  controller.results.value = [
    { id: 401, title: '极昼城', type: '地理环境', category: 'geography', selected: true },
  ]
  const importing = controller.importSelected()
  const waiting = controller.waitForImport()
  assert.strictEqual(waiting, importing)
  assert.equal(controller.isImporting.value, true)

  save.resolve(false)
  assert.equal(await waiting, false, 'waitForImport 不能把保存失败改写为成功')
  assert.equal(await importing, false)
  assert.equal(controller.isImporting.value, false)
  assert.equal(controller.visible.value, true)
  assert.equal(controller.results.value.length, 1, '保存失败应保留待重试结果')
  console.log('✓ 批量世界观 waitForImport 传递真实保存失败结果')
}

async function main() {
  await testCharacterGeneration()
  await testCharacterCancellation()
  await testWorldPendingImportFailure()
  await testCharacterPendingImportLifecycle()
  await testWorldGenerationAndNovelRace()
  console.log('\n=== WRITER BATCH MATERIAL GENERATION TESTS PASSED ===')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
