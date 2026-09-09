import assert from 'node:assert/strict'
import { ref } from 'vue'
import { useWriterMaterialCrud, type WriterMaterialDeleteRequest } from '../src/composables/useWriterMaterialCrud'
import type {
  WriterChapter,
  WriterCharacter,
  WriterCorpusItem,
  WriterEvent,
  WriterNovel,
  WriterWorldSetting,
} from '../src/types/writer'

const fixedNow = new Date('2026-10-02T03:04:05.000Z')

function fixture() {
  const currentNovel = ref<WriterNovel | null>({ id: 1, title: '甲小说' })
  const chapters = ref<WriterChapter[]>([{ id: 10, title: '第一章' }])
  const currentChapter = ref<WriterChapter | null>(chapters.value[0])
  const characters = ref<WriterCharacter[]>([{
    id: 11, name: '旧角色', role: 'supporting', tags: ['旧标签'],
  }])
  const worldSettings = ref<WriterWorldSetting[]>([{
    id: 12, title: '旧设定', description: '旧描述', category: 'setting',
  }])
  const corpusData = ref<WriterCorpusItem[]>([{
    id: 13, title: '旧语料', content: '旧内容', tags: ['旧语料标签'],
  }])
  const events = ref<WriterEvent[]>([{
    id: 14, title: '旧事件', characterIds: [11], chapter: '1',
  }])
  const successes: string[] = []
  const warnings: string[] = []
  const confirmations: WriterMaterialDeleteRequest[] = []
  let shouldSave = true
  let saveCalls = 0
  let nextId = 100
  let confirm = true
  let pendingSave: (() => void) | null = null
  let delaySave = false
  let pendingConfirmation: ((value: boolean) => void) | null = null
  let delayConfirmation = false

  const crud = useWriterMaterialCrud({
    currentNovel,
    chapters,
    currentChapter,
    characters,
    worldSettings,
    corpusData,
    events,
    saveNovelData: async () => {
      saveCalls += 1
      if (delaySave) await new Promise<void>(resolve => { pendingSave = resolve })
      return shouldSave
    },
    confirmDelete: async request => {
      confirmations.push(request)
      if (delayConfirmation) {
        return new Promise<boolean>(resolve => { pendingConfirmation = resolve })
      }
      return confirm
    },
    notify: {
      success: message => successes.push(message),
      warning: message => warnings.push(message),
    },
    createId: () => nextId++,
    now: () => fixedNow,
  })

  return {
    currentNovel, chapters, currentChapter, characters, worldSettings, corpusData, events,
    successes, warnings, confirmations, crud,
    save: (value: boolean) => { shouldSave = value },
    saves: () => saveCalls,
    confirm: (value: boolean) => { confirm = value },
    delaySave: () => { delaySave = true },
    releaseSave: () => {
      assert.ok(pendingSave)
      delaySave = false
      pendingSave()
      pendingSave = null
    },
    delayConfirmation: () => { delayConfirmation = true },
    releaseConfirmation: (value: boolean) => {
      assert.ok(pendingConfirmation)
      delayConfirmation = false
      pendingConfirmation(value)
      pendingConfirmation = null
    },
  }
}

