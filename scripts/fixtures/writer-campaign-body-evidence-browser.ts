/** Built production-service driver over actual native IndexedDB. No source text leaves this module. */
import { getCampaignBuildIdentity } from '../../src/services/writerCampaign/buildIdentity'
import { idbCompareAndSwapMany, idbGetMany } from '../../src/services/blobStore'
import { createCampaignRepository } from '../../src/services/writerCampaign/store'
import { createOfflineCampaignEngine, type CampaignRuntimeIdentity } from '../../src/services/writerCampaign/engine'
import { buildBodyEvidenceFixtureProposal } from '../../src/services/writerCampaign/bodyEvidenceFixture'
import { buildPlanningCanon, planningArtifactRef } from '../../src/services/writerCampaign/planningCanon'
import { canonicalStringify, hashCampaignValue, utf8Bytes } from '../../src/services/writerCampaign/protocol'
import type { CampaignArtifact, CampaignRepositoryIO, CampaignSnapshot } from '../../src/types/writerCampaign'
import type { BodyEvidencePreviewResult } from '../../src/services/writerCampaign/bodyEvidenceProtocol'
import { runBodyEvidenceProfile, inspectBodyEvidenceAfterRestart } from './writer-campaign-body-evidence-profile'
import { emptyBodyNativeBoundary, safeBodyEvidenceCode, type BodyEvidenceAuthority, type BodyEvidenceProfile, type BodyNativeBoundary, type BODY_NATIVE_BOUNDARY_CHECKS } from './writer-campaign-body-evidence-report'
import type { StorageObservation } from './writer-campaign-capacity-profile'

type DriverGlobal = typeof globalThis & {
  __campaignStorageMeter: { snapshot(): StorageObservation }
  __planningAuthority: { snapshot(): BodyEvidenceAuthority }
  __bodyEvidenceNamespace: { digest(): Promise<string> }
  __bodyEvidenceProgress(row: BodyEvidenceProfile): Promise<void>
}
const host = () => globalThis as DriverGlobal
const meter = () => host().__campaignStorageMeter.snapshot()
const authority = () => host().__planningAuthority.snapshot()
const namespaceDigest = () => host().__bodyEvidenceNamespace.digest()
export interface BodyEvidenceReplacementPorts {
  identity: CampaignRuntimeIdentity
  io: CampaignRepositoryIO
  observe(): StorageObservation
  authority(): BodyEvidenceAuthority
  namespaceDigest(): Promise<string>
}
const nativeReplacementPorts = (): BodyEvidenceReplacementPorts => ({ identity: getCampaignBuildIdentity(), io: { getMany: idbGetMany, compareAndSwapMany: idbCompareAndSwapMany }, observe: meter, authority, namespaceDigest })

export async function runNativeBodyEvidenceProfile(language: 'zh' | 'en') {
  return runBodyEvidenceProfile(language, getCampaignBuildIdentity(), meter, authority, undefined,
    row => host().__bodyEvidenceProgress(row), namespaceDigest)
}

export async function inspectBodyEvidenceAfterProcessRestart(expected: BodyEvidenceProfile) {
  return inspectBodyEvidenceAfterRestart(expected, meter, authority, namespaceDigest)
}

