import { computed, getCurrentInstance, inject, ref, shallowRef } from 'vue'
import type { CampaignInspection } from '@/types/writerCampaign'
import type { BodyProducerEngine, BodyProducerReview, BodyProducerVerificationEvent, PreparedBodyProducerHandle, ProducerCampaignSnapshot, ProducerVerificationProgress } from '@/types/bodyProducer'
import type { PlanningRecordIdentity } from '@/services/writerCampaign/bodyEvidenceProtocol'
import { createBodyProducerEngine } from '@/services/writerCampaign/bodyProducerEngine'
import { buildPlanningCanon } from '@/services/writerCampaign/planningCanon'
import { isPlanningProfile } from '@/services/writerCampaign/planningProfile'
import { canonicalStringify, hashText, utf8Bytes } from '@/services/writerCampaign/protocol'
import { bodyProducerEngineKey } from './bodyProducerHost'

const SAFE_CODES = new Set(['source_changed', 'cancelled', 'deadline_exceeded', 'operation_timeout', 'verification_capacity', 'verification_quantum_exceeded', 'preview_unavailable', 'invalid_input', 'invalid_selection',
  'invalid_response', 'response_capacity', 'budget_exhausted', 'unauthorized', 'producer_unavailable', 'configuration_changed',
  'storage_unknown', 'conflict', 'operation_conflict', 'unsupported_profile', 'unsupported_schema', 'source_identity_mismatch',
  'request_capacity', 'input_capacity', 'planning_capacity', 'review_capacity', 'expired', 'not_adopted', 'unknown_request',
  'runtime_identity_changed', 'no_accepted_body', 'incomplete_plan', 'invalid_scalar_text', 'body_revision_capacity',
  'producer_not_enabled', 'operation_in_progress', 'invalid_adapter', 'binding_mismatch', 'invalid_reference', 'output_capacity', 'authorization_required',
  'producer_not_authorized', 'invalid_prepared_handle', 'prepared_expired', 'prepared_revoked', 'recovery_pending', 'request_limit', 'request_missing', 'response_missing',
  'missing_dispatch_intent', 'dispatch_outcome_unknown', 'no_retained_response', 'clock_rollback', 'invalid_output', 'unsupported_purpose'])
const safeError = (error: unknown) => {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null
  return typeof code === 'string' && SAFE_CODES.has(code) ? code : 'operation_unconfirmed'
}
const scalarBoundary = (text: string, at: number) => at === 0 || at === text.length
  || !(text.charCodeAt(at - 1) >= 0xd800 && text.charCodeAt(at - 1) <= 0xdbff && text.charCodeAt(at) >= 0xdc00 && text.charCodeAt(at) <= 0xdfff)
export interface BodyProducerPlanningChoice { key: string; identity: PlanningRecordIdentity; label: string }
export interface BodyProducerRevisionPreview {
  text: string; hash: string; bytes: number; utf16: number; sourceEpoch: number; expectedRawHead: string; chapterOrdinal: number; invalidatedChapters: number[]
}
export interface BodyProducerUiOptions {
  engine?: BodyProducerEngine
  legacySnapshot?: () => CampaignInspection | null
  operationId?: () => string
  onVersion?: (version: 3 | null) => void
}

