import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ExtensionRequest } from '@/types/extensions'
import type { RemoteMcpServer } from '@/types/mcp'
import type { WritingSkill } from '@/types/skills'
import type { WritingToolId } from '@/types/writingTools'
import type { WriterNovel } from '@/types/writer'
import { normalizeRemoteMcpServer } from '@/services/mcp'
import { BUILTIN_WRITING_SKILLS, normalizeWritingSkill } from '@/services/skills'
import { WRITING_TOOL_DESCRIPTORS } from '@/services/writingTools'
import { StorageKeys, storageGet, storageGetStrict, writeSerializedWithRetry } from '@/utils/storage'
import { withStorageCommit } from '@/services/storageCoordination'

export interface ExtensionSettings {
  enabled: boolean
  servers: RemoteMcpServer[]
  importedSkills: WritingSkill[]
  selectedNovelId?: number
  selectedSkillIds: string[]
  writingToolIds: WritingToolId[]
  maxSteps: number
}

function uniqueStrings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string' || !item.trim() || item.length > 128)) throw new Error(`${field}格式无效`)
  return [...new Set(value)]
}

/** Whitelist persisted fields: tokens, discovered remote data and request snapshots never enter backups. */
export function normalizeExtensionSettings(value: unknown): ExtensionSettings {
  if (value == null) return { enabled: false, servers: [], importedSkills: [], selectedSkillIds: [], writingToolIds: [], maxSteps: 5 }
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('扩展设置格式无效')
  const source = value as Record<string, unknown>
  if (typeof source.enabled !== 'boolean' || !Array.isArray(source.servers) || !Array.isArray(source.importedSkills)) throw new Error('扩展设置格式无效')
  const servers = source.servers.map(normalizeRemoteMcpServer)
  const importedSkills = source.importedSkills.map(normalizeWritingSkill)
  if (servers.length > 30 || importedSkills.length > 100) throw new Error('扩展数量超过限制')
  if (new Set(servers.map(item => item.id)).size !== servers.length) throw new Error('MCP 服务 ID 重复')
  if (new Set(importedSkills.map(item => item.id)).size !== importedSkills.length || importedSkills.some(item => item.source !== 'imported' || BUILTIN_WRITING_SKILLS.some(builtin => builtin.id === item.id))) throw new Error('导入技能 ID 无效或重复')
  const selectedSkillIds = uniqueStrings(source.selectedSkillIds, '技能选择')
  const writingToolIds = uniqueStrings(source.writingToolIds, '创作工具选择')
  if (writingToolIds.some(id => !WRITING_TOOL_DESCRIPTORS.some(tool => tool.id === id))) throw new Error('存在未知创作工具')
  const maxSteps = source.maxSteps
  if (typeof maxSteps !== 'number' || !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 12) throw new Error('工具调用轮数应为 1 至 12 的整数')
  if (source.selectedNovelId !== undefined && (typeof source.selectedNovelId !== 'number' || !Number.isSafeInteger(source.selectedNovelId) || source.selectedNovelId <= 0)) throw new Error('小说选择无效')
  return { enabled: source.enabled, servers, importedSkills, ...(source.selectedNovelId !== undefined ? { selectedNovelId: source.selectedNovelId as number } : {}),
    selectedSkillIds, writingToolIds: writingToolIds as WritingToolId[], maxSteps }
}

interface ExtensionStorage {
  read(): unknown
  write(value: ExtensionSettings): void | Promise<void>
  update?(change: (current: ExtensionSettings) => ExtensionSettings): Promise<ExtensionSettings>
  readNovels(): WriterNovel[]
}

