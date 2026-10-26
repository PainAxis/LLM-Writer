import { computed, ref, shallowRef } from 'vue'
import { createOfflineCampaignEngine } from '@/services/writerCampaign/engine'
import type { PlanningPreviewResult } from '@/services/writerCampaign/planningContext'
import { isPlanningProfile } from '@/services/writerCampaign/planningProfile'
import { decodeStorageBytes, utf8Bytes } from '@/services/writerCampaign/protocol'
import { buildBodyEvidenceFixtureProposal } from '@/services/writerCampaign/bodyEvidenceFixture'
import { BODY_EVIDENCE_LIMITS, BodyEvidenceRefusalError, type BodyEvidencePacket, type BodyEvidencePreviewResult, type BodyEvidenceRefusalCode } from '@/services/writerCampaign/bodyEvidenceProtocol'
import type { CampaignInspection, CampaignSnapshot, LegacyCampaignSnapshot } from '@/types/writerCampaign'

/** Presentation only. Neither these refs nor a saved manifest authorize execution. */
export interface CampaignLabEngine {
  list(): Promise<string[]>
  inspect(id: string): Promise<CampaignInspection | null>
  prepare(input: { campaignId: string; language: 'zh' | 'en' }): Promise<unknown>
  prepareBodyEvidence?(input: { campaignId: string; language: 'zh' | 'en' }): Promise<unknown>
  previewBodyEvidence?(id: string, proposalText: string): Promise<BodyEvidencePreviewResult>
  cancelPreviews?(id?: string): void
  preparePlanning?(input: { campaignId: string; language: 'zh' | 'en' }): Promise<unknown>
  previewPlanningContext?(id: string, chapterOrdinal: number): Promise<PlanningPreviewResult>
  step(id: string): Promise<unknown>
  pause(id: string): Promise<unknown>
  resume(id: string): Promise<unknown>
  cancel(id: string): Promise<unknown>
  recoverSaveOnly(id: string): Promise<unknown>
  stopLocal(id?: string): void
}

type PersistentOutcome = 'none' | 'pending' | 'confirmed' | 'unconfirmed'
const blockedReason = '操作未确认。请重新读取持久状态；不要把未知请求当作可重试模型请求。'

