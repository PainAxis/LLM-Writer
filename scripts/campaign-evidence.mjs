// Dedicated closed schema. Never recursively visit Campaign artifacts, request
// bodies, responses, backup data, error prose or unknown report fields.
export const CAMPAIGN_REPORT_PATH = 'artifacts/browser-writer-campaign/report.json'
const ROOT_KEYS = ['schemaVersion', 'reportKind', 'commit', 'sourceTreeSha256', 'fixtureSha256',
  'instrumentationSha256', 'instrumentationDelta', 'denominator', 'cases', 'passed', 'failed',
  'notRun', 'realModelRequests', 'browserErrors', 'blockedExternalRequests', 'longformAcceptance'].sort()
const ROW_KEYS = ['id', 'status', 'buildMode', 'fixtureDispatchEntries'].sort()
const invalid = () => { throw new Error('Invalid closed Campaign evidence schema') }
const integer = value => Number.isSafeInteger(value) && value >= 0
const hex = (value, count) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${count}}$`).test(value)
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys)) invalid()
}

export function projectCampaignReport(input) {
  exact(input, ROOT_KEYS)
  if (input.schemaVersion !== 1 || input.reportKind !== 'campaign-browser-foundation'
    || input.denominator !== 12 || input.realModelRequests !== 0 || input.longformAcceptance !== 'NOT_RUN'
    || input.instrumentationDelta !== 'offline-host-observation-only-v1'
    || !hex(input.commit, 40)
    || !['sourceTreeSha256', 'fixtureSha256', 'instrumentationSha256'].every(key => hex(input[key], 64))
    || !['passed', 'failed', 'notRun', 'browserErrors', 'blockedExternalRequests'].every(key => integer(input[key]))
    || !Array.isArray(input.cases) || input.cases.length !== 12) invalid()
  const cases = input.cases.map((row, index) => {
    exact(row, ROW_KEYS)
    const production = index < 3
    if (row.id !== `C${String(index + 1).padStart(2, '0')}` || !['pass', 'fail', 'not_run'].includes(row.status)
      || row.buildMode !== (production ? 'production' : 'test_instrumented_offline_host')
      || (production ? row.fixtureDispatchEntries !== null : !integer(row.fixtureDispatchEntries))) invalid()
    return { id: row.id, status: row.status, buildMode: row.buildMode, fixtureDispatchEntries: row.fixtureDispatchEntries }
  })
  for (const [field, status] of [['passed', 'pass'], ['failed', 'fail'], ['notRun', 'not_run']]) {
    if (input[field] !== cases.filter(row => row.status === status).length) invalid()
  }
  if (input.passed === 12 && (input.browserErrors || input.blockedExternalRequests)) invalid()
  return {
    schemaVersion: 1, reportKind: 'campaign-browser-foundation', commit: input.commit,
    sourceTreeSha256: input.sourceTreeSha256, fixtureSha256: input.fixtureSha256,
    instrumentationSha256: input.instrumentationSha256, instrumentationDelta: input.instrumentationDelta,
    denominator: 12, cases, passed: input.passed, failed: input.failed, notRun: input.notRun,
    realModelRequests: 0, browserErrors: input.browserErrors, blockedExternalRequests: input.blockedExternalRequests,
    longformAcceptance: 'NOT_RUN',
  }
}
