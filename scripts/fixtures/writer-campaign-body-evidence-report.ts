/** Closed source-free evidence. Validators reject, never project, unknown fields. */
import { PLANNING_COMPACT_BODY, planningFixtureBodyTarget } from '../../src/services/writerCampaign/planningProfile'
export const BODY_SAFE_CODES = ['unsupported_contract', 'unsupported_profile', 'unsupported_purpose', 'invalid_envelope', 'invalid_scalar_text', 'duplicate_identity', 'invalid_reference', 'invalid_anchor', 'quote_mismatch', 'quote_hash_mismatch', 'missing_required_premise', 'support_cycle', 'unsupported_subject', 'unsupported_relation', 'invalid_coverage', 'incomplete_plan', 'no_accepted_body', 'noncontiguous_prefix', 'source_identity_mismatch', 'source_outside_prefix', 'envelope_budget_exceeded', 'proposal_budget_exceeded', 'packet_budget_exceeded', 'runtime_identity_changed', 'expired', 'source_changed', 'cancelled', 'deadline_exceeded', 'preview_unavailable', 'budget', 'budget_exhausted', 'storage_budget_exhausted', 'active_budget_exhausted', 'operation_timeout', 'storage_unknown', 'integrity', 'conflict', 'local_stopped', 'dispatch_outcome_unknown', 'clock_rollback', 'profile_failure'] as const
export type BodySafeCode = typeof BODY_SAFE_CODES[number]
export const BODY_PROFILE_CHECKS = ['committed_source', 'prefix_root', 'literal_anchors', 'coverage_union', 'declared_premises', 'generic_input', 'deterministic_packet', 'no_writes_or_dispatch', 'fresh_reads', 'cold_repository_reopen'] as const
export const BODY_UI_CHECKS = ['initial_no_body', 'nine_task_fixture', 'fixed_preview', 'generic_editor', 'oversized_editor', 'forged_anchor_refusal', 'coverage_not_reviewed', 'prefix_reselection', 'preview_edit_race', 'preview_prefix_race', 'preview_refresh_race', 'planning_body_race', 'draft_edit_race', 'draft_reload_race', 'draft_prefix_race', 'draft_navigation_race', 'reload', 'process_reopen', 'campaign_selection_race', 'navigation_back_forward', 'step_race', 'cancel_race', 'cross_tab_change', 'read_fault'] as const
export const BODY_NATIVE_BOUNDARY_CHECKS = ['old_ready', 'concurrent_replacement_refusal', 'invalidated_prefix_refusal', 'rebuild_new_root', 'stale_proposal_refusal', 'historical_ancestors', 'preview_no_authority', 'cold_process_reopen'] as const
export const BODY_REGRESSION_GATES = ['typecheck', 'lint', 'build', 'existing_smoke', 'existing_browser', 'legacy_million_scalar_geometry'] as const
export type BodyCheckStatus = 'not_run' | 'pass' | 'fail'
export type BodyEnvironment = 'node' | 'native' | 'ui' | 'combined'
export type BodyRuntime = 'node' | 'native'
export type BodyProfileId = 'node-zh' | 'node-en' | 'native-zh' | 'native-en'
export interface BodyEvidenceSource { commit: string | null; tree: string | null; coreSha256: string; harnessSha256: string; fixtureSha256: string; uiSha256: string; buildSha256: string }
export interface BodyEvidenceAuthority { observed: boolean; networkEntries: number; credentialEntries: number; configurationReads: number; ordinaryWriterMutations: number; externalToolEntries: number }
export const emptyBodyEvidenceAuthority = (): BodyEvidenceAuthority => ({ observed: false, networkEntries: 0, credentialEntries: 0, configurationReads: 0, ordinaryWriterMutations: 0, externalToolEntries: 0 })
export interface BodyEvidenceProfile {
  id: BodyProfileId; runtime: BodyRuntime; language: 'zh' | 'en'; status: 'not_run' | 'running' | 'pass' | 'refused' | 'timeout' | 'failed'; refusalCode: BodySafeCode | null
  fixtureVersion: 'planning-contract-v1-compact-60'; plannedChapters: 60; plannedTasks: 123; committedTasks: number; committedBodyScalars: number; actualFixtureInvocations: number; reservedAttempts: number; committedOperations: number
  checkpointHash: string | null; artifactSetHash: string | null; canonBaseRoot: string | null; fullPlanRoot: string | null; bodyPrefixRoot: string | null; packetDigest: string | null; namespaceHashBefore: string | null; namespaceHashAfter: string | null
  cumulativeWrittenBytes: number; outstandingBytes: number; recoveryRemainingBytes: number; openAllocations: number; liveRecordCount: number; liveSerializedMapBytes: number; committedTransactions: number; accountingMismatches: number
  setupMs: number; maxStepMs: number; timeoutEvents: number; maxBodyScalars: number; operationTimingsCollected: boolean; operationTimeouts: number; operationAborts: number; operationErrors: number; maxIoOperationMs: number; maxDispatchOperationMs: number
  previewInvocations: number; previewMs: number; maxPreviewMs: number; previewRepositoryReadCalls: number; previewRepositoryReadMs: number; maxPreviewRepositoryReadMs: number; previewIoReadCalls: number; previewIoReadRecords: number; previewIoReadBytes: number
  compileMeasurement: 'separate_pure_compile_equivalence'; compileMs: number; proposalBytes: number; proposalUtf16: number; packetBytes: number; packetUtf16: number; sourceCount: number; spanCount: number; claimCount: number; sourceUtf16: number; suppliedUtf16: number; declaredExaminedUtf16: number; semanticallyReviewedUtf16: 0
  previewOperationTimeouts: number; previewOperationAborts: number; previewOperationErrors: number; previewCampaignCommitAttempts: number; previewCampaignTransactions: number; previewWrittenBytes: number; previewFixtureInvocations: number
  coldRepositoryRead: 'not_run' | 'verified'; coldRepositoryReadMs: number; coldRepositoryReadBytes: number; coldRepositoryReadCalls: number
  coldProcessRestart: 'not_run' | 'not_applicable' | 'verified' | 'failed'; coldProcessReadMs: number; coldProcessInitialReadMs: number; coldProcessReadBytes: number; coldProcessReadCalls: number
  checks: Array<{ id: typeof BODY_PROFILE_CHECKS[number]; status: BodyCheckStatus }>; authority: BodyEvidenceAuthority
}
export interface BodyNativeBoundary {
  id: 'planning_replacement'; language: 'zh' | 'en'; status: 'not_run' | 'running' | 'pass' | 'failed'; refusalCode: BodySafeCode | null
  checks: Array<{id: typeof BODY_NATIVE_BOUNDARY_CHECKS[number];status:BodyCheckStatus}>
  setupFixtureInvocations:number; rebuildFixtureInvocations:number; explicitCommittedTransactions:number; finalCommittedTransactions:number; finalOperations:number; finalAttempts:number; rebuiltBodyTasks:number; previewInvocations:number; previewCommitAttempts:number; previewFixtureInvocations:number
  oldBodyPrefixRoot:string|null; newBodyPrefixRoot:string|null; oldFullPlanRoot:string|null; newFullPlanRoot:string|null; checkpointHash:string|null; namespaceHashAfter:string|null
  sourceChangeRefusal:BodySafeCode|null; invalidatedPrefixRefusal:BodySafeCode|null; staleProposalRefusal:BodySafeCode|null
  historicalPlanningAncestorsVerified:boolean; historicalPlanningAncestorCount:number; maxActionMs:number; maxPreviewMs:number; operationTimeouts:number; operationAborts:number; unexpectedOperationErrors:number
  coldProcessRestart:'not_run'|'verified'|'failed'; coldProcessInitialReadMs:number; coldProcessReadMs:number; coldProcessReadBytes:number; coldProcessReadCalls:number; authority:BodyEvidenceAuthority
}
export function emptyBodyNativeBoundary(language:'zh'|'en'):BodyNativeBoundary {
  return {id:'planning_replacement',language,status:'not_run',refusalCode:null,checks:BODY_NATIVE_BOUNDARY_CHECKS.map(id=>({id,status:'not_run'})),setupFixtureInvocations:0,rebuildFixtureInvocations:0,explicitCommittedTransactions:0,finalCommittedTransactions:0,finalOperations:0,finalAttempts:0,rebuiltBodyTasks:0,previewInvocations:0,previewCommitAttempts:0,previewFixtureInvocations:0,oldBodyPrefixRoot:null,newBodyPrefixRoot:null,oldFullPlanRoot:null,newFullPlanRoot:null,checkpointHash:null,namespaceHashAfter:null,sourceChangeRefusal:null,invalidatedPrefixRefusal:null,staleProposalRefusal:null,historicalPlanningAncestorsVerified:false,historicalPlanningAncestorCount:0,maxActionMs:0,maxPreviewMs:0,operationTimeouts:0,operationAborts:0,unexpectedOperationErrors:0,coldProcessRestart:'not_run',coldProcessInitialReadMs:0,coldProcessReadMs:0,coldProcessReadBytes:0,coldProcessReadCalls:0,authority:emptyBodyEvidenceAuthority()}
}
export interface BodyUiCase {
  language: 'zh' | 'en'; status: 'not_run' | 'running' | 'pass' | 'failed'; failureStage: null | 'launch' | 'navigation' | 'initial_ready' | 'teardown' | typeof BODY_UI_CHECKS[number]
  checks: Array<{ id: typeof BODY_UI_CHECKS[number]; status: BodyCheckStatus }>
  planningArtifacts: number; bodyArtifacts: number; bodyScalars: number; requestOrigins: number; dispatchIntents: number; attempts: number; readOnlyChecks: number; reloads: number; processReopens: number; heldReadRaces: number; heldDraftRaces: number; previewCampaignWriteEntries: number
  actualFixtureInvocations: null; namespaceHashBefore: string | null; namespaceHashAfter: string | null; authority: BodyEvidenceAuthority
}
export interface BodyEvidenceReport {
  protocol: 'body-evidence-report-v1'; scope: 'body_source_proposal_preview_engineering_only'; externalRegressionPolicy: 'required_separate_exact_ci_not_awarded_by_this_report'; contractVersion: 'campaign-body-evidence-proposals-v1'; packetVersion: 'campaign-body-evidence-packet-v1'; source: BodyEvidenceSource
  buildArtifacts: { node: null; native: string | null; ui: string | null }; environment: BodyEnvironment; previewReadAccounting: 'repository_getMany_exact_batches'; compileMeasurement: 'separate_pure_compile_equivalence'; uiAuthorityScope: 'readonly_campaign_windows_excluding_navigation_setup'; uiFixtureInvocationObservation: 'unavailable'; uiRaceInjection: 'native_read_completion_abort_and_crypto_completion_only'; uiNamespaceHashKind: 'ordered_readonly_window_namespace_digests'
  profiles: BodyEvidenceProfile[]; nativeBoundaries:BodyNativeBoundary[]; nativeBoundaryCheckDenominator:16; uiCases: BodyUiCase[]; profileCheckDenominator: 40; uiCheckDenominator: 48
  expectedCapabilities: { liveProvider: false; network: false; credentials: false; writerMutation: false; previewPersistence: false }
  // External CI is outside this report's authority; neither pass nor fail is an admissible claim here.
  regressions: Array<{ id: typeof BODY_REGRESSION_GATES[number]; status: 'not_run' }>
  browserErrors: number; blockedExternalRequests: number; sourceStable: 'not_checked' | 'verified' | 'changed'; teardown: 'not_run' | 'pass' | 'failed'
  semanticExtraction: 'NOT_RUN'; semanticAdjudication: 'NOT_RUN'; autonomousGeneration: 'NOT_RUN'; wholeWorkAudit: 'NOT_RUN'
}
export const BODY_PROFILE_ORDER = [['node', 'zh'], ['node', 'en'], ['native', 'zh'], ['native', 'en']] as const
export function emptyBodyEvidenceProfile(runtime: BodyRuntime, language: 'zh' | 'en'): BodyEvidenceProfile {
  return { id: `${runtime}-${language}`, runtime, language, status: 'not_run', refusalCode: null, fixtureVersion: 'planning-contract-v1-compact-60', plannedChapters: 60, plannedTasks: 123,
    committedTasks: 0, committedBodyScalars: 0, actualFixtureInvocations: 0, reservedAttempts: 0, committedOperations: 0,
    checkpointHash: null, artifactSetHash: null, canonBaseRoot: null, fullPlanRoot: null, bodyPrefixRoot: null, packetDigest: null, namespaceHashBefore: null, namespaceHashAfter: null,
    cumulativeWrittenBytes: 0, outstandingBytes: 0, recoveryRemainingBytes: 0, openAllocations: 0, liveRecordCount: 0, liveSerializedMapBytes: 0, committedTransactions: 0, accountingMismatches: 0,
    setupMs: 0, maxStepMs: 0, timeoutEvents: 0, maxBodyScalars: 0, operationTimingsCollected: false, operationTimeouts: 0, operationAborts: 0, operationErrors: 0, maxIoOperationMs: 0, maxDispatchOperationMs: 0, previewInvocations: 0, previewMs: 0, maxPreviewMs: 0, previewRepositoryReadCalls: 0, previewRepositoryReadMs: 0, maxPreviewRepositoryReadMs: 0, previewIoReadCalls: 0, previewIoReadRecords: 0, previewIoReadBytes: 0,
    compileMeasurement: 'separate_pure_compile_equivalence', compileMs: 0, proposalBytes: 0, proposalUtf16: 0, packetBytes: 0, packetUtf16: 0, sourceCount: 0, spanCount: 0, claimCount: 0, sourceUtf16: 0, suppliedUtf16: 0, declaredExaminedUtf16: 0, semanticallyReviewedUtf16: 0,
    previewOperationTimeouts: 0, previewOperationAborts: 0, previewOperationErrors: 0, previewCampaignCommitAttempts: 0, previewCampaignTransactions: 0, previewWrittenBytes: 0, previewFixtureInvocations: 0,
    coldRepositoryRead: 'not_run', coldRepositoryReadMs: 0, coldRepositoryReadBytes: 0, coldRepositoryReadCalls: 0, coldProcessRestart: runtime === 'node' ? 'not_applicable' : 'not_run', coldProcessReadMs: 0, coldProcessInitialReadMs: 0, coldProcessReadBytes: 0, coldProcessReadCalls: 0,
    checks: BODY_PROFILE_CHECKS.map(id => ({ id, status: 'not_run' })), authority: emptyBodyEvidenceAuthority() }
}
export function emptyBodyUiCase(language: 'zh' | 'en'): BodyUiCase {
  return { language, status: 'not_run', failureStage: null, checks: BODY_UI_CHECKS.map(id => ({ id, status: 'not_run' })), planningArtifacts: 0, bodyArtifacts: 0, bodyScalars: 0, requestOrigins: 0, dispatchIntents: 0, attempts: 0, readOnlyChecks: 0, reloads: 0, processReopens: 0, heldReadRaces: 0, heldDraftRaces: 0, previewCampaignWriteEntries: 0, actualFixtureInvocations: null, namespaceHashBefore: null, namespaceHashAfter: null, authority: emptyBodyEvidenceAuthority() }
}
export function emptyBodyEvidenceReport(source: BodyEvidenceSource, environment: BodyEnvironment): BodyEvidenceReport {
  return { protocol: 'body-evidence-report-v1', scope: 'body_source_proposal_preview_engineering_only', externalRegressionPolicy: 'required_separate_exact_ci_not_awarded_by_this_report', contractVersion: 'campaign-body-evidence-proposals-v1', packetVersion: 'campaign-body-evidence-packet-v1', source: structuredClone(source), buildArtifacts: { node: null, native: null, ui: null }, environment, previewReadAccounting: 'repository_getMany_exact_batches', compileMeasurement: 'separate_pure_compile_equivalence', uiAuthorityScope: 'readonly_campaign_windows_excluding_navigation_setup', uiFixtureInvocationObservation: 'unavailable', uiRaceInjection: 'native_read_completion_abort_and_crypto_completion_only', uiNamespaceHashKind: 'ordered_readonly_window_namespace_digests',
    profiles: BODY_PROFILE_ORDER.map(([runtime, language]) => emptyBodyEvidenceProfile(runtime, language)), nativeBoundaries:[emptyBodyNativeBoundary('zh'),emptyBodyNativeBoundary('en')],nativeBoundaryCheckDenominator:16, uiCases: ['zh', 'en'].map(language => emptyBodyUiCase(language as 'zh' | 'en')), profileCheckDenominator: 40, uiCheckDenominator: 48,
    expectedCapabilities: { liveProvider: false, network: false, credentials: false, writerMutation: false, previewPersistence: false }, regressions: BODY_REGRESSION_GATES.map(id => ({ id, status: 'not_run' })), browserErrors: 0, blockedExternalRequests: 0, sourceStable: 'not_checked', teardown: 'not_run', semanticExtraction: 'NOT_RUN', semanticAdjudication: 'NOT_RUN', autonomousGeneration: 'NOT_RUN', wholeWorkAudit: 'NOT_RUN' }
}
export function safeBodyEvidenceCode(error: unknown): BodySafeCode {
  try { const code = typeof error === 'string' ? error : error && typeof error === 'object' && 'code' in error ? error.code : null; return typeof code === 'string' && (BODY_SAFE_CODES as readonly string[]).includes(code) ? code as BodySafeCode : 'profile_failure' } catch { return 'profile_failure' }
}
const fail = (): never => { throw new Error('invalid_body_evidence_report') }
function object(value: unknown, expected: readonly string[]): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return fail(); const actual = Object.keys(value); if (actual.length !== expected.length || actual.some(key => !expected.includes(key))) return fail(); return value as Record<string, unknown> }
function enumeration(value: unknown, allowed: readonly unknown[]): void { if (!allowed.includes(value)) fail() }
function number(value: unknown): void { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail() }
function digest(value: unknown, size = 64, nullable = false): void { if (!(nullable && value === null) && !(typeof value === 'string' && new RegExp(`^[a-f0-9]{${size}}$`).test(value))) fail() }
function authority(value: unknown, required = false): void { const row = object(value, Object.keys(emptyBodyEvidenceAuthority())); enumeration(row.observed, required ? [true] : [true, false]); for (const [key, count] of Object.entries(row)) if (key !== 'observed') { number(count); if (required && count !== 0) fail() } }
function checks(value: unknown, ids: readonly string[], allPass = false): void { if (!Array.isArray(value) || value.length !== ids.length) fail(); (value as unknown[]).forEach((item, i) => { const row = object(item, ['id', 'status']); enumeration(row.id, [ids[i]]); enumeration(row.status, allPass ? ['pass'] : ['not_run', 'pass', 'fail']) }) }
function validateProfile(value: unknown, runtime: BodyRuntime, language: 'zh' | 'en'): void {
  const template = emptyBodyEvidenceProfile(runtime, language), row = object(value, Object.keys(template));
  for (const [key, initial] of Object.entries(template)) if (typeof initial === 'number') number(row[key])
  for (const key of ['id', 'runtime', 'language', 'fixtureVersion', 'plannedChapters', 'plannedTasks', 'compileMeasurement', 'semanticallyReviewedUtf16'] as const) enumeration(row[key], [template[key]])
  enumeration(row.status, ['not_run', 'running', 'pass', 'refused', 'timeout', 'failed']); enumeration(row.refusalCode, [null, ...BODY_SAFE_CODES]);
  for (const key of ['checkpointHash', 'artifactSetHash', 'canonBaseRoot', 'fullPlanRoot', 'bodyPrefixRoot', 'packetDigest', 'namespaceHashBefore', 'namespaceHashAfter']) digest(row[key], 64, true)
  enumeration(row.operationTimingsCollected, row.status === 'pass' ? [true] : [false, true]); enumeration(row.coldRepositoryRead, ['not_run', 'verified']); enumeration(row.coldProcessRestart, runtime === 'node' ? ['not_applicable'] : ['not_run', 'verified', 'failed']); checks(row.checks, BODY_PROFILE_CHECKS, row.status === 'pass'); authority(row.authority, row.status === 'pass')
  if (row.status !== 'pass') return
  if (row.committedBodyScalars !== planningFixtureBodyTarget(language, 60) || row.sourceUtf16 !== PLANNING_COMPACT_BODY[language].length * 60 || row.maxBodyScalars !== [...PLANNING_COMPACT_BODY[language]].length) fail()
  if (row.refusalCode !== null || row.committedTasks !== 123 || row.actualFixtureInvocations !== 123 || row.reservedAttempts !== 123 || row.committedOperations !== 494 || row.committedTransactions !== 494 || row.outstandingBytes !== 0 || row.openAllocations !== 0 || row.accountingMismatches !== 0 || row.timeoutEvents !== 0) fail()
  for (const key of ['checkpointHash', 'artifactSetHash', 'canonBaseRoot', 'fullPlanRoot', 'bodyPrefixRoot', 'packetDigest', 'namespaceHashBefore', 'namespaceHashAfter']) digest(row[key])
  if (row.namespaceHashBefore !== row.namespaceHashAfter || row.sourceCount !== 60 || row.spanCount !== 60 || row.claimCount !== 60 || row.suppliedUtf16 !== row.sourceUtf16 || row.declaredExaminedUtf16 !== row.sourceUtf16 || row.previewInvocations !== 3 || row.previewRepositoryReadCalls !== 6 || row.coldRepositoryRead !== 'verified') fail()
  for (const key of ['operationTimeouts', 'operationAborts', 'operationErrors', 'previewOperationTimeouts', 'previewOperationAborts', 'previewOperationErrors', 'previewCampaignCommitAttempts', 'previewCampaignTransactions', 'previewWrittenBytes', 'previewFixtureInvocations']) if (row[key] !== 0) fail()
  for (const key of ['maxStepMs', 'maxPreviewMs']) if ((row[key] as number) >= 10_000) fail()
  if ((row.maxDispatchOperationMs as number) >= 5000) fail()
  for (const key of ['maxIoOperationMs', 'compileMs', 'maxPreviewRepositoryReadMs', 'coldRepositoryReadMs']) if ((row[key] as number) >= 3000) fail()
  for (const key of ['proposalBytes', 'proposalUtf16', 'packetBytes', 'packetUtf16']) if ((row[key] as number) < 1 || (row[key] as number) > 65_536) fail()
  if ((row.proposalUtf16 as number) > (row.proposalBytes as number) || (row.packetUtf16 as number) > (row.packetBytes as number) || (row.maxBodyScalars as number) > 256 || (row.maxBodyScalars as number) < 1) fail()
  for (const key of ['committedBodyScalars', 'cumulativeWrittenBytes', 'recoveryRemainingBytes', 'liveRecordCount', 'liveSerializedMapBytes', 'setupMs', 'previewRepositoryReadMs', 'previewIoReadCalls', 'previewIoReadRecords', 'previewIoReadBytes', 'sourceUtf16', 'coldRepositoryReadBytes', 'coldRepositoryReadCalls']) if ((row[key] as number) < 1) fail()
  if ((row.liveSerializedMapBytes as number) > (row.cumulativeWrittenBytes as number) || (row.cumulativeWrittenBytes as number) + (row.outstandingBytes as number) + (row.recoveryRemainingBytes as number) > 67_108_864) fail()
  if (row.coldProcessRestart === 'verified' && ((row.coldProcessInitialReadMs as number) >= 3000 || (row.coldProcessReadMs as number) < (row.coldProcessInitialReadMs as number) || (row.coldProcessReadBytes as number) < 1 || (row.coldProcessReadCalls as number) < 1)) fail()
}
function validateNativeBoundary(value:unknown,language:'zh'|'en'):void {
  const template=emptyBodyNativeBoundary(language),row=object(value,Object.keys(template)); enumeration(row.id,['planning_replacement']);enumeration(row.language,[language]);enumeration(row.status,['not_run','running','pass','failed']);enumeration(row.refusalCode,[null,...BODY_SAFE_CODES]);
  for(const [key,initial] of Object.entries(template)) if(typeof initial==='number')number(row[key]);
  for(const key of ['oldBodyPrefixRoot','newBodyPrefixRoot','oldFullPlanRoot','newFullPlanRoot','checkpointHash','namespaceHashAfter'])digest(row[key],64,true);
  for(const key of ['sourceChangeRefusal','invalidatedPrefixRefusal','staleProposalRefusal'])enumeration(row[key],[null,...BODY_SAFE_CODES]);
  enumeration(row.historicalPlanningAncestorsVerified,[false,true]);enumeration(row.coldProcessRestart,['not_run','verified','failed']);checks(row.checks,BODY_NATIVE_BOUNDARY_CHECKS);authority(row.authority,row.status==='pass');
  if(row.status!=='pass')return;
  if(row.refusalCode!==null||row.setupFixtureInvocations!==9||row.rebuildFixtureInvocations!==3||row.explicitCommittedTransactions!==14||row.finalCommittedTransactions!==52||row.finalOperations!==52||row.finalAttempts!==12||row.rebuiltBodyTasks!==3||row.previewInvocations!==5||row.previewCommitAttempts!==0||row.previewFixtureInvocations!==0||row.historicalPlanningAncestorsVerified!==true||row.historicalPlanningAncestorCount!==5||row.operationTimeouts!==0||row.operationAborts!==0||row.unexpectedOperationErrors!==0)fail();
  if(row.sourceChangeRefusal!=='source_changed'||row.invalidatedPrefixRefusal!=='no_accepted_body'||row.staleProposalRefusal!=='source_identity_mismatch'||row.oldBodyPrefixRoot===row.newBodyPrefixRoot||row.oldFullPlanRoot===row.newFullPlanRoot)fail();
  for(const key of ['oldBodyPrefixRoot','newBodyPrefixRoot','oldFullPlanRoot','newFullPlanRoot','checkpointHash','namespaceHashAfter'])digest(row[key]);
  if((row.maxActionMs as number)>=10000||(row.maxPreviewMs as number)>=10000)fail();
  const list=row.checks as BodyNativeBoundary['checks'];if(list.some(item=>item.id!=='cold_process_reopen'&&item.status!=='pass'))fail();
  if(row.coldProcessRestart==='verified'&&((row.coldProcessInitialReadMs as number)>=3000||(row.coldProcessReadMs as number)<(row.coldProcessInitialReadMs as number)||(row.coldProcessReadBytes as number)<1||(row.coldProcessReadCalls as number)<1||list.at(-1)!.status!=='pass'))fail();
}
function validateUi(value: unknown, language: 'zh' | 'en'): void {
  const template = emptyBodyUiCase(language), row = object(value, Object.keys(template)); enumeration(row.language, [language]); enumeration(row.status, ['not_run', 'running', 'pass', 'failed']); enumeration(row.failureStage, [null, 'launch', 'navigation', 'initial_ready', 'teardown', ...BODY_UI_CHECKS]); enumeration(row.actualFixtureInvocations, [null]);
  for (const [key, initial] of Object.entries(template)) if (typeof initial === 'number') number(row[key]); for (const key of ['namespaceHashBefore', 'namespaceHashAfter']) digest(row[key], 64, true)
  checks(row.checks, BODY_UI_CHECKS, row.status === 'pass'); authority(row.authority, row.status === 'pass')
  if (row.status === 'pass' && (row.failureStage !== null || (row.planningArtifacts as number) < 6 || (row.bodyArtifacts as number) < 3 || (row.bodyScalars as number) < 1 || (row.requestOrigins as number) < 9 || (row.dispatchIntents as number) < 9 || (row.attempts as number) < 9 || (row.readOnlyChecks as number) < 1 || (row.reloads as number) < 1 || (row.processReopens as number) < 1 || (row.heldReadRaces as number) < 1 || (row.heldDraftRaces as number) < 1)) fail()
  if (row.status === 'pass') { if (row.previewCampaignWriteEntries !== 0) fail(); digest(row.namespaceHashBefore); digest(row.namespaceHashAfter); if (row.namespaceHashBefore !== row.namespaceHashAfter) fail() }
}
export function validateBodyEvidenceReport(value: unknown): asserts value is BodyEvidenceReport {
  const source: BodyEvidenceSource = { commit: null, tree: null, coreSha256: '0'.repeat(64), harnessSha256: '0'.repeat(64), fixtureSha256: '0'.repeat(64), uiSha256: '0'.repeat(64), buildSha256: '0'.repeat(64) }, template = emptyBodyEvidenceReport(source, 'node'), row = object(value, Object.keys(template))
  for (const key of ['protocol', 'scope', 'externalRegressionPolicy', 'contractVersion', 'packetVersion', 'previewReadAccounting', 'compileMeasurement', 'uiAuthorityScope', 'uiFixtureInvocationObservation', 'uiRaceInjection', 'uiNamespaceHashKind', 'profileCheckDenominator', 'nativeBoundaryCheckDenominator', 'uiCheckDenominator', 'semanticExtraction', 'semanticAdjudication', 'autonomousGeneration', 'wholeWorkAudit'] as const) enumeration(row[key], [template[key]])
  enumeration(row.environment, ['node', 'native', 'ui', 'combined']); const s = object(row.source, Object.keys(source)); for (const key of ['commit', 'tree']) digest(s[key], 40, true); if ((s.commit === null) !== (s.tree === null)) fail(); for (const key of ['coreSha256', 'harnessSha256', 'fixtureSha256', 'uiSha256', 'buildSha256']) digest(s[key]); if (s.buildSha256 !== s.coreSha256) fail()
  const artifacts = object(row.buildArtifacts, ['node', 'native', 'ui']); enumeration(artifacts.node, [null]); digest(artifacts.native, 64, true); digest(artifacts.ui, 64, true);
  const capabilities = object(row.expectedCapabilities, Object.keys(template.expectedCapabilities)); Object.values(capabilities).forEach(value => enumeration(value, [false]));
  if (!Array.isArray(row.profiles) || row.profiles.length !== 4) fail(); (row.profiles as unknown[]).forEach((item, i) => { const pair = BODY_PROFILE_ORDER[i]!; validateProfile(item, pair[0], pair[1]) }); if (!Array.isArray(row.uiCases) || row.uiCases.length !== 2) fail(); (row.uiCases as unknown[]).forEach((item, i) => validateUi(item, i ? 'en' : 'zh')); checks(row.regressions, BODY_REGRESSION_GATES); if ((value as BodyEvidenceReport).regressions.some(item => item.status !== 'not_run')) fail();if(!Array.isArray(row.nativeBoundaries)||row.nativeBoundaries.length!==2)fail();(row.nativeBoundaries as unknown[]).forEach((item,i)=>validateNativeBoundary(item,i?'en':'zh'))
  number(row.browserErrors); number(row.blockedExternalRequests); enumeration(row.sourceStable, ['not_checked', 'verified', 'changed']); enumeration(row.teardown, ['not_run', 'pass', 'failed'])
  // Shards cannot impersonate another runtime's executed results. Combined report is built by the strict merger.
  if (row.environment !== 'combined') {
    const report = value as BodyEvidenceReport
    if (report.environment !== 'native' && report.buildArtifacts.native !== null || report.environment !== 'ui' && report.buildArtifacts.ui !== null) fail()
    for (const item of report.profiles) if (item.runtime !== report.environment && item.status !== 'not_run') fail()
    if(report.environment!=='native'&&report.nativeBoundaries.some(item=>item.status!=='not_run'))fail()
    if (report.environment !== 'ui' && report.uiCases.some(item => item.status !== 'not_run')) fail()
  }
}
export function bodyEvidenceReportExitCode(value: unknown): number {
  validateBodyEvidenceReport(value)
  if (['native', 'combined'].includes(value.environment) && value.buildArtifacts.native === null || ['ui', 'combined'].includes(value.environment) && value.buildArtifacts.ui === null) return 1
  if (value.browserErrors || value.blockedExternalRequests || value.sourceStable !== 'verified' || value.teardown !== 'pass') return 1
  const profiles = value.profiles.filter(row => value.environment === 'combined' || row.runtime === value.environment)
  if (profiles.some(row => row.status !== 'pass' || row.coldProcessRestart !== (row.runtime === 'native' ? 'verified' : 'not_applicable'))) return 1
  if(['native','combined'].includes(value.environment)&&value.nativeBoundaries.some(row=>row.status!=='pass'||row.coldProcessRestart!=='verified'))return 1
  if (['ui', 'combined'].includes(value.environment) && value.uiCases.some(row => row.status !== 'pass')) return 1
  return 0
}
export function parseBodyEvidenceReport(text: string): BodyEvidenceReport {
  if (typeof text !== 'string' || text.length > 1024 * 1024 || new TextEncoder().encode(text).length > 1024 * 1024) fail(); let value: unknown; try { value = JSON.parse(text) } catch { return fail() }; validateBodyEvidenceReport(value); if (`${JSON.stringify(value, null, 2)}\n` !== text) fail(); return value
}
export function mergeBodyEvidenceReports(shards: readonly BodyEvidenceReport[]): BodyEvidenceReport {
  if (shards.length !== 3) fail(); const [node, native, ui] = shards; if (!node || !native || !ui) fail(); [node, native, ui].forEach(validateBodyEvidenceReport)
  if (node.environment !== 'node' || native.environment !== 'native' || ui.environment !== 'ui' || JSON.stringify(node.source) !== JSON.stringify(native.source) || JSON.stringify(node.source) !== JSON.stringify(ui.source)) fail()
  const combined = emptyBodyEvidenceReport(structuredClone(node.source), 'combined'); combined.profiles = [...node.profiles.slice(0, 2), ...native.profiles.slice(2)].map(row => structuredClone(row)); combined.uiCases = structuredClone(ui.uiCases); combined.nativeBoundaries=structuredClone(native.nativeBoundaries); combined.buildArtifacts = { node: null, native: native.buildArtifacts.native, ui: ui.buildArtifacts.ui }; combined.browserErrors = node.browserErrors + native.browserErrors + ui.browserErrors; combined.blockedExternalRequests = node.blockedExternalRequests + native.blockedExternalRequests + ui.blockedExternalRequests; combined.sourceStable = shards.every(s => s.sourceStable === 'verified') ? 'verified' : shards.some(s => s.sourceStable === 'changed') ? 'changed' : 'not_checked'; combined.teardown = shards.every(s => s.teardown === 'pass') ? 'pass' : shards.some(s => s.teardown === 'failed') ? 'failed' : 'not_run'; validateBodyEvidenceReport(combined); return combined
}
