import { computed, inject, ref, shallowRef, watch, type Ref } from 'vue'
import { createCreativePilotEngine } from '@/services/writerCampaign/creativePilotEngine'
import { assertScalarText, canonicalStringify, decodeStorageBytes, hashText, utf8Bytes } from '@/services/writerCampaign/protocol'
import { creativePilotHostKey, creativePilotRepositoryKey, creativePilotProgressObserverKey } from './creativePilotHost'
import { createOfflineCampaignEngine } from '@/services/writerCampaign/engine'
import { idbGetMany } from '@/services/blobStore'
import { campaignKeys } from '@/services/writerCampaign/store'
import type { CampaignLabEngine } from './useWriterCampaign'
import type {
  CreativeBriefV1, CreativeDryPreview, CreativeErrorCode, CreativeHeadCommand, CreativeLanguage,
  CreativePilotEngine, CreativeProgressEvent, CreativeSnapshot, CreativeTaskId,
} from '@/types/creativePilot'

const SAFE_ERRORS = new Set<CreativeErrorCode>([
  'unsupported_schema', 'integrity', 'conflict', 'operation_conflict', 'budget', 'storage_unknown',
  'cancelled', 'deadline_exceeded', 'operation_timeout', 'unconfigured', 'configuration_changed',
  'authority_revoked', 'expired', 'clock_rollback', 'context_capacity', 'source_changed', 'input_invalid',
  'transport_wire_invalid', 'retention_capacity', 'unknown_outcome', 'attempt_spent',
  'replacement_after_reservation', 'already_terminal', 'metadata_capacity',
])
function safeError(error: unknown): CreativeErrorCode {
  const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : null
  return typeof code === 'string' && SAFE_ERRORS.has(code as CreativeErrorCode) ? code as CreativeErrorCode : 'integrity'
}
const operationId = () => `creative-ui-${crypto.randomUUID()}`

