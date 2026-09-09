import assert from 'node:assert/strict'
import { ref, watch } from 'vue'
import {
  useWriterCharacterFormGeneration,
  useWriterWorldSettingFormGeneration,
} from '../src/composables/useWriterFormGeneration'
import { AIRequestCancelledError } from '../src/utils/aiRequestScope'
import type { GenerateOptions, StreamCallback } from '../src/types/api'
import type { WriterCharacterForm, WriterNovel, WriterWorldSettingForm } from '../src/types/writer'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function fakeStream() {
  const pending: Array<{
    prompt: string
    options: GenerateOptions
    callback: StreamCallback | null
    resolve: (value: string) => void
    reject: (reason?: unknown) => void
  }> = []
  let stopCount = 0
  return {
    pending,
    stopCount: () => stopCount,
    generate(prompt: string, options: GenerateOptions = {}, callback: StreamCallback | null = null) {
      const result = deferred<string>()
      pending.push({ prompt, options, callback, resolve: result.resolve, reject: result.reject })
      return result.promise
    },
    stop() { stopCount += 1 },
  }
}

const parseCharacter = (response: string) => {
  const fields = Object.fromEntries(response.split('\n').map(line => {
    const [label, ...value] = line.split(/[：:]/)
    return [label.trim(), value.join(':').trim()]
  }))
  return {
    appearance: fields.外貌 || '',
    personality: fields.性格 || '',
    background: fields.背景 || '',
    tags: (fields.标签 || '').split(/[,，]/).map(tag => tag.trim()).filter(Boolean),
  }
}

const characterForm = (): WriterCharacterForm => ({
  id: 7,
  name: '沈砚',
  role: 'antagonist',
  gender: 'male',
  age: 31,
  appearance: '原外貌',
  personality: '原性格',
  background: '原背景',
  tags: ['原标签'],
  avatar: '',
})

const worldForm = (): WriterWorldSettingForm => ({
  id: 11,
  title: '雾港',
  description: '原设定描述',
  category: 'geography',
  details: '保留的细节',
})

function notifications() {
  const messages: string[] = []
  return {
    messages,
    notify: {
      success: (message: string) => messages.push(`success:${message}`),
      warning: (message: string) => messages.push(`warning:${message}`),
      error: (message: string) => messages.push(`error:${message}`),
    },
  }
}

function characterFixture() {
  const currentNovel = ref<WriterNovel | null>({ id: 1, title: '潮汐之城', genre: 'fantasy' })
  const form = ref(characterForm())
  const stream = fakeStream()
  const notice = notifications()
  let parseCount = 0
  const controller = useWriterCharacterFormGeneration({
    currentNovel,
    form,
    ensureApiReady: () => true,
    stream,
    notify: notice.notify,
    buildPrompt: ({ novel, form: snapshot, customPrompt }) =>
      `${novel.title}|${snapshot.name}|${customPrompt || '默认角色提示'}`,
    parseResponse: response => { parseCount += 1; return parseCharacter(response) },
  })
  return { controller, currentNovel, form, stream, messages: notice.messages, parseCount: () => parseCount }
}

