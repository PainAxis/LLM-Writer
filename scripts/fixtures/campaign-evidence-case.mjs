// Source-free synthetic report for archive boundary tests, not browser evidence.
export function campaignEvidenceCase() {
  return {
    schemaVersion: 1, reportKind: 'campaign-browser-foundation', commit: '1'.repeat(40),
    sourceTreeSha256: '2'.repeat(64), fixtureSha256: '3'.repeat(64), instrumentationSha256: '4'.repeat(64),
    instrumentationDelta: 'offline-host-observation-only-v1', denominator: 12,
    cases: Array.from({ length: 12 }, (_, index) => ({ id: `C${String(index + 1).padStart(2, '0')}`,
      status: index === 0 ? 'fail' : 'not_run',
      buildMode: index < 3 ? 'production' : 'test_instrumented_offline_host', fixtureDispatchEntries: index < 3 ? null : 0 })),
    passed: 0, failed: 1, notRun: 11, realModelRequests: 0, browserErrors: 0, blockedExternalRequests: 0,
    longformAcceptance: 'NOT_RUN',
  }
}
