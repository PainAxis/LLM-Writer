/** Source-free attribution for runner lifecycle failures. Observation objects are
 * runner-local; reports retain only their existing closed counters/statuses. */
export function beginStorageObservation(report, kind, index) {
  if (!['boundary', 'proofBoundary', 'profile'].includes(kind) || !Number.isSafeInteger(index) || index < 0) throw new Error('storage_observation_invalid')
  return { kind, index, baseline: { browserErrors: report.browserErrors, blockedExternalRequests: report.blockedExternalRequests }, browserErrors: 0, blockedExternalRequests: 0 }
}
export function failStorageObservation(report, observation, failureStage) {
  const rows = observation.kind === 'boundary' ? report.boundaries : observation.kind === 'proofBoundary' ? report.proofBoundaries : report.profiles
  const row = rows[observation.index]
  if (!row) throw new Error('storage_observation_invalid')
  // An already established failure/refusal/timeout remains the primary outcome.
  if (['fail', 'refused', 'timeout'].includes(row.status)) return
  rows[observation.index] = observation.kind !== 'profile'
    ? { ...row, status: 'fail', failureStage }
    : { ...row, status: 'fail', blockerCode: row.blockerCode ?? 'profile_failure' }
}
export function finalizeStorageObservation(report, observation) {
  if (observation.browserErrors) failStorageObservation(report, observation, 'page_errors')
  else if (observation.blockedExternalRequests) failStorageObservation(report, observation, 'external_requests')
}
export function recordStorageBrowserEvent(report, observation, kind) {
  const field = kind === 'page_error' ? 'browserErrors' : kind === 'external_request' ? 'blockedExternalRequests' : null
  if (!field) throw new Error('storage_observation_invalid')
  report[field]++; observation[field]++
  finalizeStorageObservation(report, observation)
}
