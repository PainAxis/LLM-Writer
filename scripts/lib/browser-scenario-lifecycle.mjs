/** Diagnostic lifecycle only: no browser launch, scenario assertions or budgets.
 * Successful traces are discarded; only a failed scenario may be archived by
 * its caller into a runner-local directory outside the evidence upload paths. */
export async function timedLifecycleStage(name, run, { log = console.log, now = () => performance.now() } = {}) {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(name)) throw new Error('Invalid lifecycle stage')
  const started = now()
  log(`LIFECYCLE ${name} start`)
  try {
    const value = await run()
    log(`LIFECYCLE ${name} success durationMs=${Math.max(0, Math.round(now() - started))}`)
    return value
  } catch (error) {
    // Never put request, DOM, trace or exception payloads in lifecycle logs.
    log(`LIFECYCLE ${name} failure durationMs=${Math.max(0, Math.round(now() - started))}`)
    throw error
  }
}

export async function runTracedScenario({ tracing, run, failurePath, recordFailure, captureFailure, ...observations }) {
  if (typeof recordFailure !== 'function') throw new Error('A failure recorder is required')
  await timedLifecycleStage('trace-start', () => tracing.start({ screenshots: true, snapshots: true, sources: false }), observations)
  let result
  try { result = await run() }
  catch (error) {
    // Persist the primary failure before potentially slow/hung screenshots or
    // trace exports. A diagnostic timeout must not erase the original result.
    await timedLifecycleStage('failure-report', () => recordFailure(error), observations).catch(() => {})
    // Diagnostic failure must not replace the assertion that failed the test.
    if (captureFailure) await timedLifecycleStage('failure-screenshot', captureFailure, observations).catch(() => {})
    await timedLifecycleStage('trace-failure-retain', () => tracing.stop({ path: failurePath }), observations).catch(() => {})
    throw error
  }
  // No path means Playwright discards the chunk instead of synchronizing and
  // ZIP-compressing a whole successful suite. A stop failure still fails CI.
  await timedLifecycleStage('trace-discard', () => tracing.stop(), observations)
  return result
}

export async function cleanupInOrder(stages, observations) {
  let failed = false, firstError
  for (const [name, run] of stages) {
    try { await timedLifecycleStage(name, run, observations) }
    catch (error) { if (!failed) { failed = true; firstError = error } }
  }
  // Try every teardown even when one fails, preserving the first failure.
  if (failed) throw firstError
}
