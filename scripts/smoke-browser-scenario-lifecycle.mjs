import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { cleanupInOrder, runTracedScenario, timedLifecycleStage } from './lib/browser-scenario-lifecycle.mjs'

let passed = 0
const failurePath = '/runner-local/diagnostics/failure-trace.zip'
function fixture({ startError, stopError, screenshotError, persistenceError } = {}) {
  const events = [], logs = []
  let ticks = 0
  return {
    events, logs,
    options: {
      tracing: {
        async start(options) { events.push(['start', options]); if (startError) throw startError },
        async stop(...args) { events.push(['stop', args]); if (stopError) throw stopError },
      },
      failurePath,
      async recordFailure(error) { events.push(['record-failure', error]); if (persistenceError) throw persistenceError },
      async captureFailure() { events.push(['screenshot']); if (screenshotError) throw screenshotError },
      log: line => logs.push(line), now: () => ticks += 2,
    },
  }
}
async function sameRejection(run, expected) {
  let rejected = false
  try { await run() } catch (error) { rejected = true; assert.equal(error, expected) }
  assert.equal(rejected, true)
}

const success = fixture()
assert.equal(await runTracedScenario({ ...success.options, run: async () => { success.events.push(['run']); return 42 } }), 42)
assert.deepEqual(success.events, [
  ['start', { screenshots: true, snapshots: true, sources: false }], ['run'], ['stop', []],
])
assert.deepEqual(success.logs, ['LIFECYCLE trace-start start', 'LIFECYCLE trace-start success durationMs=2',
  'LIFECYCLE trace-discard start', 'LIFECYCLE trace-discard success durationMs=2'])
passed++

const assertion = new Error('original scenario assertion'), failure = fixture()
await sameRejection(() => runTracedScenario({ ...failure.options, run: async () => { failure.events.push(['run']); throw assertion } }), assertion)
assert.deepEqual(failure.events, [
  ['start', { screenshots: true, snapshots: true, sources: false }], ['run'], ['record-failure', assertion], ['screenshot'], ['stop', [{ path: failurePath }]],
])
assert.ok(failure.logs.some(line => line.startsWith('LIFECYCLE trace-failure-retain success')))
assert.ok(failure.logs.every(line => !line.includes(assertion.message) && !line.includes(failurePath)))
passed++

for (const diagnostics of [
  { screenshotError: new Error('screenshot failure') },
  { stopError: new Error('trace retention failure') },
  { screenshotError: new Error('screenshot failure'), stopError: new Error('trace retention failure') },
  { persistenceError: new Error('failure report persistence failed') },
  { persistenceError: new Error('failure report persistence failed'), screenshotError: new Error('screenshot failure'), stopError: new Error('trace retention failure') },
]) {
  const failed = fixture(diagnostics)
  await sameRejection(() => runTracedScenario({ ...failed.options, run: async () => { throw assertion } }), assertion)
  assert.deepEqual(failed.events.at(-1), ['stop', [{ path: failurePath }]])
  assert.ok(failed.logs.some(line => line.includes(' failure durationMs=')))
  passed++
}

for (const pendingStage of ['screenshot', 'trace']) {
  const pending = fixture(), report = { status: 'running', persisted: false }
  let release, entered, completed = false
  const gate = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  const options = {
    ...pending.options,
    async recordFailure(error) {
      report.status = 'failed'; report.error = error
      await Promise.resolve() // Model an awaited write that must complete first.
      report.persisted = true
    },
  }
  const waitForRelease = async () => {
    assert.deepEqual(report, { status: 'failed', error: assertion, persisted: true })
    entered(); await gate
  }
  if (pendingStage === 'screenshot') options.captureFailure = waitForRelease
  else options.tracing = { ...options.tracing, stop: waitForRelease }
  // Attach rejection handling immediately; the diagnostic is deliberately held.
  const outcome = runTracedScenario({ ...options, run: async () => { throw assertion } }).then(
    () => { completed = true; return null }, error => { completed = true; return error },
  )
  await started
  assert.equal(completed, false)
  assert.equal(report.persisted, true, 'Primary failure must be durable even while diagnostics never settle')
  release()
  assert.equal(await outcome, assertion)
  passed++
}

