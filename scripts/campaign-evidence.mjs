// Dedicated closed schema. Never recursively visit Campaign artifacts, request
// bodies, responses, backup data, error prose or unknown report fields.
import { CAMPAIGN_BROWSER_CASE_IDS, CAMPAIGN_PAGE_ERROR_CATEGORIES, CAMPAIGN_PAGE_ERROR_DIAGNOSTIC_LIMIT,
  isCampaignBrowserFailureStage } from './lib/writer-campaign-browser-diagnostics.mjs'
export const CAMPAIGN_REPORT_PATH = 'artifacts/browser-writer-campaign/report.json'
const ROOT_KEYS = ['schemaVersion', 'reportKind', 'commit', 'sourceTreeSha256', 'fixtureSha256',
  'instrumentationSha256', 'instrumentationDelta', 'denominator', 'cases', 'passed', 'failed',
  'notRun', 'realModelRequests', 'browserErrors', 'blockedExternalRequests', 'longformAcceptance',
  'pageErrorDiagnostics', 'pageErrorOverflow'].sort()
const ROW_KEYS = ['id', 'status', 'buildMode', 'fixtureDispatchEntries', 'failureStage', 'browserErrors'].sort()
const DIAGNOSTIC_KEYS = ['caseId', 'category', 'sha256'].sort()
const invalid = () => { throw new Error('Invalid closed Campaign evidence schema') }
const integer = value => Number.isSafeInteger(value) && value >= 0
const hex = (value, count) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${count}}$`).test(value)
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys)) invalid()
}

export function projectCampaignReport(input) {
  exact(input, ROOT_KEYS)
  if (input.schemaVersion !== 2 || input.reportKind !== 'campaign-browser-foundation'
    || input.denominator !== 12 || input.realModelRequests !== 0 || input.longformAcceptance !== 'NOT_RUN'
    || input.instrumentationDelta !== 'offline-host-observation-only-v1'
    || !hex(input.commit, 40)
    || !['sourceTreeSha256', 'fixtureSha256', 'instrumentationSha256'].every(key => hex(input[key], 64))
    || !['passed', 'failed', 'notRun', 'browserErrors', 'blockedExternalRequests', 'pageErrorOverflow'].every(key => integer(input[key]))
    || !Array.isArray(input.pageErrorDiagnostics) || input.pageErrorDiagnostics.length > CAMPAIGN_PAGE_ERROR_DIAGNOSTIC_LIMIT
    || !Array.isArray(input.cases) || input.cases.length !== 12) invalid()
  const cases = input.cases.map((row, index) => {
    exact(row, ROW_KEYS)
    const production = index < 3
    if (row.id !== `C${String(index + 1).padStart(2, '0')}` || !['pass', 'fail', 'not_run'].includes(row.status)
      || row.buildMode !== (production ? 'production' : 'test_instrumented_offline_host')
      || (production ? row.fixtureDispatchEntries !== null : !integer(row.fixtureDispatchEntries))
      || !integer(row.browserErrors)
      || (row.status === 'fail' ? !isCampaignBrowserFailureStage(row.id, row.failureStage) : row.failureStage !== null)
      || (row.status === 'pass' && row.browserErrors !== 0)) invalid()
    return { id: row.id, status: row.status, buildMode: row.buildMode, fixtureDispatchEntries: row.fixtureDispatchEntries,
      failureStage: row.failureStage, browserErrors: row.browserErrors }
  })
  for (const [field, status] of [['passed', 'pass'], ['failed', 'fail'], ['notRun', 'not_run']]) {
    if (input[field] !== cases.filter(row => row.status === status).length) invalid()
  }
  if (input.passed === 12 && (input.browserErrors || input.blockedExternalRequests)) invalid()
  const pageErrorDiagnostics = input.pageErrorDiagnostics.map(row => {
    exact(row, DIAGNOSTIC_KEYS)
    if (!(row.caseId === null || CAMPAIGN_BROWSER_CASE_IDS.includes(row.caseId))
      || !CAMPAIGN_PAGE_ERROR_CATEGORIES.includes(row.category) || !hex(row.sha256, 64)) invalid()
    return { caseId: row.caseId, category: row.category, sha256: row.sha256 }
  })
  if (pageErrorDiagnostics.length + input.pageErrorOverflow !== input.browserErrors) invalid()
  if (input.pageErrorOverflow > 0 && pageErrorDiagnostics.length !== CAMPAIGN_PAGE_ERROR_DIAGNOSTIC_LIMIT) invalid()
  const attributed = cases.reduce((total, row) => total + row.browserErrors, 0)
  if (attributed > input.browserErrors) invalid()
  for (const row of cases) {
    if (pageErrorDiagnostics.filter(error => error.caseId === row.id).length > row.browserErrors) invalid()
  }
  if (pageErrorDiagnostics.filter(error => error.caseId === null).length > input.browserErrors - attributed) invalid()
  return {
    schemaVersion: 2, reportKind: 'campaign-browser-foundation', commit: input.commit,
    sourceTreeSha256: input.sourceTreeSha256, fixtureSha256: input.fixtureSha256,
    instrumentationSha256: input.instrumentationSha256, instrumentationDelta: input.instrumentationDelta,
    denominator: 12, cases, passed: input.passed, failed: input.failed, notRun: input.notRun,
    realModelRequests: 0, browserErrors: input.browserErrors, blockedExternalRequests: input.blockedExternalRequests,
    pageErrorDiagnostics, pageErrorOverflow: input.pageErrorOverflow,
    longformAcceptance: 'NOT_RUN',
  }
}