export function createExtensionsState(storage: ExtensionStorage) {
  const loadError = ref('')
  function readSettings() {
    try { const value = normalizeExtensionSettings(storage.read()); loadError.value = ''; return value }
    catch (error) { loadError.value = error instanceof Error ? error.message : '无法加载扩展设置'; return normalizeExtensionSettings(null) }
  }
  const settings = ref(readSettings())
  const pending = ref(0)
  const credentials = ref<Record<string, string>>(Object.create(null))
  let queue = Promise.resolve()
  const enabled = computed(() => settings.value.enabled)
  const servers = computed(() => settings.value.servers)
  const importedSkills = computed(() => settings.value.importedSkills)
  const skills = computed(() => [...BUILTIN_WRITING_SKILLS, ...importedSkills.value])
  const selectedNovelId = computed(() => settings.value.selectedNovelId)
  const selectedSkillIds = computed(() => settings.value.selectedSkillIds)
  const writingToolIds = computed(() => settings.value.writingToolIds)
  const maxSteps = computed(() => settings.value.maxSteps)

  function mutate(change: (current: ExtensionSettings) => ExtensionSettings): Promise<void> {
    pending.value++
    const result = queue.then(async () => {
      if (loadError.value) throw new Error(`扩展设置无法读取：${loadError.value}。请先恢复有效备份或重置扩展设置。`)
      const before = settings.value
      const next = storage.update ? await storage.update(current => normalizeExtensionSettings(change(current))) : normalizeExtensionSettings(change(before))
      if (!storage.update) await storage.write(next)
      for (const id of Object.keys(credentials.value)) {
        const old = before.servers.find(server => server.id === id)
        const server = next.servers.find(server => server.id === id)
        if (!old || !server || old.url !== server.url) delete credentials.value[id]
      }
      settings.value = next
    }).finally(() => { pending.value-- })
    queue = result.catch(() => undefined)
    return result
  }
  function updateSettings(patch: Partial<Pick<ExtensionSettings, 'enabled' | 'selectedNovelId' | 'selectedSkillIds' | 'writingToolIds' | 'maxSteps'>>) {
    return mutate(current => ({ ...current, ...patch }))
  }
  function saveServer(server: RemoteMcpServer, expected?: RemoteMcpServer) {
    const normalized = normalizeRemoteMcpServer(server)
    return mutate(current => {
      const existing = current.servers.find(item => item.id === normalized.id)
      if (expected && (!existing || JSON.stringify(existing) !== JSON.stringify(normalizeRemoteMcpServer(expected)))) throw new Error('MCP 服务已在其他位置更改，请重新打开后保存')
      const next = existing && existing.url !== normalized.url ? { ...normalized, allowedTools: [] } : normalized
      return { ...current, servers: existing ? current.servers.map(item => item.id === next.id ? next : item) : [...current.servers, next] }
    })
  }
  function removeServer(id: string) { return mutate(current => ({ ...current, servers: current.servers.filter(item => item.id !== id) })) }
  function importSkill(skill: WritingSkill) {
    const normalized = normalizeWritingSkill(skill)
    if (normalized.source !== 'imported') return Promise.reject(new Error('只能导入外部技能'))
    return mutate(current => {
      if (current.importedSkills.some(item => item.id === normalized.id || item.name === normalized.name)) throw new Error('同名技能已存在，请先删除旧版本再导入')
      return { ...current, importedSkills: [...current.importedSkills, normalized] }
    })
  }
  function deleteSkill(id: string) {
    return mutate(current => ({ ...current, importedSkills: current.importedSkills.filter(item => item.id !== id), selectedSkillIds: current.selectedSkillIds.filter(item => item !== id) }))
  }
  function setToken(id: string, token: string) {
    if (!servers.value.some(server => server.id === id)) throw new Error('MCP 服务已删除，请重新打开')
    if (token.includes('\n') || token.includes('\r') || token.length > 8192) throw new Error('访问令牌格式无效')
    if (token.trim()) credentials.value[id] = token.trim()
    else delete credentials.value[id]
  }
  function captureRequest(): ExtensionRequest | undefined {
    if (!enabled.value) return undefined
    if (loadError.value) throw new Error(`扩展设置无法读取：${loadError.value}`)
    if (pending.value) throw new Error('扩展设置正在保存，请稍后发送')
    const selectedSkills = selectedSkillIds.value.map(id => {
      const skill = skills.value.find(item => item.id === id)
      if (!skill) throw new Error('所选技能已不存在，请重新选择')
      return skill
    })
    const novel = selectedNovelId.value === undefined ? undefined : storage.readNovels().find(item => item.id === selectedNovelId.value)
    if (selectedNovelId.value !== undefined && !novel) throw new Error('所选小说已删除，请重新选择')
    if (writingToolIds.value.length && !novel) throw new Error('请先选择小说，或关闭创作工具')
    return JSON.parse(JSON.stringify({ novel, writingToolIds: writingToolIds.value, skills: selectedSkills,
      servers: servers.value.filter(server => server.enabled && server.allowedTools.length).map(config => ({ config, bearerToken: credentials.value[config.id] })), maxSteps: maxSteps.value })) as ExtensionRequest
  }
  async function reload() {
    await queue
    const before = settings.value
    const next = readSettings()
    for (const id of Object.keys(credentials.value)) {
      if (!next.servers.some(server => server.id === id && before.servers.some(old => old.id === id && old.url === server.url))) delete credentials.value[id]
    }
    settings.value = next
  }
  async function reset() {
    pending.value++
    const result = queue.then(async () => {
      const next = normalizeExtensionSettings(null)
      await storage.write(next)
      settings.value = next
      credentials.value = Object.create(null)
      loadError.value = ''
    }).finally(() => { pending.value-- })
    queue = result.catch(() => undefined)
    return result
  }
  return { enabled, servers, importedSkills, skills, selectedNovelId, selectedSkillIds, writingToolIds, maxSteps,
    pending, loadError, credentials, updateSettings, saveServer, removeServer, importSkill, deleteSkill, setToken, captureRequest, reload, reset }
}

export const useExtensionsStore = defineStore('extensions', () => {
  const state = createExtensionsState({
    read: () => storageGetStrict(StorageKeys.extensions, null),
    write: settings => withStorageCommit(() => writeSerializedWithRetry(StorageKeys.extensions, JSON.stringify(settings))),
    update: change => withStorageCommit(() => {
      const next = change(normalizeExtensionSettings(storageGetStrict(StorageKeys.extensions, null)))
      writeSerializedWithRetry(StorageKeys.extensions, JSON.stringify(next))
      return next
    }),
    readNovels: () => storageGet<WriterNovel[]>(StorageKeys.novels, []),
  })
  if (typeof window !== 'undefined') {
    const onStorage = (event: StorageEvent) => { if (event.key === StorageKeys.extensions || event.key === null) void state.reload().catch(console.error) }
    window.addEventListener('storage', onStorage)
    onScopeDispose(() => window.removeEventListener('storage', onStorage))
  }
  return state
})