const startError = new Error('trace start failure'), start = fixture({ startError })
await sameRejection(() => runTracedScenario({ ...start.options, run: () => assert.fail('Must not execute without trace start') }), startError)
assert.equal(start.events.length, 1)
assert.ok(start.logs.at(-1).startsWith('LIFECYCLE trace-start failure'))
passed++

const stopError = new Error('successful trace discard failure'), stop = fixture({ stopError })
await sameRejection(() => runTracedScenario({ ...stop.options, run: () => 'scenario completed' }), stopError)
assert.deepEqual(stop.events.at(-1), ['stop', []])
assert.equal(stop.events.length, 2, 'Never archive a successful scenario or hide discard failure')
passed++

const repeated = fixture()
for (let i = 0; i < 20; i++) await runTracedScenario({ ...repeated.options, run: async () => i })
assert.equal(repeated.events.filter(([kind]) => kind === 'start').length, 20)
assert.equal(repeated.events.filter(([kind]) => kind === 'stop').length, 20)
assert.ok(repeated.events.filter(([kind]) => kind === 'stop').every(([, args]) => args.length === 0))
passed++

const order = [], observations = { log: () => {}, now: () => 0 }
await cleanupInOrder(['report-write', 'browser-close', 'provider-close', 'preview-close'].map(name => [name, async () => { order.push(name) }]), observations)
order.push('final-pass')
assert.deepEqual(order, ['report-write', 'browser-close', 'provider-close', 'preview-close', 'final-pass'])
passed++

const firstError = new Error('browser close failed'), laterError = new Error('server close failed'), failedOrder = []
await sameRejection(async () => {
  await cleanupInOrder([
    ['report-write', () => failedOrder.push('report')],
    ['browser-close', () => { failedOrder.push('browser'); throw firstError }],
    ['provider-close', () => { failedOrder.push('provider'); throw laterError }],
    ['preview-close', () => failedOrder.push('preview')],
  ], observations)
  assert.fail('No final pass after cleanup failure')
}, firstError)
assert.deepEqual(failedOrder, ['report', 'browser', 'provider', 'preview'])
passed++

// Even a falsy thrown value must remain a failed cleanup rather than a pass.
await sameRejection(() => cleanupInOrder([['browser-close', () => { throw null }]], observations), null)
passed++

await assert.rejects(() => timedLifecycleStage('payload\nunsafe', () => assert.fail('Invalid stage ran'), observations), /Invalid lifecycle stage/)
passed++

const missingRecorder = fixture()
await assert.rejects(() => runTracedScenario({ ...missingRecorder.options, recordFailure: undefined, run: () => {} }), /failure recorder is required/)
assert.equal(missingRecorder.events.length, 0)
passed++

// Check the real harness wiring without importing it (which launches a browser).
const source = await readFile(new URL('./browser-memory-novel-scan.mjs', import.meta.url), 'utf8')
assert.equal(source.includes('await context.tracing.start('), false)
assert.equal(source.includes('context?.tracing.stop('), false)
assert.ok(source.includes("failurePath: path.join(localEvidence, 'failure-trace.zip')"))
assert.ok(source.includes('await runTracedScenario({ tracing: context.tracing, run,'))
const recorder = source.slice(source.indexOf('recordFailure: async error => {'), source.indexOf('captureFailure: () =>'))
assert.ok(recorder.indexOf("item.status = 'failed'") < recorder.indexOf('await writeCurrentReport()'))
assert.ok(recorder.indexOf('process.exitCode = 1') < recorder.indexOf('await writeCurrentReport()'))
assert.ok(source.lastIndexOf('if (!process.exitCode) console.log(`PASS ') > source.lastIndexOf('await cleanupInOrder('))
assert.ok(source.includes("assert.equal(report.tests.length, 20, 'Every declared built-app scenario must execute without skipping')"))
assert.ok(source.includes("assert.equal(scanRequests().length, 1501)"))
passed++

console.log(`PASS ${passed} browser diagnostic lifecycle checks; no browser, provider or trace archive created`)
