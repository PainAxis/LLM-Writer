import assert from 'node:assert/strict'
import { createExtensionsState, normalizeExtensionSettings, useExtensionsStore } from '../src/stores/extensions'
import { createPinia, setActivePinia } from 'pinia'
import { BUILTIN_WRITING_SKILLS, parseSkillPackage } from '../src/services/skills'
import type { WriterNovel } from '../src/types/writer'

let disk: unknown = null
let failure = false
let novels: WriterNovel[] = [{ id: 1, title: 'First book', chapterList: [{ id: 10, title: 'Chapter', content: 'Original text' }] }]
const state = createExtensionsState({ read: () => disk, readNovels: () => novels, write: async value => {
  if (failure) throw new Error('Injected write failure')
  disk = JSON.parse(JSON.stringify(value))
} })
assert.equal(state.captureRequest(), undefined)
assert.deepEqual(state.writingToolIds.value, [])
await state.saveServer({ id: 'public', name: 'Test server', url: 'https://example.com/mcp', enabled: true, allowedTools: ['lookup'] })
state.setToken('public', 'session-secret')
assert.ok(!JSON.stringify(disk).includes('session-secret'))
await state.updateSettings({ enabled: true, selectedNovelId: 1, writingToolIds: ['writing_read_chapter'], selectedSkillIds: [BUILTIN_WRITING_SKILLS[0].id] })
const snapshot = state.captureRequest()!
assert.equal(snapshot.servers[0].bearerToken, 'session-secret')
assert.equal(snapshot.novel?.chapterList?.[0].content, 'Original text')
novels[0].chapterList![0].content = 'Later author edit'
assert.equal(snapshot.novel?.chapterList?.[0].content, 'Original text', 'request data must be detached from later author edits')
const before = JSON.stringify(disk)
failure = true
await assert.rejects(state.saveServer({ ...state.servers.value[0], url: 'https://other.example.com/mcp' }), /Injected/)
assert.equal(JSON.stringify(disk), before)
assert.equal(state.credentials.value.public, 'session-secret', 'failed save must not revoke active session state')
assert.deepEqual(state.servers.value[0].allowedTools, ['lookup'])
assert.equal(state.pending.value, 0)
failure = false
await state.saveServer({ ...state.servers.value[0], url: 'https://other.example.com/mcp' })
assert.equal(state.credentials.value.public, undefined)
assert.deepEqual(state.servers.value[0].allowedTools, [])
const staleEditor = { ...state.servers.value[0], allowedTools: [...state.servers.value[0].allowedTools] }
await state.saveServer({ ...state.servers.value[0], name: 'Changed elsewhere' })
await assert.rejects(state.saveServer({ ...staleEditor, enabled: false }, staleEditor), /其他位置更改/)
assert.equal(state.servers.value[0].name, 'Changed elsewhere')
assert.equal(state.servers.value[0].enabled, true)
await state.saveServer({ id: '__proto__', name: 'Reserved key test', url: 'https://example.com/mcp', enabled: true, allowedTools: ['lookup'] })
state.setToken('__proto__', 'prototype-key-secret')
assert.equal(state.credentials.value.__proto__, 'prototype-key-secret', 'credentials must use a prototype-free key map')
assert.equal(state.captureRequest()!.servers[0].bearerToken, 'prototype-key-secret')
await state.removeServer('__proto__')
assert.equal(state.credentials.value.__proto__, undefined)
assert.throws(() => state.setToken('deleted', 'secret'), /删除/)
assert.throws(() => state.setToken('public', 'bad\nheader'), /令牌格式/)

const imported = parseSkillPackage([{ path: 'SKILL.md', content: '---\nname: test-editor\ndescription: Review a chapter\n---\nReview the supplied chapter.' }], { source: 'imported' })
await state.importSkill(imported)
await assert.rejects(state.importSkill(imported), /同名/)
await state.updateSettings({ selectedSkillIds: [imported.id] })
assert.equal(state.captureRequest()!.skills[0].id, imported.id)
await state.deleteSkill(imported.id)
assert.deepEqual(state.selectedSkillIds.value, [])
await Promise.all([state.updateSettings({ maxSteps: 3 }), state.updateSettings({ selectedSkillIds: [BUILTIN_WRITING_SKILLS[1].id] })])
assert.equal(state.maxSteps.value, 3)
assert.deepEqual(state.selectedSkillIds.value, [BUILTIN_WRITING_SKILLS[1].id])
await assert.rejects(state.updateSettings({ maxSteps: 13 }), /1 至 12/)
assert.equal(state.maxSteps.value, 3)
novels = []
assert.throws(() => state.captureRequest(), /小说已删除/)
await state.updateSettings({ selectedNovelId: undefined, writingToolIds: [] })
await state.updateSettings({ selectedSkillIds: ['imported:deleted'] })
assert.throws(() => state.captureRequest(), /技能已不存在/)
await state.updateSettings({ selectedSkillIds: [] })
await state.updateSettings({ writingToolIds: ['writing_get_project'] })
assert.throws(() => state.captureRequest(), /先选择小说/)
await state.updateSettings({ writingToolIds: [] })
state.setToken('public', 'latest-secret')
disk = { ...(disk as object), servers: [{ ...state.servers.value[0], url: 'https://changed.example.com/mcp' }] }
await state.reload()
assert.equal(state.credentials.value.public, undefined, 'cross-tab address changes revoke page credentials')
const sanitized = normalizeExtensionSettings({ ...(disk as object), bearerToken: 'must-drop', credentials: { public: 'must-drop' }, discoveries: { response: 'must-drop' } })
assert.ok(!JSON.stringify(sanitized).includes('must-drop'))
assert.throws(() => normalizeExtensionSettings({ ...sanitized, selectedNovelId: -1 }), /小说选择/)
assert.throws(() => normalizeExtensionSettings({ ...sanitized, writingToolIds: ['unknown'] }), /未知创作工具/)

disk = { enabled: 'invalid' }
await state.reload()
assert.ok(state.loadError.value)
await assert.rejects(state.updateSettings({ enabled: true }), /恢复有效备份/)
failure = true
await assert.rejects(state.reset(), /Injected/)
assert.ok(state.loadError.value)
failure = false
await state.reset()
assert.equal(state.loadError.value, '')
assert.equal(state.enabled.value, false)
assert.equal(state.pending.value, 0)
assert.deepEqual(state.servers.value, [])
const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
let rawSettings = '{malformed persisted JSON'
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => key === 'extensions' ? rawSettings : null,
  setItem: (key: string, value: string) => { if (key === 'extensions') rawSettings = value },
} })
try {
  setActivePinia(createPinia())
  const persisted = useExtensionsStore()
  assert.ok(persisted.loadError, 'invalid persisted JSON must surface, rather than fall back silently')
  await assert.rejects(persisted.updateSettings({ enabled: true }), /恢复有效备份/)
  assert.equal(rawSettings, '{malformed persisted JSON', 'invalid data is preserved until explicit reset')
  await persisted.reset()
  assert.equal(persisted.loadError, '')
  assert.equal(JSON.parse(rawSettings).enabled, false)
  persisted.$dispose()
} finally {
  if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
}
console.log('Extension settings smoke passed: transactional persistence, session credentials, explicit selections and detached request snapshots')