export function useWriterCampaign(options: { engine?: CampaignLabEngine; newId?: () => string; bodyEvidenceDraftBuilder?: typeof buildBodyEvidenceFixtureProposal } = {}) {
  const engine: CampaignLabEngine = options.engine ?? createOfflineCampaignEngine()
  const ids = ref<string[]>([])
  const selectedId = ref('')
  const snapshot = shallowRef<CampaignInspection | null>(null)
  const busy = ref(false)
  const loading = ref(false)
  const error = ref('')
  const locallyStopped = ref(false)
  const persistentOutcome = ref<PersistentOutcome>('none')
  const selectedChapter = ref(1)
  const planningPreview = shallowRef<PlanningPreviewResult | null>(null)
  const previewLoading = ref(false)
  const bodyPrefix = ref(1)
  const bodyDraft = ref('')
  const bodyPreview = shallowRef<BodyEvidencePreviewResult | null>(null)
  const bodyPreviewLoading = ref(false)
  const bodyDraftLoading = ref(false)
  const bodyDraftRefusal = ref<BodyEvidenceRefusalCode | ''>('')
  let bodyDraftOwner = 0, bodyEditorRevision = 0
  let draftController: AbortController | null = null
  let previewOwner = 0
  let desiredStop: 'paused' | 'cancelled' | null = null
  let owner = 0
  let readOwner = 0
  let disposed = false

  const valid = (token: number, id: string) => !disposed && token === owner && id === selectedId.value
  const status = computed(() => snapshot.value?.checkpoint.status ?? 'not_selected')
  const readOnly = computed(() => snapshot.value?.manifest.schemaVersion !== 2)
  const planningProfile = computed(() => {
    const value = snapshot.value
    return value?.manifest.schemaVersion === 2 && isPlanningProfile(value.manifest.fixtureVersion)
  })
  const chapterRows = computed(() => planningProfile.value
    ? snapshot.value!.manifest.tasks.filter(task => task.kind === 'chapter_outline').map(task => ({
      ordinal: task.chapterOrdinal!, taskId: task.id,
      status: snapshot.value!.checkpoint.tasks.find(state => state.taskId === task.id)?.status ?? 'pending',
    })) : [])
  const canPreview = computed(() => planningProfile.value && !busy.value && !loading.value
    && Boolean(engine.previewPlanningContext))
  const planningAvailable = Boolean(engine.preparePlanning && engine.previewPlanningContext)
  const bodyEvidenceAvailable = Boolean(engine.prepareBodyEvidence && engine.previewBodyEvidence)
  const bodyPrefixRows = computed(() => {
    if (!planningProfile.value || !snapshot.value) return []
    const rows: Array<{ ordinal: number; taskId: string }> = []
    for (const task of snapshot.value.manifest.tasks.filter(task => task.kind === 'chapter_body').sort((a, b) => a.chapterOrdinal! - b.chapterOrdinal!)) {
      const state = snapshot.value.checkpoint.tasks.find(state => state.taskId === task.id)
      if (state?.status !== 'committed' || !state.artifact) break
      rows.push({ ordinal: task.chapterOrdinal!, taskId: task.id })
    }
    return rows
  })
  const bodyPacket = computed<BodyEvidencePacket | null>(() => {
    const value = bodyPreview.value
    if (value?.status !== 'ready') return null
    // This is bounded escaped presentation, not a source or authority cache.
    try { return JSON.parse(value.packetText) as BodyEvidencePacket } catch { return null }
  })
  const bodyClaimCounts = computed(() => {
    const counts: Record<string, number> = {}
    for (const claim of bodyPacket.value?.claims ?? []) counts[claim.kind] = (counts[claim.kind] ?? 0) + 1
    return counts
  })
  const canLoadBodyDraft = computed(() => planningProfile.value && !busy.value && !loading.value
    && bodyPrefixRows.value.some(row => row.ordinal === bodyPrefix.value))
  const canPreviewBody = computed(() => planningProfile.value && !busy.value && !loading.value && !bodyDraftLoading.value
    && Boolean(engine.previewBodyEvidence) && bodyDraft.value.length > 0)
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

  function cancelDraftLoad() {
    bodyDraftOwner++; draftController?.abort(); draftController = null; bodyDraftLoading.value = false
  }
  function clearPreview() {
    previewOwner++; engine.cancelPreviews?.(selectedId.value || undefined)
    previewLoading.value = false; planningPreview.value = null
    bodyPreviewLoading.value = false; bodyPreview.value = null
    cancelDraftLoad()
  }
  function clearBodyDraft() {
    bodyEditorRevision++; bodyDraft.value = ''; bodyDraftRefusal.value = ''; bodyPrefix.value = 1
  }
  function setBodyDraft(value: string): boolean {
    if (disposed) return false
    clearPreview(); bodyEditorRevision++; bodyDraftRefusal.value = ''
    // Reject, never truncate or retain, oversized editable source. The engine still
    // independently validates this untrusted string before reading any source.
    try {
      if (typeof value !== 'string' || value.length > BODY_EVIDENCE_LIMITS.envelopeUtf16 || utf8Bytes(value) > BODY_EVIDENCE_LIMITS.envelopeBytes) throw new BodyEvidenceRefusalError('envelope_budget_exceeded')
      bodyDraft.value = value
      return true
    } catch (error) {
      bodyDraft.value = ''
      bodyDraftRefusal.value = error instanceof BodyEvidenceRefusalError ? error.code : 'invalid_scalar_text'
      return false
    }
  }
  function selectBodyPrefix(ordinal: number) {
    if (disposed || !bodyPrefixRows.value.some(row => row.ordinal === ordinal)) return false
    clearPreview(); bodyPrefix.value = ordinal; bodyDraftRefusal.value = ''
    return true
  }
  async function loadBodyEvidenceExample() {
    if (disposed || !canLoadBodyDraft.value || snapshot.value?.manifest.schemaVersion !== 2) return false
    clearPreview(); bodyDraftRefusal.value = ''
    const id = selectedId.value, token = owner, ordinal = bodyPrefix.value, editor = bodyEditorRevision
    const source = snapshot.value as CampaignSnapshot, load = ++bodyDraftOwner, controller = new AbortController(), started = performance.now()
    draftController = controller; bodyDraftLoading.value = true
    const current = () => valid(token, id) && bodyDraftOwner === load && draftController === controller
      && bodyPrefix.value === ordinal && bodyEditorRevision === editor && !controller.signal.aborted
    const check = () => {
      if (!current()) throw new BodyEvidenceRefusalError('cancelled')
      if (performance.now() - started >= 10_000) throw new BodyEvidenceRefusalError('deadline_exceeded')
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort: (() => void) | undefined
    try {
      const proposal = await new Promise<string>((resolve, reject) => {
        let settled = false
        const finish = (error: unknown, value?: string) => {
          if (settled) return
          settled = true; if (timer !== undefined) clearTimeout(timer)
          if (abort) controller.signal.removeEventListener('abort', abort)
          if (error) reject(error); else resolve(value!)
        }
        abort = () => finish(new BodyEvidenceRefusalError('cancelled'))
        controller.signal.addEventListener('abort', abort, { once: true })
        timer = setTimeout(() => finish(new BodyEvidenceRefusalError('deadline_exceeded')), Math.max(0, 10_000 - (performance.now() - started)))
        try {
          check()
          Promise.resolve((options.bodyEvidenceDraftBuilder ?? buildBodyEvidenceFixtureProposal)(source, ordinal, check)).then(value => {
            try { check(); finish(null, value) } catch (error) { finish(error) }
          }, error => finish(error))
        } catch (error) { finish(error) }
      })
      check()
      if (proposal.length > BODY_EVIDENCE_LIMITS.envelopeUtf16 || utf8Bytes(proposal) > BODY_EVIDENCE_LIMITS.envelopeBytes) throw new BodyEvidenceRefusalError('envelope_budget_exceeded')
      bodyDraft.value = proposal; bodyEditorRevision++
      return true
    } catch (error) {
      if (current()) bodyDraftRefusal.value = error instanceof BodyEvidenceRefusalError ? error.code : 'preview_unavailable'
      return false
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (abort) controller.signal.removeEventListener('abort', abort)
      // A successful adoption increments editor revision; cleanup is keyed to the
      // loader identity, not the now-superseded editor revision.
      if (bodyDraftOwner === load && draftController === controller) { bodyDraftLoading.value = false; draftController = null }
      controller.abort()
    }
  }
  async function previewBody() {
    if (disposed || !canPreviewBody.value) return false
    clearPreview()
    const id = selectedId.value, token = owner, preview = ++previewOwner, editor = bodyEditorRevision, proposal = bodyDraft.value
    bodyPreviewLoading.value = true
    const current = () => valid(token, id) && preview === previewOwner && editor === bodyEditorRevision && proposal === bodyDraft.value
    try {
      const result = await engine.previewBodyEvidence!(id, proposal)
      if (!current()) return false
      bodyPreview.value = result
      return result.status === 'ready'
    } catch {
      if (current()) bodyPreview.value = { status: 'refused', refusalCode: 'preview_unavailable' }
      return false
    } finally { if (current()) bodyPreviewLoading.value = false }
  }
  async function previewChapter(ordinal: number) {
    if (disposed || !canPreview.value || !chapterRows.value.some(row => row.ordinal === ordinal)) return false
    clearPreview()
    const id = selectedId.value, token = owner, preview = ++previewOwner
    selectedChapter.value = ordinal; planningPreview.value = null; previewLoading.value = true
    const current = () => valid(token, id) && preview === previewOwner && selectedChapter.value === ordinal
    try {
      const result = await engine.previewPlanningContext!(id, ordinal)
      if (!current()) return false
      planningPreview.value = result
      return result.status === 'ready'
    } catch {
      if (current()) planningPreview.value = { status: 'refused', refusalCode: 'preview_unavailable' }
      return false
    } finally { if (current()) previewLoading.value = false }
  }
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
    clearPreview()
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
    owner++; readOwner++; clearPreview(); clearBodyDraft(); selectedChapter.value = 1
    busy.value = false; loading.value = false
    selectedId.value = id; snapshot.value = null; error.value = ''
    locallyStopped.value = false; desiredStop = null; persistentOutcome.value = 'none'
    return refresh()
  }
  async function createProfile(language: 'zh' | 'en', profile: 'legacy' | 'planning' | 'body-evidence') {
    if (disposed || busy.value || loading.value || (profile === 'planning' && !planningAvailable) || (profile === 'body-evidence' && !bodyEvidenceAvailable)) return false
    engine.stopLocal(selectedId.value || undefined)
    owner++; readOwner++; clearPreview(); clearBodyDraft(); selectedChapter.value = 1
    const token = owner
    const id = options.newId?.() ?? `campaign-${crypto.randomUUID()}`
    selectedId.value = id; snapshot.value = null; busy.value = true; error.value = ''
    locallyStopped.value = false; desiredStop = null; persistentOutcome.value = 'none'
    try {
      if (profile === 'body-evidence') await engine.prepareBodyEvidence!({ campaignId: id, language })
      else if (profile === 'planning') await engine.preparePlanning!({ campaignId: id, language })
      else await engine.prepare({ campaignId: id, language })
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
    readOwner++; clearPreview(); loading.value = false; busy.value = true; error.value = ''
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
    readOwner++; clearPreview()
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
    disposed = true; owner++; readOwner++; clearPreview(); clearBodyDraft()
    engine.stopLocal()
  }

  return { ids, selectedId, snapshot, busy, loading, error, status, locallyStopped, persistentOutcome,
    canStep, canResume, canStop, canSaveOnly, unresolved, taskRows, artifactRows, completedTasks, requests,
    unknownRequests, inactiveUnknownRequests, readOnly, storageSummary, legacyStorageSummary, observedUsage, refresh, select,
    planningAvailable, planningProfile, chapterRows, selectedChapter, planningPreview, previewLoading, canPreview, previewChapter,
    bodyEvidenceAvailable, bodyPrefixRows, bodyPrefix, bodyDraft, bodyPreview, bodyPacket, bodyClaimCounts, bodyPreviewLoading, bodyDraftLoading, bodyDraftRefusal,
    canLoadBodyDraft, canPreviewBody, setBodyDraft, selectBodyPrefix, loadBodyEvidenceExample, previewBody,
    createBodyEvidence: (language: 'zh' | 'en') => createProfile(language, 'body-evidence'),
    create: (language: 'zh' | 'en') => createProfile(language, 'legacy'),
    createPlanning: (language: 'zh' | 'en') => createProfile(language, 'planning'),
    step: () => execute('step'), saveOnly: () => execute('recoverSaveOnly'), resume: () => execute('resume'), pause: () => stop('pause'), cancel: () => stop('cancel'), dispose }
}