const verify = (condition: unknown): void => { if (!condition) throw new Error('body_evidence_native_boundary_verification') }
const ms = (duration: number) => Math.max(0, Math.ceil(duration))
const boundaryId = (language: 'zh' | 'en') => `body-evidence-replacement-${language}`
const activeArtifacts = (snapshot: CampaignSnapshot): CampaignArtifact[] => snapshot.checkpoint.tasks.map(row => {
  const artifact = row.artifact && snapshot.artifacts.get(row.artifact.hash)
  verify(row.status === 'committed' && artifact)
  return artifact as CampaignArtifact
})
/** Independently reconstruct the exact-source root from active repository artifacts. */
async function boundaryRoot(snapshot: CampaignSnapshot) {
  const artifacts = activeArtifacts(snapshot), canon = await buildPlanningCanon(snapshot.manifest, artifacts.filter(row => row.kind !== 'chapter_body'))
  const bodies = artifacts.filter(row => row.kind === 'chapter_body')
  verify(bodies.length === 3 && canon.canonBaseRoot && canon.fullPlanRoot)
  const bodySources = bodies.map((artifact, index) => ({ chapterOrdinal: index + 1, artifact: planningArtifactRef(artifact), taskRevision: artifact.taskRevision,
    artifactCandidateId: artifact.candidateId, rawBodyHash: artifact.raw.hash, rawUtf16Units: artifact.text.length, rawUtf8Bytes: utf8Bytes(artifact.text), rawScalars: [...artifact.text].length }))
  return { fullPlanRoot: canon.fullPlanRoot, bodyPrefixRoot: await hashCampaignValue('campaign-body-prefix-v1', { protocol: 'campaign-body-prefix-v1', manifestHash: snapshot.manifest.hash,
    campaignId: snapshot.manifest.campaignId, currentCandidateId: snapshot.checkpoint.candidateId, canonBaseRoot: canon.canonBaseRoot, fullPlanRoot: canon.fullPlanRoot, throughChapterOrdinal: 3, bodySources }) }
}
function ready(value: BodyEvidencePreviewResult) {
  verify(value.status === 'ready')
  if (value.status !== 'ready') throw { code: value.refusalCode }
  return value
}
function historicalAncestors(snapshot: CampaignSnapshot, original?: CampaignSnapshot) {
  const artifacts = activeArtifacts(snapshot), retained = artifacts.filter(row => row.kind !== 'chapter_body' && row.taskId !== 'o-1')
  verify(retained.length === 5 && retained.every(row => row.candidateId !== snapshot.checkpoint.candidateId))
  if (original) {
    verify(retained.every(row => {
      const before = original.checkpoint.tasks.find(task => task.taskId === row.taskId)
      return before?.status === 'committed' && canonicalStringify(before.artifact) === canonicalStringify(planningArtifactRef(row))
        && original.artifacts.get(row.hash)?.candidateId === row.candidateId
    }))
  }
  // The new body is allowed to depend on exact still-active artifacts of older candidates.
  for (const body of artifacts.filter(row => row.kind === 'chapter_body')) {
    verify(body.candidateId === snapshot.checkpoint.candidateId)
    for (const ancestor of retained) verify(body.dependencies.some(ref => canonicalStringify(ref) === canonicalStringify(planningArtifactRef(ancestor))))
  }
  return retained.length
}

/** Separate rich-three-chapter native context, never the N60 measured namespace.
 * The only interposition waits AFTER a genuine verified read for an explicit
 * second-engine mutation. No source, response, snapshot or refusal is fabricated. */
export async function runNativeBodyEvidenceReplacement(language: 'zh' | 'en'): Promise<BodyNativeBoundary> {
  return runBodyEvidenceReplacementControl(language, nativeReplacementPorts())
}
/** Also callable by a bounded injected-IO Node control. Its returned control row
 * is not native evidence unless the real native wrapper supplied the ports. */
