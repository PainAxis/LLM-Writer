import { computed, ref, shallowRef } from 'vue'
import { createOfflineCampaignEngine } from '@/services/writerCampaign/engine'
import { decodeStorageBytes } from '@/services/writerCampaign/protocol'
import type { CampaignInspection, CampaignSnapshot, LegacyCampaignSnapshot } from '@/types/writerCampaign'

/** Presentation only. Neither these refs nor a saved manifest authorize execution. */
export interface CampaignLabEngine {
  list(): Promise<string[]>
  inspect(id: string): Promise<CampaignInspection | null>
  prepare(input: { campaignId: string; language: 'zh' | 'en' }): Promise<unknown>
  step(id: string): Promise<unknown>
  pause(id: string): Promise<unknown>
  resume(id: string): Promise<unknown>
  cancel(id: string): Promise<unknown>
  recoverSaveOnly(id: string): Promise<unknown>
  stopLocal(id?: string): void
}

type PersistentOutcome = 'none' | 'pending' | 'confirmed' | 'unconfirmed'
const blockedReason = '操作未确认。请重新读取持久状态；不要把未知请求当作可重试模型请求。'

export function useWriterCampaign(options: { engine?: CampaignLabEngine; newId?: () => string } = {}) {
  const engine: CampaignLabEngine = options.engine ?? createOfflineCampaignEngine()
  const ids = ref<string[]>([])
  const selectedId = ref('')
  const snapshot = shallowRef<CampaignInspection | null>(null)
  const busy = ref(false)
  const loading = ref(false)
  const error = ref('')
  const locallyStopped = ref(false)
  const persistentOutcome = ref<PersistentOutcome>('none')
  let desiredStop: 'paused' | 'cancelled' | null = null
  let owner = 0
  let readOwner = 0
  let disposed = false

  const valid = (token: number, id: string) => !disposed && token === owner && id === selectedId.value
  const status = computed(() => snapshot.value?.checkpoint.status ?? 'not_selected')
  const readOnly = computed(() => snapshot.value?.manifest.schemaVersion !== 2)
  const currentStorage = computed(() => {
    const value = snapshot.value
    if (!value || value.manifest.schemaVersion !== 2) return null
    // The verified inspection union has matching manifest/checkpoint versions.
    return (value as CampaignSnapshot).checkpoint.storage
  })
  const storageSummary = computed(() => {
    const value = snapshot.value
    if (!value) return null
    if (value.manifest.schemaVersion !== 2) return null
    const current = value as CampaignSnapshot
    return { written: decodeStorageBytes(current.checkpoint.storage.writtenBytes),
      limit: decodeStorageBytes(current.manifest.storage.limitBytes),
      outstanding: decodeStorageBytes(current.checkpoint.storage.outstandingBytes),
      recoveryRemaining: decodeStorageBytes(current.checkpoint.storage.recoveryRemainingBytes),
      released: decodeStorageBytes(current.checkpoint.storage.releasedBytes),
      openAllocations: current.checkpoint.storage.openAllocations.length }
  })
  const legacyStorageSummary = computed(() => {
    const value = snapshot.value
    if (!value || value.manifest.schemaVersion !== 1) return null
    const legacy = value as LegacyCampaignSnapshot
    return { written: legacy.checkpoint.budget.serializedBytes, reserved: legacy.checkpoint.budget.storageReservedBytes,
      limit: legacy.manifest.budget.serializedBytes }
  })
  const unresolved = computed(() => snapshot.value?.checkpoint.tasks.some(task =>
    ['dispatch_intent', 'outcome_unknown'].includes(task.status)) ?? false)
  const retained = computed(() => snapshot.value?.checkpoint.tasks.some(task => task.status === 'response_retained') ?? false)
  const canSaveOnly = computed(() => !readOnly.value && !busy.value && !loading.value && retained.value && desiredStop !== 'cancelled'
    && !['cancelled', 'completed'].includes(status.value))
  const canStep = computed(() => !readOnly.value && !busy.value && !loading.value && !locallyStopped.value && !unresolved.value && !retained.value
    && ['prepared', 'running'].includes(status.value))
  const canResume = computed(() => !readOnly.value && !busy.value && !loading.value && status.value === 'paused'
    && !unresolved.value && desiredStop !== 'cancelled')
  const canStop = computed(() => !readOnly.value && Boolean(selectedId.value) && !['cancelled', 'completed'].includes(status.value)
    && persistentOutcome.value !== 'pending')
  const taskRows = computed(() => snapshot.value?.checkpoint.tasks.map(task => ({ ...task,
    kind: snapshot.value!.manifest.tasks.find(spec => spec.id === task.taskId)?.kind ?? task.taskId,
  })) ?? [])
  const artifactRows = computed(() => [...(snapshot.value?.artifacts.values() ?? [])])
  const completedTasks = computed(() => taskRows.value.filter(task => task.status === 'committed').length)
  const requests = computed(() => [...(snapshot.value?.requests.values() ?? [])])
  const unknownRequests = computed(() => requests.value.filter(request =>
    ['dispatch_intent', 'outcome_unknown'].includes(request.status)).length)
  const inactiveUnknownRequests = computed(() => {
    const value = snapshot.value, storage = currentStorage.value
    if (!value || !storage) return 0
    const active = new Set(value.checkpoint.tasks.flatMap(task => task.request ? [task.request.hash] : []))
    return storage.openAllocations.filter(row => !active.has(row.request.hash)
      && ['dispatch_intent', 'outcome_unknown'].includes(value.requests.get(row.request.hash)?.status ?? '')).length
  })
  const observedUsage = computed(() => {
    let input = 0, output = 0, inputs = 0, outputs = 0, unknown = 0
    for (const request of requests.value) {
      const usage = request.response?.usage
      if (!usage || usage.inputTokens === null || usage.outputTokens === null) unknown++
      if (usage?.inputTokens !== null && usage?.inputTokens !== undefined) { input += usage.inputTokens; inputs++ }
      if (usage?.outputTokens !== null && usage?.outputTokens !== undefined) { output += usage.outputTokens; outputs++ }
    }
    return { input: inputs ? input : null, output: outputs ? output : null, unknown }
  })

  const publish = (value: CampaignInspection | null) => {
    snapshot.value = value
    if (desiredStop) {
      persistentOutcome.value = value?.checkpoint.status === desiredStop ? 'confirmed' : 'unconfirmed'
    }
  }
  async function readSelected(token: number, id: string) {
    const value = await engine.inspect(id)
    if (!valid(token, id)) return false
    publish(value)
    return true
  }
  async function refresh() {
    if (disposed || busy.value) return false
    const token = owner, id = selectedId.value, read = ++readOwner
    loading.value = true; error.value = ''
    try {
      const found = await engine.list()
      if (disposed || token !== owner || read !== readOwner) return false
      ids.value = [...found]
      if (id) {
        const value = await engine.inspect(id)
        if (!valid(token, id) || read !== readOwner) return false
        publish(value)
      }
      return true
    } catch {
      if (!disposed && token === owner && read === readOwner) error.value = blockedReason
      return false
    } finally {
      if (!disposed && token === owner && read === readOwner) loading.value = false
    }
  }
  async function select(id: string) {
    if (disposed || !ids.value.includes(id)) return false
    engine.stopLocal(selectedId.value || undefined)
    owner++; readOwner++
    busy.value = false; loading.value = false
    selectedId.value = id; snapshot.value = null; error.value = ''
    locallyStopped.value = false; desiredStop = null; persistentOutcome.value = 'none'
    return refresh()
  }
  async function create(language: 'zh' | 'en') {
    if (disposed || busy.value || loading.value) return false
    engine.stopLocal(selectedId.value || undefined)
    owner++; readOwner++
    const token = owner
    const id = options.newId?.() ?? `campaign-${crypto.randomUUID()}`
    selectedId.value = id; snapshot.value = null; busy.value = true; error.value = ''
    locallyStopped.value = false; desiredStop = null; persistentOutcome.value = 'none'
    try {
      await engine.prepare({ campaignId: id, language })
      if (!valid(token, id)) return false
      if (!await readSelected(token, id)) return false
      const found = await engine.list()
      if (!valid(token, id)) return false
      ids.value = [...found]
      return true
    } catch {
      if (valid(token, id)) error.value = blockedReason
      return false
    } finally { if (valid(token, id)) busy.value = false }
  }
  async function execute(action: 'step' | 'resume' | 'recoverSaveOnly') {
    if (disposed || (action === 'step' ? !canStep.value : action === 'resume' ? !canResume.value : !canSaveOnly.value)) return false
    const token = ++owner, id = selectedId.value
    readOwner++; loading.value = false; busy.value = true; error.value = ''
    try {
      await engine[action](id)
      if (!valid(token, id)) return false
      if (!await readSelected(token, id)) return false
      if ((action === 'resume' || action === 'recoverSaveOnly') && ['running', 'completed'].includes(snapshot.value?.checkpoint.status ?? '')) {
        locallyStopped.value = false; desiredStop = null; persistentOutcome.value = 'none'
      }
      return true
    } catch {
      if (valid(token, id)) {
        error.value = blockedReason
        // A rejected acknowledgment is not proof of a failed durable commit.
        try { await readSelected(token, id) } catch { /* Preserve uncertainty. */ }
      }
      return false
    } finally { if (valid(token, id)) busy.value = false }
  }
  async function stop(action: 'pause' | 'cancel') {
    if (disposed || !canStop.value) return false
    const token = ++owner, id = selectedId.value
    readOwner++
    // Synchronous revocation precedes the first await, including resolve→cancel races.
    engine.stopLocal(id)
    locallyStopped.value = true; desiredStop = action === 'cancel' ? 'cancelled' : 'paused'
    persistentOutcome.value = 'pending'; busy.value = true; loading.value = false; error.value = ''
    try {
      await engine[action](id)
      if (!valid(token, id)) return false
      if (!await readSelected(token, id)) return false
      return snapshot.value?.checkpoint.status === (action === 'cancel' ? 'cancelled' : 'paused')
    } catch {
      if (valid(token, id)) {
        persistentOutcome.value = 'unconfirmed'
        error.value = '本实例已停止；持久状态未确认。已持久化的 dispatch intent 仍可能调用，不能承诺零请求。'
      }
      return false
    } finally { if (valid(token, id)) busy.value = false }
  }
  function dispose() {
    if (disposed) return
    disposed = true; owner++; readOwner++
    engine.stopLocal()
  }

  return { ids, selectedId, snapshot, busy, loading, error, status, locallyStopped, persistentOutcome,
    canStep, canResume, canStop, canSaveOnly, unresolved, taskRows, artifactRows, completedTasks, requests,
    unknownRequests, inactiveUnknownRequests, readOnly, storageSummary, legacyStorageSummary, observedUsage, refresh, select, create,
    step: () => execute('step'), saveOnly: () => execute('recoverSaveOnly'), resume: () => execute('resume'), pause: () => stop('pause'), cancel: () => stop('cancel'), dispose }
}
