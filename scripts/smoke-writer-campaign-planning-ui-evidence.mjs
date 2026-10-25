/* global process */
/** Source-free UI report gates, including unknown-field refusal. No browser launched. */
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { installPreviewReadGate, planningUiReportExitCode, validatePlanningUiReport } from './browser-writer-campaign-planning-ui.mjs'
const CHECKS = ['create_refusal', 'plans_freeze', 'later_preview_readonly', 'chapter_reselection', 'newer_chapter_race', 'refresh_race', 'reload', 'process_reopen', 'campaign_selection_race', 'navigation_race', 'cancel_race', 'cross_tab_change']
const make = () => ({ schemaVersion: 1, reportKind: 'campaign-planning-ui-v1', source: { commit: null, tree: null, sourceSha256: 'a'.repeat(64), coreSha256: 'b'.repeat(64), harnessSha256: 'c'.repeat(64), buildSha256: 'd'.repeat(64) },
  buildMode: 'production_ui_native_idb', raceInjection: 'native_read_completion_only', privacyScope: 'campaign_actions_before_dashboard_navigation', denominator: 24,
  cases: ['zh', 'en'].map(language => ({ language, setup: 'pass', failureStage: null, checks: CHECKS.map(id => ({ id, status: 'pass' })), planningArtifacts: 6, bodyArtifacts: 0, bodyScalars: 0,
    requestOrigins: 6, dispatchIntents: 6, attempts: 6, readOnlyChecks: 8, reloads: 1, processReopens: 1, heldReadRaces: 6, configurationReads: 0 })),
  browserErrors: 0, blockedExternalRequests: 0, liveModelCalls: 0, actualFixtureInvocations: null, teardown: 'pass', sourceStable: 'verified', semanticConsistency: 'NOT_RUN', autonomousGeneration: 'NOT_RUN', wholeWorkAudit: 'NOT_RUN' })
try {
  validatePlanningUiReport(make()); assert.equal(planningUiReportExitCode(make()), 0)
  const mutations = [
    value => { value.privateText = 'forbidden' },
    value => { value.source.privateText = 'forbidden' },
    value => { value.cases[0].privateText = 'forbidden' },
    value => { value.cases[0].checks[0].privateText = 'forbidden' },
    value => { value.cases[0].failureStage = '/private/error/path' },
    value => { value.cases[0].checks[0].id = 'arbitrary-source-id' },
    value => { value.cases[0].checks[0].status = 'maybe' },
    value => { value.cases[0].configurationReads = 1 },
    value => { value.cases[0].dispatchIntents = 7 },
    value => { value.cases[0].bodyScalars = 1 },
    value => { value.cases[0].processReopens = 0 },
    value => { value.cases[0].heldReadRaces = 5 },
    value => { value.cases[0].readOnlyChecks = Number.MAX_SAFE_INTEGER + 1 },
    value => { value.actualFixtureInvocations = 0 },
    value => { value.source.commit = 'a'.repeat(40) },
    value => { value.source.coreSha256 = 'not-a-hash' },
    value => { value.privacyScope = 'all_application_activity' },
    value => { value.liveModelCalls = 1 },
    value => { value.wholeWorkAudit = 'PASS' },
    value => { value.denominator = 2 },
  ]
  for (const mutate of mutations) { const value = make(); mutate(value); assert.throws(() => validatePlanningUiReport(value)) }
  const incomplete = make(); incomplete.cases[0].setup = 'failed'; incomplete.cases[0].failureStage = 'launch'; incomplete.cases[0].checks.forEach(check => { check.status = 'not_run' }); validatePlanningUiReport(incomplete)
  assert.equal(planningUiReportExitCode(incomplete), 1)
  for (const key of ['browserErrors', 'blockedExternalRequests']) { const value = make(); value[key] = 1; assert.equal(planningUiReportExitCode(value), 1) }
  const changed = make(); changed.sourceStable = 'changed'; assert.equal(planningUiReportExitCode(changed), 1)
  const teardown = make(); teardown.teardown = 'failed'; assert.equal(planningUiReportExitCode(teardown), 1)
  // Deterministic scheduling only: never mutates native writes or record values.
  function environment(origin) {
    class Storage {
      constructor() { this.rows = new Map(); this.writes = 0 }
      getItem(key) { return this.rows.get(key) ?? null }
      setItem(key, value) { this.writes++; this.rows.set(key, value) }
    }
    class IDBObjectStore {
      constructor(transaction) { this.transaction = transaction }
      get(key) { return { key, native: true } }
    }
    class IDBTransaction {
      constructor(mode) { this.mode = mode; this.callback = null }
      get oncomplete() { return this.callback }
      set oncomplete(callback) { this.callback = callback }
      objectStore() { return new IDBObjectStore(this) }
      complete() { this.callback?.({ type: 'complete' }) }
    }
    class IDBDatabase { transaction(_names, mode) { return new IDBTransaction(mode) } }
    const localStorage = new Storage(), sandbox = { Storage, localStorage, location: { origin }, IDBObjectStore, IDBTransaction, IDBDatabase }
    vm.runInNewContext(`(${installPreviewReadGate.toString()})({ expectedOrigin: 'http://127.0.0.1:7777' })`, sandbox)
    return { ...sandbox, gate: sandbox.__planningUiReadGate, db: new IDBDatabase() }
  }
  const opaque = environment('null'); assert.equal(opaque.localStorage.writes, 0); assert.equal(opaque.gate, undefined)
  const native = environment('http://127.0.0.1:7777'); assert.equal(native.localStorage.writes, 2)
  let calls = 0
  const first = native.db.transaction('kv', 'readonly'); first.objectStore().get('head'); first.oncomplete = () => { calls++ }; first.complete(); assert.equal(calls, 1)
  native.gate.arm('head')
  const held = native.db.transaction('kv', 'readonly'); assert.equal(held.objectStore().get('head').native, true)
  held.oncomplete = () => { calls++ }; held.complete(); assert.equal(calls, 1); assert.equal(native.gate.snapshot().held, true)
  const concurrent = native.db.transaction('kv', 'readonly'); concurrent.objectStore().get('head'); concurrent.oncomplete = () => { calls++ }; concurrent.complete(); assert.equal(calls, 2)
  native.gate.release(); assert.equal(calls, 3); assert.equal(native.gate.snapshot().released, 1); assert.throws(() => native.gate.release())
  native.gate.arm('head')
  const write = native.db.transaction('kv', 'readwrite'); write.objectStore().get('head'); write.oncomplete = () => { calls++ }; write.complete(); assert.equal(calls, 4)
  assert.equal(native.gate.snapshot().held, false)
  const following = native.db.transaction('kv', 'readonly'); following.objectStore().get('head'); following.oncomplete = () => { calls++ }; following.complete(); assert.equal(calls, 4)
  native.gate.release(); assert.equal(calls, 5); assert.equal(native.gate.snapshot().observed, 2)
  native.localStorage.getItem('unrelated'); assert.equal(native.gate.snapshot().configurationReads, 0)
  native.localStorage.getItem('apiConfig'); assert.equal(native.gate.snapshot().configurationReads, 1)
  assert.equal(native.localStorage.writes, 2)
  console.log(`Planning UI report: ${mutations.length + 2} closed-schema, 6 exit-gate and 19 native-read-gate model checks passed; no browser run.`)
} catch { process.stderr.write('Planning UI report: schema_assertion_failed.\n'); process.exitCode = 1 }