export async function runBodyEvidenceReplacementControl(language: 'zh' | 'en', ports: BodyEvidenceReplacementPorts): Promise<BodyNativeBoundary> {
  const { identity, io, observe: meter, authority, namespaceDigest } = ports
  const result = emptyBodyNativeBoundary(language), id = boundaryId(language)
  let actualDispatches = 0, previewCommits = 0, previewDispatches = 0, expectedErrors = 0, explicitWrites = 0, explicitBytes = 0
  let afterVerifiedRead: (() => Promise<void>) | null = null
  const actionEngine = createOfflineCampaignEngine({ identity, repository: createCampaignRepository(io), fixture: { onDispatch() { actualDispatches++ } } })
  const previewRepository = createCampaignRepository({ getMany: keys => io.getMany(keys), async compareAndSwapMany(entries, canCommit) { previewCommits++; return io.compareAndSwapMany(entries, canCommit) } })
  const read = previewRepository.read.bind(previewRepository), commit = previewRepository.commit.bind(previewRepository), create = previewRepository.create.bind(previewRepository)
  previewRepository.read = async (...args) => { const snapshot = await read(...args); const action = afterVerifiedRead; afterVerifiedRead = null; if (action) await action(); return snapshot }
  previewRepository.commit = async (...args) => { previewCommits++; return commit(...args) }
  previewRepository.create = async (...args) => { previewCommits++; return create(...args) }
  const previewEngine = createOfflineCampaignEngine({ identity, repository: previewRepository, fixture: { onDispatch() { previewDispatches++ } } })
  const operationCounts = () => {
    const observations = [actionEngine.readOperationTimings(), previewEngine.readOperationTimings()]
    verify(observations.every(row => row.status === 'collected'))
    const rows = observations.flatMap(row => row.phases)
    return { timeouts: rows.reduce((sum, row) => sum + row.timeout, 0), aborts: rows.reduce((sum, row) => sum + row.abort, 0), errors: rows.reduce((sum, row) => sum + row.error, 0) }
  }
  const action = async <T>(execute: () => Promise<T>) => {
    const before = meter(), start = performance.now()
    try { return await execute() } finally {
      result.maxActionMs = Math.max(result.maxActionMs, ms(performance.now() - start))
      explicitWrites += meter().committedTransactions - before.committedTransactions
      explicitBytes += meter().cumulativeWrittenBytes - before.cumulativeWrittenBytes
    }
  }
  const preview = async (proposal: string, expected?: 'source_changed' | 'no_accepted_body' | 'source_identity_mismatch') => {
    const before = operationCounts(), start = performance.now()
    const value = await previewEngine.previewBodyEvidence(id, proposal)
    result.previewInvocations++; result.maxPreviewMs = Math.max(result.maxPreviewMs, ms(performance.now() - start))
    if (expected) {
      verify(value.status === 'refused' && value.refusalCode === expected)
      // Exclude only actual operation-error deltas associated with this exact expected typed refusal.
      expectedErrors += operationCounts().errors - before.errors
    }
    return value
  }
  let current: CampaignSnapshot | null = null, activeCheck: typeof BODY_NATIVE_BOUNDARY_CHECKS[number] = 'old_ready'
  const mark = () => { result.checks.find(row => row.id === activeCheck)!.status = 'pass' }
  const update = () => {
    const operations = operationCounts(); result.operationTimeouts = operations.timeouts; result.operationAborts = operations.aborts; result.unexpectedOperationErrors = operations.errors - expectedErrors
    result.previewCommitAttempts = previewCommits; result.previewFixtureInvocations = previewDispatches; result.finalCommittedTransactions = meter().committedTransactions; result.authority = authority()
    if (current) { result.finalOperations = current.checkpoint.budget.operations; result.finalAttempts = current.checkpoint.budget.attempts; result.checkpointHash = current.checkpoint.hash }
  }
  try {
    result.status = 'running'
    current = await action(() => actionEngine.prepareBodyEvidence({ campaignId: id, language }))
    for (let index = 0; index < 9; index++) current = await action(() => actionEngine.step(id, `boundary-setup-${index}`))
    const original = current, initialTransactions = meter().committedTransactions
    result.setupFixtureInvocations = actualDispatches
    verify(original.head.status === 'completed' && activeArtifacts(original).length === 9 && initialTransactions === 38 && actualDispatches === 9)
    const oldProposal = await buildBodyEvidenceFixtureProposal(original, 3), oldRoot = await boundaryRoot(original)
    const oldReady = ready(await preview(oldProposal))
    verify(oldReady.bodyPrefixRoot === oldRoot.bodyPrefixRoot && oldReady.fullPlanRoot === oldRoot.fullPlanRoot)
    result.oldBodyPrefixRoot = oldReady.bodyPrefixRoot; result.oldFullPlanRoot = oldReady.fullPlanRoot; mark()

    activeCheck = 'concurrent_replacement_refusal'
    const oldOutline = activeArtifacts(original).find(row => row.taskId === 'o-1')!
    let replacements = 0
    afterVerifiedRead = async () => { current = await action(() => actionEngine.replaceCandidate(id, oldOutline.taskId, oldOutline.text, 'boundary-replace')); replacements++ }
    await preview(oldProposal, 'source_changed'); result.sourceChangeRefusal = 'source_changed'
    verify(replacements === 1 && current.head.status === 'paused' && current.checkpoint.candidateId !== original.checkpoint.candidateId)
    verify(current.checkpoint.tasks.filter(row => row.status === 'invalidated').length === 3)
    const replacedRef = current.checkpoint.tasks.find(row => row.taskId === 'o-1')!.artifact!, replaced = current.artifacts.get(replacedRef.hash)!
    verify(replaced.text === oldOutline.text && replaced.parentHash === oldOutline.hash && replaced.revision === oldOutline.revision + 1 && replaced.taskRevision === oldOutline.taskRevision + 1); mark()

    activeCheck = 'invalidated_prefix_refusal'
    await preview(oldProposal, 'no_accepted_body'); result.invalidatedPrefixRefusal = 'no_accepted_body'; mark()
    activeCheck = 'rebuild_new_root'
    current = await action(() => actionEngine.resume(id, 'boundary-resume'))
    for (let index = 0; index < 3; index++) current = await action(() => actionEngine.step(id, `boundary-rebuild-${index}`))
    result.rebuildFixtureInvocations = actualDispatches - result.setupFixtureInvocations
    result.explicitCommittedTransactions = meter().committedTransactions - initialTransactions
    result.rebuiltBodyTasks = activeArtifacts(current).filter(row => row.kind === 'chapter_body' && row.candidateId === current!.checkpoint.candidateId
      && row.taskRevision === original.checkpoint.tasks.find(task => task.taskId === row.taskId)!.revision + 1).length
    verify(current.head.status === 'completed' && result.rebuildFixtureInvocations === 3 && result.explicitCommittedTransactions === 14 && result.rebuiltBodyTasks === 3)
    const newProposal = await buildBodyEvidenceFixtureProposal(current, 3), newRoot = await boundaryRoot(current)
    verify(newRoot.bodyPrefixRoot !== oldRoot.bodyPrefixRoot && newRoot.fullPlanRoot !== oldRoot.fullPlanRoot)
    activeCheck = 'stale_proposal_refusal'
    await preview(oldProposal, 'source_identity_mismatch'); result.staleProposalRefusal = 'source_identity_mismatch'; mark()
    activeCheck = 'rebuild_new_root'
    const newReady = ready(await preview(newProposal))
    verify(newReady.bodyPrefixRoot === newRoot.bodyPrefixRoot && newReady.fullPlanRoot === newRoot.fullPlanRoot)
    result.newBodyPrefixRoot = newReady.bodyPrefixRoot; result.newFullPlanRoot = newReady.fullPlanRoot; mark()
    activeCheck = 'historical_ancestors'; result.historicalPlanningAncestorCount = historicalAncestors(current, original); result.historicalPlanningAncestorsVerified = true; mark()
    activeCheck = 'preview_no_authority'; update()
    verify(result.finalOperations === 52 && result.finalCommittedTransactions === 52 && result.finalAttempts === 12 && result.previewInvocations === 5)
    verify(previewCommits === 0 && previewDispatches === 0 && meter().committedTransactions === explicitWrites && meter().cumulativeWrittenBytes === explicitBytes && meter().accountingMismatches === 0)
    verify(result.operationTimeouts === 0 && result.operationAborts === 0 && result.unexpectedOperationErrors === 0 && result.maxActionMs < 10_000 && result.maxPreviewMs < 10_000)
    verify(result.authority.observed && Object.entries(result.authority).every(([key, value]) => key === 'observed' || value === 0))
    result.namespaceHashAfter = await namespaceDigest(); mark(); result.status = 'pass'
  } catch (error) { result.status = 'failed'; result.refusalCode = safeBodyEvidenceCode(error); result.checks.find(row => row.id === activeCheck)!.status = 'fail'; update() }
  finally { afterVerifiedRead = null; previewEngine.dispose(); actionEngine.dispose() }
  return result
}

