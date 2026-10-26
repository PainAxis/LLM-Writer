/** Runtime-only cold verification. Deadlines use performance.now(), never wall time. */
export interface ProducerVerificationContext {
  ownerStartedAt: number
  deadline: number
  signal: AbortSignal
  check(): void
  onProgress?(progress: ProducerVerificationProgress): void
}
export interface ProducerVerificationProgress {
  purpose: 'adoption_v2' | 'current_v3'
  stage: 'discovery' | 'origin_replay' | 'tail_replay' | 'final_fence'
  verifiedOperations: number
  verifiedRecords: number
  capturedBytes: number
  capturedEntries: number
  totalOperations: number | null
}
/** Cumulative observations; retention values are current, peaks and timings cumulative. */
export interface ProducerVerificationStats {
  protocol: 'producer-verification-session-v1'
  sessionsStarted: number
  sessionsCompleted: number
  sessionsFailed: number
  sessionsCancelled: number
  sessionsDisposed: number
  activeSessions: number
  sessionMaxMs: number
  rawIoCalls: number
  rawIoMaxMs: number
  casCalls: number
  casMaxMs: number
  advances: number
  maxOperationsPerAdvance: number
  hostYields: number
  synchronousSegmentMaxMs: number
  finalFencePasses: number
  finalFenceMaxMs: number
  finalFenceExpectedRecords: number
  finalFenceObservedRecords: number
  retainedBytes: number
  retainedEntries: number
  activePayloadRecords: number
  peakRetainedBytes: number
  peakRetainedEntries: number
  peakActivePayloadRecords: number
}
