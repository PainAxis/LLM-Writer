/** 备份服务回归：真实 StorageKeys、旧格式兼容、预先校验、写入失败及异步落盘。 */
import assert from 'node:assert/strict'
import {
  ALL_BACKUP_GROUPS, BACKUP_GROUPS, createBackup, parseBackup, restoreBackup,
} from '../src/services/backup'
import {
  StorageKeys, storageGet, storageSet, storageSetRaw, registerChunkedKey,
  type StorageKey,
} from '../src/utils/storage'

const store = new Map<string, string>()
let writes = 0
let failNextKey = ''
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes++
      if (key === failNextKey) {
        failNextKey = ''
        throw new Error('simulated storage failure')
      }
      store.set(key, value)
    },
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  },
})
const policy = { maxTokens: 1000, maxTurns: 8, retainTurns: 2, strategy: 'summary', summaryThreshold: 80 }
const novel = {
  id: 1, title: '备份小说', chapterList: [{ id: 11, title: '首章', content: '<p>正文</p>' }],
  characters: [{ id: 12, name: '人物' }], worldSettings: [{ id: 13, title: '世界' }],
  corpusData: [{ id: 14, content: '语料' }], events: [{ id: 15, title: '事件', chapter: '1' }],
}
const fixture: Partial<Record<StorageKey, unknown>> = {
  [StorageKeys.novels]: [novel],
  [StorageKeys.prompts]: [{ id: 1, title: '提示词', category: 'novel', content: '正文提示', tags: [] }],
  [StorageKeys.promptsVersion]: 7,
  [StorageKeys.novelGenres]: [{ code: 'fantasy', name: '玄幻', tags: [] }],
  [StorageKeys.writingGoals]: [{ id: 1, title: '目标', targetValue: 1000, currentValue: 10 }],
  [StorageKeys.apiConfig]: { apiKey: 'test-key', baseURL: 'https://example.test/v1', provider: 'custom', selectedModel: 'model', maxTokens: null, temperature: 0.7, unlimitedTokens: true, customHeaders: { 'x-test': 'test' } },
  [StorageKeys.customModels]: [{ id: 'model', name: '模型' }],
  [StorageKeys.providerModels]: { custom: ['model'] },
  [StorageKeys.shortStoryConfig]: { genres: [{ label: '玄幻', value: 'fantasy' }] },
  [StorageKeys.chapterSummaryPromptTemplate]: '请摘要：{章节正文}\n保留人物与事件',
  [StorageKeys.accountBalance]: '12.34',
  [StorageKeys.billingRecords]: [{ id: 1, timestamp: '2026-09-01T00:00:00Z', inputTokens: 10, outputTokens: 20, totalTokens: 30, cost: 0.1 }],
  [StorageKeys.tokenUsageStats]: { totalInputTokens: 10, totalOutputTokens: 20, totalCost: 0.1 },
  [StorageKeys.lastReadAnnouncementVersion]: 'v1',
  [StorageKeys.lastReadAnnouncementDate]: '2026-09-01',
  [StorageKeys.theme]: 'dark',
  [StorageKeys.assistants]: [{ id: 1, name: '助手', persona: '人设', contextPolicy: policy }],
  [StorageKeys.assistantConversations]: { 1: [{ id: 'message', content: '对话', isUser: true, timestamp: '2026-09-01' }] },
  [StorageKeys.assistantSummaries]: { 1: '摘要' },
  [StorageKeys.contextPolicy]: policy,
}