/** New browser process: no old proposal or snapshot is transferred or persisted. */
export async function inspectBodyEvidenceReplacementAfterProcessRestart(expected: BodyNativeBoundary) {
  return inspectBodyEvidenceReplacementControl(expected, nativeReplacementPorts())
}
/** Injected-IO use is cold-repository control only, never a browser process restart. */
export async function inspectBodyEvidenceReplacementControl(expected: BodyNativeBoundary, ports: BodyEvidenceReplacementPorts) {
  const { identity, io, observe: meter, authority, namespaceDigest } = ports
  const started = performance.now(), before = meter(), id = boundaryId(expected.language)
  let commits = 0, dispatches = 0
  const repository = createCampaignRepository({ getMany: keys => io.getMany(keys), async compareAndSwapMany(entries, canCommit) { commits++; return io.compareAndSwapMany(entries, canCommit) } })
  const engine = createOfflineCampaignEngine({ identity, repository, fixture: { onDispatch() { dispatches++ } } })
  try {
    const snapshot = await engine.inspect(id) as CampaignSnapshot | null, initialMs = performance.now() - started
    verify(snapshot && initialMs < 3000 && snapshot.head.status === 'completed' && snapshot.head.checkpointHash === expected.checkpointHash)
    if (!snapshot) throw new Error('body_evidence_native_boundary_reopen')
    verify(snapshot.checkpoint.budget.operations === expected.finalOperations && snapshot.checkpoint.budget.attempts === expected.finalAttempts && await namespaceDigest() === expected.namespaceHashAfter)
    verify(historicalAncestors(snapshot) === expected.historicalPlanningAncestorCount)
    const roots = await boundaryRoot(snapshot), fresh = ready(await engine.previewBodyEvidence(id, await buildBodyEvidenceFixtureProposal(snapshot, 3)))
    verify(roots.bodyPrefixRoot === expected.newBodyPrefixRoot && roots.fullPlanRoot === expected.newFullPlanRoot && fresh.bodyPrefixRoot === roots.bodyPrefixRoot && fresh.fullPlanRoot === roots.fullPlanRoot)
    verify(await namespaceDigest() === expected.namespaceHashAfter && commits === 0 && dispatches === 0 && meter().committedTransactions === before.committedTransactions && meter().cumulativeWrittenBytes === before.cumulativeWrittenBytes)
    const operations = engine.readOperationTimings(); verify(operations.status === 'collected' && operations.phases.every(row => row.timeout === 0 && row.abort === 0 && row.error === 0))
    verify(authority().observed && Object.entries(authority()).every(([key, value]) => key === 'observed' || value === 0))
    return { coldProcessRestart: 'verified' as const, coldProcessInitialReadMs: ms(initialMs), coldProcessReadMs: ms(performance.now() - started), coldProcessReadBytes: meter().totalReadBytes - before.totalReadBytes, coldProcessReadCalls: meter().totalReadCalls - before.totalReadCalls }
  } finally { engine.dispose() }
}