/** Presentation ownership only. All commands are freshly validated by the engine. */
export function useCreativePilotLab(options: {
  campaignId: Readonly<Ref<string>>
  selectedV4: Readonly<Ref<boolean>>
  externalBusy?: Readonly<Ref<boolean>>
  onCreated?(id: string): void
  onVersion?(version: 4 | null): void
  engine?: CreativePilotEngine
  newId?: () => string
}) {
  const host = inject(creativePilotHostKey, null)
  const repository = inject(creativePilotRepositoryKey, null)
  const observeProgress = inject(creativePilotProgressObserverKey, null)
  const engine = options.engine ?? createCreativePilotEngine({ ...(host ? { host } : {}), ...(repository ? { repository } : {}) })
  const snapshot = shallowRef<CreativeSnapshot | null>(null)
  const preview = shallowRef<CreativeDryPreview | null>(null)
  const progress = shallowRef<Readonly<CreativeProgressEvent> | null>(null)
  const taskProgress = shallowRef<Partial<Record<CreativeTaskId, string>>>({})
  const language = ref<CreativeLanguage>('zh')
  const premise = ref('')
  const constraints = ref('[]')
  const draftMode = ref(true)
  const busy = ref(false), loading = ref(false)
  const error = ref<CreativeErrorCode | ''>('')
  const notice = ref<'none' | 'prepared' | 'replaced' | 'stopped' | 'unconfirmed' | 'inspected' | 'resolved' | 'cancelled'>('none')
  const consent = ref(false)
  const now = ref(Date.now())
  const replacementPreview = shallowRef<{ brief: CreativeBriefV1; digest: string; bytes: number; utf16: number; rawHead: string; candidateHash: string; draftRevision: number } | null>(null)
  let owner = 0, editorRevision = 0, disposed = false, candidateDraft = false
  let activeOwner: number | null = null
  let progressOwner: number | null = null
  const seenProgressOwners = new Set<number>()
  let activeCampaign = ''

  const current = (token: number, id: string) => !disposed && token === owner && id === options.campaignId.value
  const idle = computed(() => !busy.value && !loading.value && !options.externalBusy?.value)
  const selectedSnapshot = computed(() => Boolean(snapshot.value && options.selectedV4.value
    && snapshot.value.manifest.campaignId === options.campaignId.value && !['unconfirmed', 'stopped'].includes(notice.value)))
  const expired = computed(() => Boolean(snapshot.value && now.value >= snapshot.value.manifest.expiresAt))
  const attempts = computed(() => busy.value && progress.value ? progress.value.attemptsReserved : snapshot.value?.checkpoint.budget.attempts ?? 0)
  const acceptedTasks = computed(() => busy.value && progress.value ? progress.value.acceptedTasks : snapshot.value?.checkpoint.tasks.filter(t => t.status === 'accepted').length ?? 0)
  const acceptedBodies = computed(() => busy.value && progress.value ? progress.value.acceptedBodies : snapshot.value?.checkpoint.tasks.filter(t => t.taskId.startsWith('b-') && t.status === 'accepted').length ?? 0)
  const bodyCharacters = computed(() => busy.value && progress.value ? progress.value.bodyCanonicalScalars : snapshot.value?.checkpoint.bodyCharacters ?? 0)
  const requestRows = computed(() => (snapshot.value?.checkpoint.requests ?? []).map(row => {
    const phase = snapshot.value!.phases.get(row.phaseHash)
    const request = snapshot.value!.requests.get(row.requestHash)
    const response = phase?.responseHash ? snapshot.value!.responses.get(phase.responseHash) ?? null : null
    return { ...row, phase, request, response }
  }))
  const unknownCount = computed(() => requestRows.value.filter(row => row.phase && ['dispatch_intent', 'outcome_unknown'].includes(row.phase.status)).length)
  const retainedRow = computed(() => requestRows.value.find(row => row.phase?.status === 'response_retained') ?? null)
  const reservedRow = computed(() => requestRows.value.find(row => row.phase?.status === 'reserved') ?? null)
  const taskRows = computed(() => snapshot.value?.manifest.tasks.map(spec => {
    const state = snapshot.value!.checkpoint.tasks.find(row => row.taskId === spec.id)!
    return { ...state, kind: spec.kind, chapterOrdinal: spec.chapterOrdinal,
      observedStatus: busy.value ? taskProgress.value[spec.id] ?? state.status : state.status }
  }) ?? [])
  const artifactRows = computed(() => taskRows.value.flatMap(task => {
    const artifact = task.artifactHash ? snapshot.value!.artifacts.get(task.artifactHash) : null
    return artifact ? [artifact] : []
  }))
  const latestRequest = computed(() => requestRows.value.at(-1)?.request ?? null)
  const displayedInput = computed(() => preview.value?.prepared ?? latestRequest.value?.prepared ?? null)
  const storage = computed(() => {
    const value = snapshot.value
    if (!value) return null
    return { written: decodeStorageBytes(value.checkpoint.storage.writtenBytes), outstanding: decodeStorageBytes(value.checkpoint.storage.outstandingBytes),
      recovery: decodeStorageBytes(value.checkpoint.storage.recoveryRemainingBytes), released: decodeStorageBytes(value.checkpoint.storage.releasedBytes),
      limit: decodeStorageBytes(value.manifest.storage.limitBytes) }
  })
  const observedUsage = computed(() => {
    let input = 0, output = 0, reasoning = 0, inputKnown = 0, outputKnown = 0, reasoningKnown = 0, incomplete = 0
    for (const row of requestRows.value) {
      const usage = row.response?.usage
      if (!usage || usage.status !== 'complete') incomplete++
      if (usage?.inputTokens != null) { input += usage.inputTokens; inputKnown++ }
      if (usage?.outputTokens != null) { output += usage.outputTokens; outputKnown++ }
      if (usage?.reasoningTokens != null) { reasoning += usage.reasoningTokens; reasoningKnown++ }
    }
    return { input: inputKnown ? input : null, output: outputKnown ? output : null, reasoning: reasoningKnown ? reasoning : null, incomplete }
  })
  const canReplace = computed(() => Boolean(snapshot.value && selectedSnapshot.value && idle.value && !draftMode.value && !expired.value
    && snapshot.value.checkpoint.budget.attempts === 0 && !snapshot.value.checkpoint.metadata.replacementUsed
    && snapshot.value.checkpoint.status === 'prepared'))
  const canEdit = computed(() => idle.value && (draftMode.value || canReplace.value))
  const candidateDraftMatches = computed(() => {
    if (!snapshot.value || draftMode.value) return false
    try { return canonicalStringify(brief()) === canonicalStringify(snapshot.value.candidate.brief) } catch { return false }
  })
  const validPreview = computed(() => Boolean(preview.value && snapshot.value && preview.value.rawHead === snapshot.value.rawHead
    && preview.value.candidateHash === snapshot.value.candidate.hash && candidateDraftMatches.value))
  const canDryPrepare = computed(() => Boolean(snapshot.value && selectedSnapshot.value && idle.value && !draftMode.value && !expired.value && !unknownCount.value && !retainedRow.value
    && candidateDraftMatches.value && ['prepared', 'running'].includes(snapshot.value.checkpoint.status)))
  const canRun = computed(() => Boolean(idle.value && selectedSnapshot.value && validPreview.value && consent.value && preview.value?.readiness === 'offline_control_ready'
    && !expired.value && !unknownCount.value && !retainedRow.value && snapshot.value && ['prepared', 'running'].includes(snapshot.value.checkpoint.status)))
  const canStart = computed(() => canRun.value && snapshot.value!.checkpoint.budget.attempts === 0)
  const canResume = computed(() => canRun.value && snapshot.value!.checkpoint.budget.attempts > 0)
  const canResolve = computed(() => Boolean(idle.value && selectedSnapshot.value && retainedRow.value && !draftMode.value))
  const canClose = computed(() => Boolean(idle.value && selectedSnapshot.value && (retainedRow.value || reservedRow.value) && !draftMode.value))
  const canCancel = computed(() => Boolean(snapshot.value && selectedSnapshot.value && idle.value && !draftMode.value && !['cancelled', 'completed'].includes(snapshot.value.checkpoint.status)))
  const status = computed(() => expired.value ? 'expired' : notice.value === 'stopped' || notice.value === 'unconfirmed'
    ? notice.value : snapshot.value?.checkpoint.status ?? 'draft')

  function invalidate(clearProgress = false) {
    preview.value = null; consent.value = false; replacementPreview.value = null
    if (clearProgress) { progress.value = null; taskProgress.value = {}; progressOwner = null; seenProgressOwners.clear() }
  }
  function stop() {
    if (disposed) return
    owner++; activeOwner = null; engine.stop(activeCampaign || options.campaignId.value || undefined)
    busy.value = false; loading.value = false; activeCampaign = ''; invalidate()
    notice.value = 'stopped'; error.value = ''
  }
  function edit(field: 'language' | 'premise' | 'constraints', value: string) {
    if (disposed || (!draftMode.value && !canReplace.value && !busy.value && !loading.value)) return false
    if (busy.value || loading.value) stop()
    editorRevision++; invalidate(); notice.value = 'none'; error.value = ''
    if (field === 'language') {
      if (!draftMode.value || !['zh', 'en'].includes(value)) return false
      language.value = value as CreativeLanguage
    } else if (field === 'premise') {
      if (value.length > 4096) { error.value = 'input_invalid'; return false }
      premise.value = value
    } else {
      if (value.length > 8192) { error.value = 'input_invalid'; return false }
      constraints.value = value
    }
    return true
  }
  function brief(): CreativeBriefV1 {
    const rows: unknown = JSON.parse(constraints.value)
    if (!Array.isArray(rows) || rows.length > 8 || !premise.value.trim() || rows.some(row => typeof row !== 'string' || !row.trim())) throw { code: 'input_invalid' }
    const texts = [premise.value, ...rows as string[]]
    texts.forEach(assertScalarText)
    if (texts.reduce((total, text) => total + text.length, 0) > 1024 || texts.reduce((total, text) => total + utf8Bytes(text), 0) > 4096) throw { code: 'input_invalid' }
    return { protocol: 'creative-brief-v1', language: language.value, premise: premise.value, constraints: [...rows as string[]] }
  }
  function fillDraft(value: CreativeBriefV1) {
    language.value = value.language; premise.value = value.premise; constraints.value = JSON.stringify(value.constraints, null, 2)
    candidateDraft = true; editorRevision++; replacementPreview.value = null
  }
  function publish(value: CreativeSnapshot | null) {
    snapshot.value = value; now.value = Date.now()
    if (value) { draftMode.value = false; fillDraft(value.candidate.brief); options.onVersion?.(4) }
    else options.onVersion?.(null)
  }
  function newDraft() {
    stop(); draftMode.value = true; premise.value = ''; constraints.value = '[]'; editorRevision++
    candidateDraft = false; notice.value = 'none'; invalidate(true)
  }
  async function refresh() {
    if (disposed || busy.value || !options.selectedV4.value || !options.campaignId.value) return false
    const id = options.campaignId.value, token = ++owner
    invalidate(true); loading.value = true; error.value = ''
    try {
      const value = await engine.inspect(id)
      if (!current(token, id)) return false
      publish(value); notice.value = 'inspected'
      if (!value) error.value = 'source_changed'
      return Boolean(value)
    } catch (cause) {
      if (current(token, id)) { snapshot.value = null; error.value = safeError(cause); notice.value = 'unconfirmed' }
      return false
    } finally { if (current(token, id)) loading.value = false }
  }
  async function prepare() {
    if (disposed || !idle.value || !draftMode.value) return false
    let value: CreativeBriefV1
    try { value = brief() } catch { error.value = 'input_invalid'; return false }
    const token = ++owner, selected = options.campaignId.value, id = options.newId?.() ?? `creative-${crypto.randomUUID()}`
    invalidate(true); busy.value = true; error.value = ''; activeCampaign = id; activeOwner = token
    try {
      const result = await engine.prepare({ campaignId: id, operationId: operationId(), brief: value })
      if (!current(token, selected)) return false
      publish(result); notice.value = 'prepared'; options.onCreated?.(id)
      return true
    } catch (cause) {
      if (current(token, selected)) { error.value = safeError(cause); notice.value = 'unconfirmed' }
      return false
    } finally {
      if (current(token, selected)) { busy.value = false; activeOwner = null; activeCampaign = '' }
    }
  }
  async function dryPrepare() {
    if (!canDryPrepare.value || disposed) return false
    const id = options.campaignId.value, token = ++owner
    invalidate(); loading.value = true; error.value = ''
    try {
      const result = await engine.dryPrepare(id)
      if (!current(token, id)) return false
      if (!snapshot.value || result.rawHead !== snapshot.value.rawHead || result.candidateHash !== snapshot.value.candidate.hash) {
        error.value = 'source_changed'; return false
      }
      preview.value = result
      return true
    } catch (cause) { if (current(token, id)) error.value = safeError(cause); return false }
    finally { if (current(token, id)) loading.value = false }
  }
  async function previewReplacement() {
    if (!canReplace.value || disposed) return false
    const id = options.campaignId.value, token = owner, revision = editorRevision, value = snapshot.value!
    try {
      const candidate = brief(), encoded = canonicalStringify(candidate), digest = await hashText(encoded)
      if (!current(token, id) || revision !== editorRevision || !canReplace.value) return false
      replacementPreview.value = { brief: candidate, digest, bytes: utf8Bytes(encoded), utf16: encoded.length,
        rawHead: value.rawHead, candidateHash: value.candidate.hash, draftRevision: revision }
      error.value = ''; return true
    } catch { if (current(token, id)) error.value = 'input_invalid'; return false }
  }
  function headCommand(value: CreativeSnapshot): CreativeHeadCommand {
    return { campaignId: value.manifest.campaignId, operationId: operationId(), expectedRawHead: value.rawHead, expectedCandidateHash: value.candidate.hash }
  }
  async function action(kind: 'start' | 'resume' | 'replace' | 'resolve' | 'close' | 'cancel') {
    if (disposed || !idle.value || !snapshot.value) return false
    if ((kind === 'start' && !canStart.value) || (kind === 'resume' && !canResume.value)
      || (kind === 'replace' && !canReplace.value) || (kind === 'resolve' && !canResolve.value)
      || (kind === 'close' && !canClose.value) || (kind === 'cancel' && !canCancel.value)) return false
    const replacement = replacementPreview.value, value = snapshot.value
    if (kind === 'replace' && (!replacement || replacement.rawHead !== value.rawHead || replacement.candidateHash !== value.candidate.hash || replacement.draftRevision !== editorRevision)) return false
    const retained = retainedRow.value ?? reservedRow.value
    const id = options.campaignId.value, token = ++owner, command = headCommand(value)
    invalidate(true); busy.value = true; activeOwner = token; activeCampaign = id; error.value = ''; notice.value = 'none'
    try {
      const result = kind === 'start' ? await engine.start(command)
        : kind === 'resume' ? await engine.resume(command)
          : kind === 'replace' ? await engine.replaceBrief({ ...command, brief: replacement!.brief })
            : kind === 'cancel' ? await engine.cancel(command)
              : await engine.resolveRetained({ ...command, requestHash: retained!.requestHash, disposition: kind === 'resolve' ? 'publish_if_valid' : 'accounting_only' })
      if (!current(token, id)) return false
      publish(result); notice.value = kind === 'replace' ? 'replaced' : kind === 'cancel' ? 'cancelled' : kind === 'resolve' || kind === 'close' ? 'resolved' : 'inspected'
      return true
    } catch (cause) {
      if (current(token, id)) { error.value = safeError(cause); notice.value = 'unconfirmed' }
      return false
    } finally {
      if (current(token, id)) { busy.value = false; activeOwner = null; activeCampaign = '' }
    }
  }
  const unsubscribe = engine.subscribeProgress(event => {
    // Metrics receive a detached closed projection, not engine-owned state.
    // An observer cannot veto/replace execution or bypass presentation ownership.
    if (observeProgress && !disposed) try {
      void Promise.resolve(observeProgress(Object.freeze({ ownerId: event.ownerId, campaignId: event.campaignId, kind: event.kind,
        taskId: event.taskId, attemptsReserved: event.attemptsReserved, acceptedTasks: event.acceptedTasks,
        acceptedBodies: event.acceptedBodies, bodyCanonicalScalars: event.bodyCanonicalScalars }))).catch(() => {})
    } catch { /* Read-only observer failure has no execution authority. */ }
    if (disposed || activeOwner !== owner || event.campaignId !== activeCampaign || !busy.value) return
    if (progressOwner !== event.ownerId) {
      // The engine creates a fixed owner per stage. Only its first verifying
      // observation can advance presentation ownership; late prior owners lose.
      if (event.kind !== 'verifying' || seenProgressOwners.has(event.ownerId)) return
      seenProgressOwners.add(event.ownerId); progressOwner = event.ownerId
    }
    progress.value = { ...event }; now.value = Date.now()
    if (event.taskId) taskProgress.value = { ...taskProgress.value, [event.taskId]: event.kind }
  })
  const stopWatch = watch([options.campaignId, options.selectedV4], ([id, isV4]) => {
    owner++; activeOwner = null; engine.stop(activeCampaign || undefined); activeCampaign = ''
    busy.value = false; loading.value = false; snapshot.value = null; error.value = ''; notice.value = 'none'; invalidate(true)
    draftMode.value = !isV4
    // Selection and route-version refs can update in separate synchronous steps.
    // Do not let the first step's snapshot clearing erase draft provenance.
    if (candidateDraft) { premise.value = ''; constraints.value = '[]'; candidateDraft = false; editorRevision++ }
    if (id && isV4) void refresh()
  }, { immediate: true, flush: 'sync' })
  const timer = setInterval(() => { if (!disposed) now.value = Date.now() }, 1000)
  function dispose() {
    if (disposed) return
    owner++; activeOwner = null; stopWatch()
    // Revoke presentation first, then let the read-only observer see the real
    // synchronous stop event before detaching the subscription.
    engine.stop(); disposed = true; unsubscribe(); clearInterval(timer)
    engine.dispose(); invalidate(true); busy.value = false; loading.value = false
  }
  return { snapshot, preview, progress, language, premise, constraints, draftMode, busy, loading, error, notice, consent, replacementPreview,
    idle, expired, attempts, acceptedTasks, acceptedBodies, bodyCharacters, requestRows, unknownCount, retainedRow, reservedRow,
    taskRows, artifactRows, displayedInput, storage, observedUsage, canReplace, canEdit, canDryPrepare, canStart, canResume,
    canResolve, canClose, canCancel, status, edit, newDraft, refresh, prepare, dryPrepare, previewReplacement,
    start: () => action('start'), resume: () => action('resume'), replace: () => action('replace'),
    resolve: () => action('resolve'), closeWithoutPublication: () => action('close'), cancel: () => action('cancel'), stop, dispose }
}