async function main() {
  const registered = Object.values(StorageKeys).filter(key => ![
    StorageKeys.officialApiConfig, StorageKeys.customApiConfig,
    StorageKeys.legacySettingsApiConfig, StorageKeys.legacySettingsTokenUsage,
  ].includes(key as never))
  assert.deepEqual(new Set(Object.values(BACKUP_GROUPS).flat()), new Set(registered), '备份应覆盖所有有效存储键')
  for (const [key, value] of Object.entries(fixture)) {
    if ([StorageKeys.chapterSummaryPromptTemplate, StorageKeys.lastReadAnnouncementVersion,
      StorageKeys.lastReadAnnouncementDate].includes(key as never)) storageSetRaw(key, value as string)
    else await storageSet(key, value)
  }
  await storageSet(StorageKeys.legacySettingsApiConfig, { apiKey: 'obsolete-test-key' })
  const backup = JSON.parse(JSON.stringify(createBackup()))
  assert.deepEqual(backup.data, fixture)
  store.clear()
  assert.equal(await restoreBackup(backup), ALL_BACKUP_GROUPS.length)
  assert.deepEqual(createBackup().data, fixture)
  assert.equal(store.get(StorageKeys.chapterSummaryPromptTemplate), fixture[StorageKeys.chapterSummaryPromptTemplate], '原始字符串不能多加 JSON 引号')
  assert.equal(store.get(StorageKeys.lastReadAnnouncementVersion), 'v1')
  assert.equal(store.get(StorageKeys.lastReadAnnouncementDate), '2026-09-01')
  assert.ok(!store.has(StorageKeys.legacySettingsApiConfig))
  console.log('✓ 完整备份覆盖全部有效键，小说素材、助手会话、设置、原始文本往返一致')

  for (const group of ALL_BACKUP_GROUPS) {
    const category = createBackup([group])
    assert.deepEqual(Object.keys(category.data).sort(), [...BACKUP_GROUPS[group]].sort())
    assert.equal(await restoreBackup(category, [group]), 1)
  }
  const novelsBefore = store.get(StorageKeys.novels)
  await restoreBackup({ novels: [], prompts: [] }, ['prompts'])
  assert.equal(store.get(StorageKeys.novels), novelsBefore)
  assert.deepEqual(storageGet(StorageKeys.prompts, null), [])
  assert.equal(storageGet(StorageKeys.promptsVersion, -1), 0)
  console.log('✓ 每类备份可单独恢复，选择性导入不覆盖未选数据，旧提示词触发版本刷新')

  const legacySettings = { apiConfig: fixture.apiConfig, tokenUsage: fixture.token_usage_stats }
  for (const input of [
    { version: 'v0.7.0', novels: [novel], settings: legacySettings },
    { type: 'settings', ...legacySettings },
  ]) {
    await restoreBackup(input)
    assert.deepEqual(storageGet(StorageKeys.apiConfig, null), fixture.apiConfig)
    assert.deepEqual(storageGet(StorageKeys.tokenUsageStats, null), fixture.token_usage_stats)
    assert.ok(!store.has(StorageKeys.legacySettingsApiConfig))
    assert.ok(!store.has(StorageKeys.legacySettingsTokenUsage))
  }
  for (const input of [
    { type: 'novels', novels: [novel] }, { type: 'prompts', prompts: [] },
    { type: 'genres', novelGenres: [] }, { goals: [] },
    { version: 'v0.7.0', novels: [], settings: { apiConfig: {}, tokenUsage: {} } },
  ]) assert.ok(await restoreBackup(input) > 0)
  console.log('✓ 旧完整、小说、提示词、题材、goals 别名与顶层 settings 备份兼容，旧错误空配置不会覆盖当前 API')

  const invalid = [
    null, [], {}, { format: 'llm-writer-backup', version: 3, data: {} },
    { novels: {} }, { novels: [null] }, { novels: [{ id: 1, title: '损坏', chapterList: '错误' }] },
    { novels: [{ id: 1, title: '损坏', chapterList: [{ id: 1, title: '章', content: 9 }] }] },
    { novels: [], settings: { apiConfig: { apiKey: 123 } } },
    { prompts: [{ id: 1, title: '损坏', content: {} }] }, { novelGenres: ['玄幻'] },
    { settings: { tokenUsage: { totalCost: '错误' } } },
    { format: 'llm-writer-backup', version: 2, data: { assistantConversations: { 1: [{}] } } },
    { format: 'llm-writer-backup', version: 2, data: { contextPolicy: { strategy: 'unknown' } } },
    { format: 'llm-writer-backup', version: 2, data: { 'api-config': {} } },
  ]
  const snapshot = new Map(store)
  const writeCount = writes
  for (const input of invalid) await assert.rejects(restoreBackup(input), /备份数据格式错误/)
  assert.deepEqual(store, snapshot)
  assert.equal(writes, writeCount, '任何已知字段损坏，都应在第一次写入前拒绝')
  assert.throws(() => parseBackup({ settings: '错误' }))
  console.log('✓ 损坏字段、未知版本和旧存储键注入均在写入前拒绝')

  const beforeFailure = new Map(store)
  const originalError = console.error
  console.error = () => {} // 注入的预期存储错误，不输出备份载荷。
  try {
    failNextKey = StorageKeys.prompts
    await assert.rejects(restoreBackup({ novels: [novel], prompts: [] }), /已恢复导入前的数据/)
  } finally {
    console.error = originalError
  }
  assert.deepEqual(store, beforeFailure)
  console.log('✓ 后续键写入失败会回滚前面已写入的数据')

  // 最后注册异步正文后端，验证 restore 真正等待持久化，而非只看到同步缓存更新。
  let persistedNovels: unknown = []
  let release: (() => void) | undefined
  let rejectWrite = false
  registerChunkedKey(StorageKeys.novels, {
    isReady: () => true,
    get: () => persistedNovels,
    async set(value) {
      if (rejectWrite) {
        rejectWrite = false
        throw new Error('simulated IndexedDB failure')
      }
      if (release === undefined) await new Promise<void>(resolve => { release = resolve })
      persistedNovels = value
    },
    remove: () => { persistedNovels = [] },
  })
  let finished = false
  const pending = restoreBackup({ novels: [novel] }).then(() => { finished = true })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(finished, false, '正文落盘完成前，导入不能报告成功')
  assert.ok(release)
  release()
  await pending
  assert.deepEqual(persistedNovels, [novel])
  rejectWrite = true
  await assert.rejects(restoreBackup({ novels: [] }), /已恢复导入前的数据/)
  assert.deepEqual(persistedNovels, [novel])
  console.log('✓ 正文导入等待异步持久化完成，拒绝会传回调用方并保留旧数据')
  console.log('\n=== ALL BACKUP TESTS PASSED ===')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