/** Presentation ownership only. Every mutation and transport grant is independently checked by the engine. */
export function useBodyProducer(options: BodyProducerUiOptions = {}) {
  const engine = options.engine ?? (getCurrentInstance() ? inject(bodyProducerEngineKey, null) : null) ?? createBodyProducerEngine()
  const campaignId = ref(''), snapshot = shallowRef<ProducerCampaignSnapshot | null>(null), knownV3 = ref(false)
  const loading = ref(false), busy = ref(false), error = ref(''), notice = ref('')
  const chapterOrdinal = ref(1), startUtf16 = ref(0), endUtf16 = ref(0), producerId = ref('')
  const planningChoices = shallowRef<BodyProducerPlanningChoice[]>([]), selectedPlanningKeys = ref<string[]>([])
  const prepared = shallowRef<PreparedBodyProducerHandle | null>(null)
  const currentReview = shallowRef<BodyProducerReview | null>(null)
  const verification = shallowRef<{ status: 'started' | 'progress'; progress: ProducerVerificationProgress | null } | null>(null)
  const revisionText = ref(''), revisionPreview = shallowRef<BodyProducerRevisionPreview | null>(null), revisionPreviewLoading = ref(false)
  let owner = 0, readOwner = 0, inputOwner = 0, revisionOwner = 0, disposed = false
  let sourceIdentity = '', invokePromise: Promise<boolean> | null = null
  let verificationGeneration = 0, unsubscribeVerification: (() => void) | null = null
  const nextOperation = () => options.operationId?.() ?? `producer-ui-${crypto.randomUUID()}`
  const valid = (token: number, id: string) => !disposed && token === owner && id === campaignId.value
  const producers = computed(() => [...engine.availableProducers()])
  const legacy = computed(() => {
    const value = options.legacySnapshot?.()
    return value?.manifest.campaignId === campaignId.value ? value : null
  })
  const canAdopt = computed(() => {
    const value = legacy.value
    if (busy.value || loading.value || snapshot.value || knownV3.value || value?.manifest.schemaVersion !== 2 || value.checkpoint.status !== 'completed') return false
    try { return isPlanningProfile(value.manifest.fixtureVersion) && 'storage' in value.checkpoint && value.checkpoint.storage.openAllocations.length === 0 }
    catch { return false }
  })
  const chapterRows = computed(() => {
    const value = snapshot.value
    if (!value) return []
    let prefix = true
    return value.source.sourceManifest.tasks.filter(task => task.kind === 'chapter_body').sort((a, b) => a.chapterOrdinal! - b.chapterOrdinal!).map(task => {
      const state = value.source.tasks.find(row => row.taskId === task.id)!
      const current = state.artifact ? value.source.artifacts.get(state.artifact.hash) : null
      const prior = state.priorArtifact ? value.artifacts.get(state.priorArtifact.hash) : null
      prefix = prefix && state.status === 'committed' && Boolean(current)
      return { ordinal: task.chapterOrdinal!, taskId: task.id, status: state.status, eligible: prefix, artifact: current ?? prior ?? null }
    })
  })
  const selectedChapter = computed(() => chapterRows.value.find(row => row.ordinal === chapterOrdinal.value) ?? null)
  const selectedText = computed(() => selectedChapter.value?.artifact?.text ?? '')
  const selectedWindow = computed(() => selectedText.value.slice(startUtf16.value, endUtf16.value))
  const windowValid = computed(() => Number.isSafeInteger(startUtf16.value) && Number.isSafeInteger(endUtf16.value)
    && startUtf16.value >= 0 && startUtf16.value < endUtf16.value && endUtf16.value <= selectedText.value.length
    && endUtf16.value - startUtf16.value <= 4096 && scalarBoundary(selectedText.value, startUtf16.value) && scalarBoundary(selectedText.value, endUtf16.value))
  const canPrepare = computed(() => !busy.value && !loading.value && snapshot.value?.checkpoint.status === 'active'
    && selectedChapter.value?.eligible && windowValid.value && producers.value.some(row => row.adapterId === producerId.value))
  const canInvoke = computed(() => !busy.value && !loading.value && prepared.value?.invocationAllowed === true)
  const canRevise = computed(() => !busy.value && !loading.value && snapshot.value?.checkpoint.status === 'active' && Boolean(selectedChapter.value?.artifact))
  const requestRows = computed(() => {
    const value = snapshot.value
    if (!value) return []
    return value.checkpoint.producerRequests.map(index => {
      const request = value.requests.get(index.requestHash), phase = value.phases.get(index.phaseHash)
      const response = phase?.responseHash ? value.responses.get(phase.responseHash) : null
      const reason = phase?.resolution?.reason ?? phase?.reason
      return { id: index.id, request, phase, usage: response?.usage ?? null, refusalReason: reason ? safeError({ code: reason }) : null, stale: Boolean(request && (request.sourceEpoch !== value.checkpoint.sourceEpoch
        || request.aggregateManifestHash !== value.manifest.hash)), unknown: phase?.status === 'dispatch_intent' || phase?.status === 'outcome_unknown',
      canRecover: Boolean(request && phase && (phase.status !== 'resolved' || phase.responseHash)) }
    })
  })
  const unknownCount = computed(() => requestRows.value.filter(row => row.unknown).length)

  function clearVerification() {
    verificationGeneration++; verification.value = null
    const unsubscribe = unsubscribeVerification; unsubscribeVerification = null; unsubscribe?.()
  }
  function observeVerification(token: number, id: string, current: () => boolean = () => true) {
    clearVerification()
    const generation = verificationGeneration, completedOwners = new Set<number>()
    let engineOwnerId: number | null = null
    const listener = (event: BodyProducerVerificationEvent) => {
      if (!valid(token, id) || generation !== verificationGeneration || !current() || event.campaignId !== id) return
      if (event.status === 'started') {
        if (engineOwnerId !== null || completedOwners.has(event.ownerId)) return
        engineOwnerId = event.ownerId; verification.value = { status: 'started', progress: null }; return
      }
      if (engineOwnerId !== event.ownerId) return
      if (event.status === 'progress' && event.progress) {
        const p = event.progress
        // Copy only closed metadata. A progress event never supplies a source,
        // prepared handle or review, and completion does not publish readiness.
        verification.value = { status: 'progress', progress: { purpose: p.purpose, stage: p.stage,
          verifiedOperations: p.verifiedOperations, verifiedRecords: p.verifiedRecords, capturedBytes: p.capturedBytes,
          capturedEntries: p.capturedEntries, totalOperations: p.totalOperations } }
      } else if (['completed', 'failed', 'cancelled'].includes(event.status)) {
        completedOwners.add(event.ownerId); engineOwnerId = null; verification.value = null
      }
    }
    unsubscribeVerification = engine.subscribeVerification?.(listener) ?? null
    return () => { if (generation === verificationGeneration) clearVerification() }
  }
  function clearPrepared(revoke = false) {
    // Input replacement revokes the engine capability, including a handle retained
    // by a queued click. Publication only clears presentation: it must not cancel
    // the invocation whose durable result is being published.
    if (revoke) { clearVerification(); if (campaignId.value) engine.cancelLocal(campaignId.value) }
    inputOwner++; prepared.value = null; currentReview.value = null
  }
  function clearRevisionPreview() { revisionOwner++; revisionPreview.value = null; revisionPreviewLoading.value = false }
  function clearSourceViews() {
    clearPrepared(); clearRevisionPreview(); planningChoices.value = []; selectedPlanningKeys.value = []
    revisionText.value = ''; sourceIdentity = ''; notice.value = ''
  }
  function syncSelection() {
    if (!chapterRows.value.some(row => row.ordinal === chapterOrdinal.value)) chapterOrdinal.value = chapterRows.value[0]?.ordinal ?? 1
    startUtf16.value = 0; endUtf16.value = Math.min(4096, selectedText.value.length)
    if (!scalarBoundary(selectedText.value, endUtf16.value)) endUtf16.value--
    revisionText.value = selectedText.value; clearRevisionPreview()
  }
  async function publish(value: ProducerCampaignSnapshot | null, token: number, id: string) {
    if (!valid(token, id)) return false
    snapshot.value = value; if (value) knownV3.value = true; options.onVersion?.(knownV3.value ? 3 : null)
    if (!value) { clearSourceViews(); if (knownV3.value) notice.value = 'persisted_source_unavailable'; return true }
    const identity = `${value.manifest.hash}/${value.checkpoint.sourceEpoch}/${value.checkpoint.candidateId}`
    if (sourceIdentity !== identity) {
      clearSourceViews(); syncSelection()
      const started = performance.now()
      const check = () => { if (!valid(token, id) || snapshot.value !== value || performance.now() - started >= 10_000) throw new Error('cancelled') }
      const artifacts = value.source.sourceManifest.tasks.filter(task => task.kind !== 'chapter_body').map(task => {
        const state = value.source.tasks.find(row => row.taskId === task.id)!
        return value.source.artifacts.get(state.artifact!.hash)!
      })
      try {
        const canon = await buildPlanningCanon(value.source.sourceManifest, artifacts, check)
        check()
        sourceIdentity = identity
        planningChoices.value = canon.records.map(row => {
          const identity: PlanningRecordIdentity = { artifact: row.artifact, recordKind: row.recordKind, recordId: row.recordId }
          return { key: canonicalStringify(identity), identity, label: `${row.recordKind} · ${row.recordId}` }
        })
      } catch (cause) { if (valid(token, id) && snapshot.value === value) { sourceIdentity = ''; planningChoices.value = []; error.value = safeError(cause) } }
    }
    return valid(token, id) && snapshot.value === value
  }
  async function refresh() {
    if (disposed || busy.value || !campaignId.value) return false
    clearPrepared(true); clearRevisionPreview()
    const token = owner, id = campaignId.value, read = ++readOwner
    loading.value = true; error.value = ''
    const stopVerification = observeVerification(token, id, () => read === readOwner)
    try {
      const value = await engine.inspect(id)
      if (!valid(token, id) || read !== readOwner) return false
      return await publish(value, token, id)
    } catch (cause) { if (valid(token, id) && read === readOwner) { error.value = safeError(cause); snapshot.value = null; options.onVersion?.(knownV3.value ? 3 : null) }; return false }
    finally { stopVerification(); if (valid(token, id) && read === readOwner) loading.value = false }
  }
  async function select(id: string) {
    if (disposed) return false
    clearVerification()
    engine.cancelLocal(campaignId.value || undefined)
    owner++; readOwner++; clearSourceViews(); snapshot.value = null; busy.value = false; loading.value = false; invokePromise = null
    campaignId.value = id; knownV3.value = false; chapterOrdinal.value = 1; error.value = ''; options.onVersion?.(null)
    producerId.value = producers.value[0]?.adapterId ?? ''
    return id ? refresh() : true
  }
  function setChapter(ordinal: number) {
    if (disposed || busy.value || loading.value || !chapterRows.value.some(row => row.ordinal === ordinal)) return false
    clearPrepared(true); chapterOrdinal.value = ordinal; selectedPlanningKeys.value = []; syncSelection(); return true
  }
  function setWindow(start: number, end: number) {
    if (disposed || busy.value || loading.value || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return false
    clearPrepared(true); startUtf16.value = start; endUtf16.value = end; return true
  }
  function setProducer(id: string) {
    if (disposed || busy.value || loading.value || !producers.value.some(row => row.adapterId === id)) return false
    clearPrepared(true); producerId.value = id; return true
  }
  function setPlanning(keys: string[]) {
    if (disposed || busy.value || loading.value || keys.length > 32 || new Set(keys).size !== keys.length
      || keys.some(key => !planningChoices.value.some(row => row.key === key))) return false
    clearPrepared(true); selectedPlanningKeys.value = [...keys]; return true
  }
  function setRevisionText(text: string) {
    if (disposed || busy.value || loading.value) return false
    clearRevisionPreview(); clearPrepared(true)
    try { if (text.length > 65_536 || utf8Bytes(text) > 65_536) throw new Error('capacity'); revisionText.value = text; error.value = ''; return true }
    catch { error.value = 'body_revision_capacity'; return false }
  }
  async function previewRevision() {
    if (!canRevise.value || disposed) return false
    clearRevisionPreview()
    const token = owner, id = campaignId.value, revision = ++revisionOwner, text = revisionText.value
    const epoch = snapshot.value!.checkpoint.sourceEpoch, expectedRawHead = snapshot.value!.rawHead, ordinal = chapterOrdinal.value
    revisionPreviewLoading.value = true
    try {
      const bytes = utf8Bytes(text)
      if (bytes > 65_536 || text.length > 65_536) throw new Error('capacity')
      const hash = await hashText(text)
      if (!valid(token, id) || revision !== revisionOwner || text !== revisionText.value || epoch !== snapshot.value?.checkpoint.sourceEpoch
        || expectedRawHead !== snapshot.value?.rawHead || ordinal !== chapterOrdinal.value) return false
      revisionPreview.value = { text, hash, bytes, utf16: text.length, sourceEpoch: epoch, expectedRawHead, chapterOrdinal: ordinal,
        invalidatedChapters: chapterRows.value.filter(row => row.ordinal > ordinal).map(row => row.ordinal) }
      return true
    } catch { if (valid(token, id) && revision === revisionOwner) error.value = 'body_revision_capacity'; return false }
    finally { if (valid(token, id) && revision === revisionOwner) revisionPreviewLoading.value = false }
  }
  async function mutate(operation: (id: string, command: string) => Promise<ProducerCampaignSnapshot>) {
    if (disposed || busy.value || loading.value || !campaignId.value) return false
    const token = ++owner, id = campaignId.value, command = nextOperation()
    readOwner++; clearPrepared(true); clearRevisionPreview(); busy.value = true; error.value = ''; notice.value = ''
    const stopVerification = observeVerification(token, id)
    try { return await publish(await operation(id, command), token, id) }
    catch (cause) { if (valid(token, id)) error.value = safeError(cause); return false }
    finally { stopVerification(); if (valid(token, id)) busy.value = false }
  }
  const adopt = () => canAdopt.value ? mutate((id, command) => engine.adopt(id, command)) : Promise.resolve(false)
  async function commitRevision() {
    const preview = revisionPreview.value
    if (!canRevise.value || !preview || preview.text !== revisionText.value || preview.sourceEpoch !== snapshot.value?.checkpoint.sourceEpoch
      || preview.expectedRawHead !== snapshot.value?.rawHead || preview.chapterOrdinal !== chapterOrdinal.value) return false
    return mutate((id, command) => engine.reviseBody(id, preview.chapterOrdinal, preview.text, preview.expectedRawHead, command))
  }
  async function prepare() {
    if (disposed || !canPrepare.value) return false
    clearPrepared(true)
    const token = owner, id = campaignId.value, input = inputOwner
    const selection = { chapterOrdinal: chapterOrdinal.value, startUtf16: startUtf16.value, endUtf16: endUtf16.value,
      planningRefs: selectedPlanningKeys.value.map(key => planningChoices.value.find(row => row.key === key)!.identity) }
    loading.value = true; error.value = ''; notice.value = ''
    const stopVerification = observeVerification(token, id, () => input === inputOwner)
    try {
      const value = await engine.prepare(id, selection, producerId.value)
      if (!valid(token, id) || input !== inputOwner) return false
      prepared.value = value; return true
    } catch (cause) { if (valid(token, id) && input === inputOwner) error.value = safeError(cause); return false }
    finally { stopVerification(); if (valid(token, id) && input === inputOwner) loading.value = false }
  }
  function showReview(value: ProducerCampaignSnapshot, requestId: string) {
    const index = value.checkpoint.producerRequests.find(row => row.id === requestId)
    const request = index && value.requests.get(index.requestHash), phase = index && value.phases.get(index.phaseHash)
    const hash = phase?.resolution?.reviewHash
    if (request && hash && request.sourceEpoch === value.checkpoint.sourceEpoch && request.aggregateManifestHash === value.manifest.hash) {
      currentReview.value = value.reviews.get(hash) ?? null
    } else currentReview.value = null
    if (phase?.resolution) notice.value = phase.resolution.outcome === 'review_ready' ? 'review_ready' : 'response_refused'
    else if (phase?.status === 'outcome_unknown' || phase?.status === 'dispatch_intent') notice.value = 'outcome_unknown'
  }
  function invoke(): Promise<boolean> {
    if (invokePromise) return invokePromise
    const handle = prepared.value
    if (disposed || !canInvoke.value || !handle) return Promise.resolve(false)
    const token = ++owner, id = campaignId.value, command = nextOperation()
    readOwner++; busy.value = true; loading.value = false; error.value = ''; notice.value = ''; currentReview.value = null
    const stopVerification = observeVerification(token, id)
    const operation = (async () => {
      try {
        const value = await engine.invoke(handle, command)
        if (!await publish(value, token, id)) return false
        const matching = [...value.requests.values()].find(row => row.operationId === command)
        if (matching) showReview(value, matching.id)
        return true
      } catch (cause) { if (valid(token, id)) error.value = safeError(cause); return false }
      finally { stopVerification(); if (valid(token, id)) { busy.value = false; prepared.value = null } }
    })()
    invokePromise = operation
    void operation.finally(() => { if (invokePromise === operation) invokePromise = null })
    return operation
  }
  async function recover(requestId: string) {
    if (disposed || busy.value || loading.value || !requestRows.value.some(row => row.id === requestId && row.canRecover)) return false
    const success = await mutate((id, command) => engine.recover(id, requestId, command))
    if (success && snapshot.value) showReview(snapshot.value, requestId)
    return success
  }
  function cancelLocal() {
    if (disposed) return
    clearVerification()
    engine.cancelLocal(campaignId.value || undefined)
    owner++; readOwner++; clearPrepared(); clearRevisionPreview(); busy.value = false; loading.value = false; invokePromise = null
    notice.value = 'local_cancelled_outcome_unconfirmed'
  }
  const cancelCampaign = () => snapshot.value?.checkpoint.status === 'active'
    ? mutate((id, command) => { engine.cancelLocal(id); return engine.cancel(id, command) }) : Promise.resolve(false)
  function dispose() {
    if (disposed) return
    disposed = true; owner++; readOwner++; clearVerification(); clearSourceViews(); engine.cancelLocal(campaignId.value || undefined); invokePromise = null
  }
  return { campaignId, snapshot, loading, busy, error, notice, producers, producerId, canAdopt, adopt, chapterRows, selectedChapter, selectedText,
    chapterOrdinal, startUtf16, endUtf16, selectedWindow, windowValid, planningChoices, selectedPlanningKeys, prepared, currentReview,
    revisionText, revisionPreview, revisionPreviewLoading, canRevise, canPrepare, canInvoke, requestRows, unknownCount, verification,
    select, refresh, setChapter, setWindow, setProducer, setPlanning, setRevisionText, previewRevision, commitRevision,
    prepare, invoke, recover, cancelLocal, cancelCampaign, dispose }
}
