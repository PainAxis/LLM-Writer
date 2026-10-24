/** Closed, source-free runner diagnostics. Never import a browser harness to validate evidence. */
import { createHash } from 'node:crypto'

export const CAMPAIGN_BROWSER_CASE_IDS = Object.freeze(Array.from({ length: 12 }, (_, index) => `C${String(index + 1).padStart(2, '0')}`))
export const CAMPAIGN_PAGE_ERROR_CATEGORIES = Object.freeze(['invalid_state', 'abort', 'transaction_inactive', 'reference', 'type', 'syntax', 'other'])
export const CAMPAIGN_PAGE_ERROR_DIAGNOSTIC_LIMIT = 32
const common = ['case_start', 'page_errors', 'external_requests', 'dispatch_evidence', 'cancel_evidence', 'duplicate_dispatch']
const specific = {
  C01: ['create_and_isolation', 'reload_no_run', 'config_privacy', 'dashboard_navigation'],
  C02: ['zh_create', 'en_create', ...['zh', 'en'].flatMap(language => [1, 2, 3, 4, 5].map(n => `${language}_task_${n}`)), 'fixture_completion', 'artifact_receipts', 'ordinary_isolation'],
  C03: ['safe_reopen', 'paused_reopen', 'complete_reopen', 'capacity_sample'],
  C04: ['same_head_gate', 'reserve_gate', 'both_tabs_settled', 'one_dispatch_artifact'],
  C05: ['intent_ack_gate', 'reopen_unknown', 'no_replay'],
  C06: ['adapter_entry_gate', 'reopen_unknown', 'no_replay'],
  C07: ['retained_ack_gate', 'reopen_save_only', 'atomic_saved'],
  C08: ['synchronous_put_failure', 'assert_rollback', 'save_only', 'assert_atomic_saved'],
  C09: ['prewarm', 'stale_response_gate', 'replace_outline', 'release_stale', 'regenerate', 'assert_lineage'],
  C10: ['cancel_before_intent', 'cancel_after_intent', 'cancel_failure'],
  C11: ['prewarm', 'resolve_cancel', 'unmount_gate', 'route_unmount', 'assert_unmount'],
  C12: ['settings', 'restore_confirm', 'reload_barrier', 'assert_isolation'],
}
export const CAMPAIGN_BROWSER_FAILURE_STAGES = Object.freeze(Object.fromEntries(CAMPAIGN_BROWSER_CASE_IDS.map(id => [id, Object.freeze([...common, ...specific[id]])])))
export function isCampaignBrowserFailureStage(caseId, value) {
  return typeof value === 'string' && CAMPAIGN_BROWSER_FAILURE_STAGES[caseId]?.includes(value) === true
}

/** Raw text is used only for classification/hash and is never returned or logged. */
export function classifyCampaignPageError(error) {
  let name = '', message = ''
  try {
    if (typeof error?.name === 'string') name = error.name.slice(0, 128)
    if (typeof error?.message === 'string') message = error.message.slice(0, 8192)
  } catch { /* Unreadable diagnostics are still counted as other. */ }
  let category = 'other'
  if (name === 'TransactionInactiveError') category = 'transaction_inactive'
  else if (name === 'InvalidStateError' || /(?:IDBTransaction|transaction).*(?:finished|inactive)|Failed to execute 'abort' on 'IDBTransaction'/i.test(message)) category = 'invalid_state'
  else if (name === 'AbortError') category = 'abort'
  else if (name === 'ReferenceError') category = 'reference'
  else if (name === 'TypeError') category = 'type'
  else if (name === 'SyntaxError') category = 'syntax'
  return { category, sha256: createHash('sha256').update(JSON.stringify([name, message])).digest('hex') }
}

/** Owner is captured when the page is registered, never looked up at event time. */
export function recordCampaignPageError(report, owner, error) {
  report.browserErrors++
  if (owner) {
    owner.browserErrors++
    if (owner.status === 'pass') { owner.status = 'fail'; owner.failureStage = 'page_errors' }
  }
  if (report.pageErrorDiagnostics.length < CAMPAIGN_PAGE_ERROR_DIAGNOSTIC_LIMIT) {
    report.pageErrorDiagnostics.push({ caseId: owner?.id ?? null, ...classifyCampaignPageError(error) })
  } else report.pageErrorOverflow++
}