async function testCreateTransactions() {
  const f = fixture()
  f.save(false)

  f.crud.addCharacter()
  f.crud.characterForm.value.name = '新角色'
  assert.equal(await f.crud.saveCharacter(), false)
  assert.deepEqual(f.characters.value.map(item => item.name), ['旧角色'])
  assert.equal(f.crud.characterForm.value.name, '新角色')
  assert.equal(f.crud.characterForm.value.id, 100)
  assert.equal(f.crud.showCharacterDialog.value, true)

  f.crud.addWorldSetting()
  f.crud.worldForm.value.title = '新设定'
  assert.equal(await f.crud.saveWorldSetting(), false)
  assert.deepEqual(f.worldSettings.value.map(item => item.title), ['旧设定'])
  assert.equal(f.crud.worldForm.value.title, '新设定')
  assert.equal(f.crud.showWorldDialog.value, true)

  f.crud.addCorpus()
  f.crud.corpusForm.value.title = '新语料'
  f.crud.corpusForm.value.content = '新内容'
  assert.equal(await f.crud.saveCorpus(), false)
  assert.deepEqual(f.corpusData.value.map(item => item.title), ['旧语料'])
  assert.equal(f.crud.corpusForm.value.title, '新语料')
  assert.equal(f.crud.showCorpusDialog.value, true)

  f.crud.addEvent()
  f.crud.eventForm.value.title = '新事件'
  assert.equal(f.crud.eventForm.value.chapter, '1')
  assert.equal(f.crud.eventForm.value.time, '2026-10-02T03:04')
  assert.equal(await f.crud.saveEvent(), false)
  assert.deepEqual(f.events.value.map(item => item.title), ['旧事件'])
  assert.equal(f.crud.eventForm.value.title, '新事件')
  assert.equal(f.crud.showEventDialog.value, true)
  assert.deepEqual(f.successes, [])

  f.save(true)
  assert.equal(await f.crud.saveCharacter(), true)
  assert.equal(await f.crud.saveWorldSetting(), true)
  assert.equal(await f.crud.saveCorpus(), true)
  assert.equal(await f.crud.saveEvent(), true)
  assert.deepEqual(f.characters.value.map(item => item.name), ['旧角色', '新角色'])
  assert.deepEqual(f.worldSettings.value.map(item => item.title), ['旧设定', '新设定'])
  assert.deepEqual(f.corpusData.value.map(item => item.title), ['旧语料', '新语料'])
  assert.deepEqual(f.events.value.map(item => item.title), ['旧事件', '新事件'])
  assert.equal(f.crud.characterForm.value.createdAt, fixedNow)
  assert.deepEqual(f.successes, ['角色创建成功', '设定创建成功', '语料创建成功', '事件创建成功'])
  console.log('✓ 新增失败不遗留幽灵项，草稿可原样重试')
}

async function testEditDraftIsolationAndRollback() {
  const f = fixture()
  const originalCharacter = f.characters.value[0]
  const originalCorpus = f.corpusData.value[0]
  const originalEvent = f.events.value[0]
  f.crud.editCharacter(originalCharacter)
  f.crud.characterForm.value.tags.push('草稿标签')
  f.crud.characterForm.value.name = '草稿角色'
  f.crud.editCorpus(originalCorpus)
  f.crud.corpusForm.value.tags.push('草稿语料标签')
  f.crud.editEvent(originalEvent)
  f.crud.eventForm.value.characterIds.push('旧名字')
  assert.deepEqual(originalCharacter.tags, ['旧标签'])
  assert.deepEqual(originalCorpus.tags, ['旧语料标签'])
  assert.deepEqual(originalEvent.characterIds, [11])

  // Re-open the character draft because opening the other resource dialogs is
  // independent and must not disturb its state.
  f.save(false)
  assert.equal(await f.crud.saveCharacter(), false)
  assert.equal(f.characters.value[0], originalCharacter)
  assert.equal(f.characters.value[0].name, '旧角色')
  assert.equal(f.crud.characterForm.value.name, '草稿角色')
  assert.deepEqual(f.crud.characterForm.value.tags, ['旧标签', '草稿标签'])
  assert.equal(f.crud.showCharacterDialog.value, true)

  f.save(true)
  assert.equal(await f.crud.saveCharacter(), true)
  assert.equal(f.characters.value[0].name, '草稿角色')
  assert.deepEqual(f.characters.value[0].tags, ['旧标签', '草稿标签'])
  assert.equal(f.crud.showCharacterDialog.value, false)
  console.log('✓ 编辑草稿隔离嵌套数组，失败回滚列表且保留表单')
}