/** A view-level router; legacy repository APIs and authority remain unchanged. */
export function createCreativePilotLegacyRouter(options: { currentId(): string }) {
  const routeVersion = ref<4 | 'legacy' | 'unknown'>('unknown')
  const routingError = ref<'' | 'corrupt_head' | 'unsupported_head_version' | 'head_probe_unconfirmed'>('')
  const legacyEngine = createOfflineCampaignEngine()
  let routingOwner = 0, routeDisposed = false
  /** Routing observation only, never a validated v4 snapshot or execution grant.
   * The v4 panel subsequently performs the full bounded repository inspection. */
  async function probeHead(id: string): Promise<4 | 'legacy'> {
    const key = campaignKeys.head(id)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const values = await Promise.race([
        idbGetMany([key]),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('head_probe_unconfirmed')), 3000) }),
      ])
      const raw = values.get(key)
      if (raw == null) return 'legacy'
      if (raw.length > 4096 || utf8Bytes(raw) > 4096) throw new Error('corrupt_head')
      let value: Record<string, unknown>
      try {
        const parsed: unknown = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
        value = parsed as Record<string, unknown>
      } catch { throw new Error('corrupt_head') }
      if ([1, 2, 3].includes(value.schemaVersion as number)) return 'legacy'
      if (value.schemaVersion !== 4) throw new Error('unsupported_head_version')
      const keys = ['schemaVersion', 'protocolVersion', 'campaignId', 'manifestHash', 'sequence', 'checkpointHash', 'receiptId', 'candidateHash', 'executionEpoch', 'status']
      if (Object.keys(value).length !== keys.length || !keys.every(name => Object.hasOwn(value, name))
        || value.protocolVersion !== 'creative-pilot-head-v4' || value.campaignId !== id
        || !['manifestHash', 'checkpointHash', 'candidateHash'].every(name => typeof value[name] === 'string' && /^[a-f0-9]{64}$/.test(value[name] as string))
        || !Number.isSafeInteger(value.sequence) || Number(value.sequence) < 0 || Number(value.sequence) >= 48
        || !Number.isSafeInteger(value.executionEpoch) || Number(value.executionEpoch) < 0
        || typeof value.receiptId !== 'string' || value.receiptId.length > 128
        || !['prepared', 'running', 'blocked', 'completed', 'cancelled'].includes(value.status as string)
        || canonicalStringify(value) !== raw) throw new Error('corrupt_head')
      return 4
    } finally { if (timer !== undefined) clearTimeout(timer) }
  }
  // Explicit delegation preserves the legacy method receiver/authority. A routed
  // v4 record is not fabricated into a legacy snapshot or adopted by its engine.
  const engine: CampaignLabEngine = {
    list: () => legacyEngine.list(),
    async inspect(id) {
      const token = ++routingOwner
      let version: 4 | 'legacy'
      try {
        version = await probeHead(id)
      } catch (cause) {
        if (!routeDisposed && token === routingOwner && options.currentId() === id) {
          routeVersion.value = 'unknown'
          const code = cause instanceof Error ? cause.message : ''
          const integrity = cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === 'integrity'
          routingError.value = integrity ? 'corrupt_head' : code === 'corrupt_head' || code === 'unsupported_head_version' ? code : 'head_probe_unconfirmed'
        }
        throw cause
      }
      if (routeDisposed || token !== routingOwner || options.currentId() !== id) return null
      routeVersion.value = version; routingError.value = ''
      // v3 remains routed to its existing Producer panel even when the legacy
      // v2 inspector correctly refuses its schema. That is not a probe failure.
      return version === 4 ? null : await legacyEngine.inspect(id)
    },
    prepare: input => legacyEngine.prepare(input),
    preparePlanning: input => legacyEngine.preparePlanning(input),
    prepareBodyEvidence: input => legacyEngine.prepareBodyEvidence(input),
    previewPlanningContext: (id, ordinal) => legacyEngine.previewPlanningContext(id, ordinal),
    previewBodyEvidence: (id, text) => legacyEngine.previewBodyEvidence(id, text),
    cancelPreviews: id => legacyEngine.cancelPreviews(id),
    step: id => legacyEngine.step(id), pause: id => legacyEngine.pause(id), resume: id => legacyEngine.resume(id),
    cancel: id => legacyEngine.cancel(id), recoverSaveOnly: id => legacyEngine.recoverSaveOnly(id), stopLocal: id => legacyEngine.stopLocal(id),
  }
  return { engine, version: routeVersion, error: routingError,
    reset() { routingOwner++; routeVersion.value = 'unknown'; routingError.value = '' },
    dispose() { routeDisposed = true; routingOwner++ },
  }
}