async function main() {
  const successful = characterFixture()
  const originalForm = successful.form.value
  let formReplacements = 0
  watch(successful.form, () => { formReplacements += 1 }, { flush: 'sync' })
  const generating = successful.controller.generate('强化人物矛盾')
  const request = successful.stream.pending[0]
  assert.equal(request.prompt, '潮汐之城|沈砚|强化人物矛盾')
  assert.equal(request.options.type, 'character')
  request.callback?.('外貌', '外貌：面色苍白')
  request.callback?.('性格', '外貌：面色苍白\n性格：冷静偏执')
  assert.equal(successful.controller.preview.value, '外貌：面色苍白\n性格：冷静偏执')
  assert.strictEqual(successful.form.value, originalForm)
  assert.deepEqual(successful.form.value, characterForm(), '增量内容不得进入表单')
  assert.equal(formReplacements, 0)
  request.resolve('外貌：面色苍白\n性格：冷静偏执\n背景：边城遗民\n标签：谋士,旧贵族')
  assert.equal(await generating, true)
  assert.equal(formReplacements, 1, '完整响应只能原子提交一次')
  assert.notStrictEqual(successful.form.value, originalForm)
  assert.equal(successful.form.value.appearance, '面色苍白')
  assert.equal(successful.form.value.personality, '冷静偏执')
  assert.equal(successful.form.value.background, '边城遗民')
  assert.deepEqual(successful.form.value.tags, ['谋士', '旧贵族'])
  assert.equal(successful.parseCount(), 1)
  assert.deepEqual(successful.messages, ['success:AI角色生成完成'])
  console.log('✓ 角色流式内容仅更新预览，完整响应解析后只提交一次')

  const failed = characterFixture()
  const failedOriginal = failed.form.value
  const failing = failed.controller.generate()
  failed.stream.pending[0].callback?.('部分', '外貌：部分内容')
  failed.stream.pending[0].reject(new Error('网络断开'))
  assert.equal(await failing, false)
  assert.strictEqual(failed.form.value, failedOriginal)
  assert.deepEqual(failed.form.value, characterForm())
  assert.equal(failed.parseCount(), 0)
  assert.deepEqual(failed.messages, ['error:角色生成失败: 网络断开'])
  console.log('✓ 请求失败保留完整原表单且不解析半成品')

  const cancelled = characterFixture()
  const cancelledOriginal = cancelled.form.value
  const cancelling = cancelled.controller.generate()
  const cancelledRequest = cancelled.stream.pending[0]
  cancelledRequest.callback?.('部分', '外貌：半成品')
  cancelled.controller.cancel()
  assert.equal(cancelled.controller.preview.value, '')
  assert.equal(cancelled.controller.isGenerating.value, false)
  assert.equal(cancelled.stream.stopCount(), 1)
  cancelledRequest.reject(new AIRequestCancelledError('外貌：半成品'))
  assert.equal(await cancelling, false)
  assert.strictEqual(cancelled.form.value, cancelledOriginal)
  assert.deepEqual(cancelled.messages, [])
  console.log('✓ 取消请求清空预览、保留原表单并屏蔽取消异常')

  const superseded = characterFixture()
  const first = superseded.controller.generate('第一版')
  const firstRequest = superseded.stream.pending[0]
  firstRequest.callback?.('旧', '外貌：旧预览')
  const second = superseded.controller.generate('第二版')
  const secondRequest = superseded.stream.pending[1]
  assert.equal(superseded.stream.stopCount(), 1)
  firstRequest.callback?.('迟到', '外貌：迟到旧预览')
  assert.equal(superseded.controller.preview.value, '')
  firstRequest.resolve('外貌：旧结果\n性格：旧\n背景：旧\n标签：旧')
  assert.equal(await first, false)
  assert.equal(superseded.controller.isGenerating.value, true, '旧请求 finally 不能关闭新请求状态')
  secondRequest.resolve('外貌：新结果\n性格：新\n背景：新\n标签：新')
  assert.equal(await second, true)
  assert.equal(superseded.form.value.appearance, '新结果')
  assert.deepEqual(superseded.messages, ['success:AI角色生成完成'])
  console.log('✓ 新操作屏蔽旧 chunk、旧完成值和旧 finally')

  const staleNovel = characterFixture()
  const staleNovelOriginal = staleNovel.form.value
  const staleNovelRun = staleNovel.controller.generate()
  staleNovel.currentNovel.value = { id: 1, title: '同 ID 的重新加载小说' }
  staleNovel.stream.pending[0].resolve('外貌：错误覆盖\n性格：错误\n背景：错误\n标签：错误')
  assert.equal(await staleNovelRun, false)
  assert.strictEqual(staleNovel.form.value, staleNovelOriginal)
  assert.deepEqual(staleNovel.messages, [])
  console.log('✓ 小说对象即使 ID 相同但已重新加载，也拒绝旧生成结果')

  const staleForm = characterFixture()
  const staleFormRun = staleForm.controller.generate()
  staleForm.form.value = { ...characterForm(), name: '另一个角色' }
  staleForm.stream.pending[0].resolve('外貌：错误覆盖\n性格：错误\n背景：错误\n标签：错误')
  assert.equal(await staleFormRun, false)
  assert.equal(staleForm.form.value.name, '另一个角色')
  assert.equal(staleForm.form.value.appearance, '原外貌')

  const editedInPlace = characterFixture()
  const editedRun = editedInPlace.controller.generate()
  editedInPlace.form.value.background = '用户生成期间手工修改'
  editedInPlace.stream.pending[0].resolve('外貌：错误覆盖\n性格：错误\n背景：错误\n标签：错误')
  assert.equal(await editedRun, false)
  assert.equal(editedInPlace.form.value.background, '用户生成期间手工修改')
  assert.equal(editedInPlace.form.value.appearance, '原外貌')
  console.log('✓ 表单替换或原地编辑都会让旧结果失效')

  const currentNovel = ref<WriterNovel | null>({ id: 2, title: '海雾纪' })
  const world = ref(worldForm())
  const worldStream = fakeStream()
  const worldNotice = notifications()
  let worldParseCount = 0
  const worldController = useWriterWorldSettingFormGeneration({
    currentNovel,
    form: world,
    ensureApiReady: () => true,
    stream: worldStream,
    notify: worldNotice.notify,
    buildPrompt: ({ novel, form }) => `${novel.title}|${form.title}|${form.category}`,
    parseResponse: response => { worldParseCount += 1; return { description: response.trim() } },
  })
  const originalWorld = world.value
  let worldReplacements = 0
  watch(world, () => { worldReplacements += 1 }, { flush: 'sync' })
  const worldRun = worldController.generate()
  const worldRequest = worldStream.pending[0]
  assert.equal(worldRequest.prompt, '海雾纪|雾港|geography')
  assert.equal(worldRequest.options.type, 'worldview')
  worldRequest.callback?.('潮汐', '潮汐每夜倒流')
  assert.equal(worldController.preview.value, '潮汐每夜倒流')
  assert.strictEqual(world.value, originalWorld)
  assert.equal(world.value.description, '原设定描述')
  worldRequest.resolve('潮汐每夜倒流，港口依靠灯塔计时。')
  assert.equal(await worldRun, true)
  assert.equal(world.value.description, '潮汐每夜倒流，港口依靠灯塔计时。')
  assert.equal(world.value.details, '保留的细节')
  assert.equal(worldReplacements, 1)
  assert.equal(worldParseCount, 1)
  assert.deepEqual(worldNotice.messages, ['success:AI世界观设定生成完成'])
  console.log('✓ 世界观描述同样只在成功后原子提交，并保留其他表单字段')

  console.log('\n=== WRITER FORM GENERATION TESTS PASSED ===')
}

main().catch(error => { console.error(error); process.exit(1) })