async function testDeletesAndDuplicate() {
  const f = fixture()
  const cases = [
    [() => f.crud.deleteCharacter(f.characters.value[0]), f.characters, 11],
    [() => f.crud.deleteWorldSetting(f.worldSettings.value[0]), f.worldSettings, 12],
    [() => f.crud.deleteCorpus(f.corpusData.value[0]), f.corpusData, 13],
    [() => f.crud.deleteEvent(f.events.value[0]), f.events, 14],
  ] as const
  f.save(false)
  for (const [remove, list, id] of cases) {
    assert.equal(await remove(), false)
    assert.equal(list.value[0].id, id)
  }
  assert.deepEqual(f.successes, [])
  assert.deepEqual(f.confirmations.map(item => item.kind), ['character', 'worldSetting', 'corpus', 'event'])

  assert.equal(await f.crud.duplicateWorldSetting(f.worldSettings.value[0]), false)
  assert.equal(f.worldSettings.value.length, 1)
  f.save(true)
  assert.equal(await f.crud.duplicateWorldSetting(f.worldSettings.value[0]), true)
  assert.equal(f.worldSettings.value.length, 2)
  assert.equal(f.worldSettings.value[1].title, '旧设定 (副本)')
  assert.equal(f.worldSettings.value[1].generated, false)

  const cancelled = fixture()
  cancelled.confirm(false)
  assert.equal(await cancelled.crud.deleteCharacter(cancelled.characters.value[0]), false)
  assert.equal(cancelled.saves(), 0)
  assert.equal(cancelled.characters.value.length, 1)
  console.log('✓ 删除失败恢复原位，复制失败回滚，取消确认不触发保存')
}

async function testGeneratedMaterialImports() {
  const f = fixture()
  const generatedCharacters: WriterCharacter[] = [
    { id: 11, name: '重复角色' },
    { id: 21, name: '生成角色', tags: ['生成标签'] },
  ]
  const generatedSettings: WriterWorldSetting[] = [
    { id: 12, title: '重复设定' },
    { id: 22, title: '生成设定', description: '新描述' },
  ]

  f.save(false)
  assert.equal(await f.crud.importGeneratedCharacters(generatedCharacters), false)
  assert.equal(await f.crud.importGeneratedWorldSettings(generatedSettings), false)
  assert.deepEqual(f.characters.value.map(item => item.id), [11])
  assert.deepEqual(f.worldSettings.value.map(item => item.id), [12])

  f.save(true)
  assert.equal(await f.crud.importGeneratedCharacters(generatedCharacters), true)
  assert.equal(await f.crud.importGeneratedWorldSettings(generatedSettings), true)
  assert.equal(f.characters.value.length, 3)
  assert.equal(f.worldSettings.value.length, 3)
  assert.equal(new Set(f.characters.value.map(item => item.id)).size, 3)
  assert.equal(new Set(f.worldSettings.value.map(item => item.id)).size, 3)
  const importedCharacter = f.characters.value.find(item => item.name === '生成角色')!
  assert.notEqual(importedCharacter, generatedCharacters[1])
  assert.notEqual(importedCharacter.tags, generatedCharacters[1].tags)
  assert.deepEqual(generatedCharacters[1].tags, ['生成标签'])
  console.log('✓ 批量导入重新分配冲突 ID，保存失败回滚，成功时隔离原始结果')
}

async function testNovelRaceGuards() {
  const before = fixture()
  before.crud.addCharacter()
  before.crud.characterForm.value.name = '甲草稿'
  before.currentNovel.value = { id: 2, title: '乙小说' }
  before.characters.value = [{ id: 21, name: '乙角色' }]
  assert.equal(await before.crud.saveCharacter(), false)
  assert.equal(before.saves(), 0)
  assert.deepEqual(before.characters.value.map(item => item.name), ['乙角色'])

  const duringConfirm = fixture()
  duringConfirm.delayConfirmation()
  const deleting = duringConfirm.crud.deleteCharacter(duringConfirm.characters.value[0])
  await Promise.resolve()
  duringConfirm.currentNovel.value = { id: 2, title: '乙小说' }
  duringConfirm.characters.value = [{ id: 21, name: '乙角色' }]
  duringConfirm.releaseConfirmation(true)
  assert.equal(await deleting, false)
  assert.equal(duringConfirm.saves(), 0)
  assert.deepEqual(duringConfirm.characters.value.map(item => item.name), ['乙角色'])

  const afterSave = fixture()
  afterSave.crud.addCharacter()
  afterSave.crud.characterForm.value.name = '甲草稿'
  afterSave.delaySave()
  const saving = afterSave.crud.saveCharacter()
  await Promise.resolve()
  assert.equal(afterSave.characters.value.at(-1)?.name, '甲草稿')
  afterSave.currentNovel.value = { id: 2, title: '乙小说' }
  afterSave.characters.value = [{ id: 21, name: '乙角色' }]
  afterSave.releaseSave()
  assert.equal(await saving, false)
  assert.deepEqual(afterSave.characters.value.map(item => item.name), ['乙角色'])
  assert.deepEqual(afterSave.successes, [])
  assert.equal(afterSave.crud.showCharacterDialog.value, false)

  const sameIdReload = fixture()
  const originalNovel = sameIdReload.currentNovel.value!
  const originalCollection = sameIdReload.characters.value
  sameIdReload.crud.addCharacter()
  sameIdReload.crud.characterForm.value.name = '旧实例草稿'
  sameIdReload.save(false)
  sameIdReload.delaySave()
  const staleSaving = sameIdReload.crud.saveCharacter()
  await Promise.resolve()
  sameIdReload.currentNovel.value = { id: 2, title: '过渡小说' }
  sameIdReload.currentNovel.value = originalNovel
  sameIdReload.characters.value = [{ id: 100, name: '重新加载后的合法角色' }]
  sameIdReload.releaseSave()
  assert.equal(await staleSaving, false)
  assert.deepEqual(sameIdReload.characters.value.map(item => item.name), ['重新加载后的合法角色'])
  assert.deepEqual(originalCollection.map(item => item.name), ['旧角色'])
  console.log('✓ 小说对象与 epoch 双重校验可防止 A→B→A 的迟到事务污染新实例')
}

async function testGlobalMutationLock() {
  const f = fixture()
  f.crud.addCharacter()
  f.crud.characterForm.value.name = '串行保存角色'
  f.delaySave()
  const savingCharacter = f.crud.saveCharacter()
  await Promise.resolve()
  assert.equal(f.crud.isMutating.value, true)

  assert.equal(await f.crud.duplicateWorldSetting(f.worldSettings.value[0]), false)
  assert.equal(await f.crud.importGeneratedWorldSettings([{ id: 30, title: '并发设定' }]), false)
  f.crud.addCorpus()
  f.crud.corpusForm.value.title = '并发语料'
  assert.equal(await f.crud.saveCorpus(), false)
  assert.equal(f.saves(), 1, '不同素材类别不能并发提交完整小说快照')
  assert.equal(f.worldSettings.value.length, 1)
  assert.equal(f.corpusData.value.length, 1)

  const pending = f.crud.waitForMutation()
  f.releaseSave()
  assert.equal(await pending, true)
  assert.equal(await savingCharacter, true)
  assert.equal(f.crud.isMutating.value, false)
  assert.equal(await f.crud.waitForMutation(), true)
  console.log('✓ 四类素材共用一个事务锁，路由可等待当前完整快照保存')
}

async function main() {
  await testCreateTransactions()
  await testEditDraftIsolationAndRollback()
  await testDeletesAndDuplicate()
  await testGeneratedMaterialImports()
  await testNovelRaceGuards()
  await testGlobalMutationLock()
  console.log('\n=== ALL WRITER MATERIAL CRUD TESTS PASSED ===')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
