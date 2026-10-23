import { computed, shallowReactive } from 'vue'

export type WriterCommitKnowledge = 'unknown' | 'committed' | 'not_committed'
export type WriterSaveState = 'saving' | 'clean' | 'failed' | 'unknown'
export interface WriterSaveOutcome {
  readonly status: 'clean' | 'failed' | 'unknown'
  readonly initialCommit: WriterCommitKnowledge
  readonly lastSnapshotCommit: WriterCommitKnowledge
  readonly catchUpFailed: boolean
  readonly hasUnsavedChanges: boolean
}
export interface WriterSaveHandle {
  readonly operationId: number
  readonly projectId: number | null
  readonly chapterId: number | null
  readonly epoch: number
  readonly initialSnapshotId: number
  readonly state: WriterSaveState
  readonly initialCommit: WriterCommitKnowledge
  readonly lastSnapshotCommit: WriterCommitKnowledge
  readonly settled: Promise<WriterSaveOutcome>
  /** UI uncertainty is never permission to cancel or dispatch a second write. */
  markUnknown(): void
}
export interface WriterMutationIntent {
  readonly workspaceEpoch: number
  readonly mutationEpoch: number
}
export interface WriterApplyLease {
  readonly projectId: number
  readonly chapterId: number
  readonly epoch: number
  readonly applied: boolean
  readonly valid: boolean
  /** Call synchronously immediately BEFORE the one editor mutation. */
  markApplied(): boolean
  releaseBeforeMutation(): boolean
  releaseIfClean(): boolean
}
export interface WriterMutationGate {
  captureMutationIntent(): WriterMutationIntent
  allowMutation(intent?: WriterMutationIntent): boolean
}

/** A workspace-local capability, not a persisted token or another storage path. */
export function createWriterPersistenceGate(options: {
  target(): { projectId: number | null; chapterId: number | null }
  canAcquire(): boolean
  canRelease?(): boolean
}) {
  const state = shallowReactive({ workspaceEpoch: 0, mutationEpoch: 0, ownershipEpoch: 0, owner: null as WriterApplyLease | null })
  const intents = new WeakSet<WriterMutationIntent>()
  let cleanLease: WriterApplyLease | null = null

  const captureMutationIntent = (): WriterMutationIntent => {
    const intent = Object.freeze({ workspaceEpoch: state.workspaceEpoch, mutationEpoch: state.mutationEpoch })
    intents.add(intent)
    return intent
  }
  const allowMutation = (intent?: WriterMutationIntent): boolean => {
    if (state.owner) return false
    if (intent && (!intents.has(intent) || intent.workspaceEpoch !== state.workspaceEpoch
      || intent.mutationEpoch !== state.mutationEpoch)) return false
    state.mutationEpoch += 1
    return true
  }
  const acquireApplyLease = (): WriterApplyLease | null => {
    const target = options.target()
    if (state.owner || !options.canAcquire() || target.projectId === null || target.chapterId === null) return null
    // Acquiring and releasing an apply guard revokes every older async CRUD intent.
    state.mutationEpoch += 1
    state.ownershipEpoch += 1
    const epoch = state.workspaceEpoch
    const mutationEpoch = state.mutationEpoch
    const local = shallowReactive({ applied: false, revoked: false })
    const lease: WriterApplyLease = Object.freeze({
      projectId: target.projectId, chapterId: target.chapterId, epoch,
      get applied() { return local.applied },
      get valid() {
        const current = options.target()
        return !local.revoked && state.owner === lease && state.workspaceEpoch === epoch
          && current.projectId === target.projectId && current.chapterId === target.chapterId
          && (local.applied || state.mutationEpoch === mutationEpoch)
      },
      markApplied() {
        if (!lease.valid || local.applied) return false
        local.applied = true
        return true
      },
      releaseBeforeMutation() {
        if (local.applied) return false
        local.revoked = true
        if (state.owner === lease) state.owner = null
        return true
      },
      releaseIfClean() {
        if (state.owner !== lease || cleanLease !== lease || options.canRelease?.() === false) return false
        local.revoked = true
        state.owner = null
        cleanLease = null
        return true
      },
    })
    state.owner = lease
    return lease
  }
  const noteAuthorEdit = () => {
    cleanLease = null
    state.mutationEpoch += 1
    // Before mutation, a keystroke invalidates the capability. After mutation it
    // is real catch-up work for the same owner, never new append authority.
    if (state.owner && !state.owner.applied) state.owner.releaseBeforeMutation()
  }
  const workspaceIntents = new WeakSet<object>()
  const captureWorkspaceIntent = () => {
    const intent = Object.freeze({ workspaceEpoch: state.workspaceEpoch, ownershipEpoch: state.ownershipEpoch })
    workspaceIntents.add(intent)
    return intent
  }
  const allowWorkspaceChange = (intent: ReturnType<typeof captureWorkspaceIntent>) => {
    if (!workspaceIntents.has(intent) || state.owner || intent.workspaceEpoch !== state.workspaceEpoch
      || intent.ownershipEpoch !== state.ownershipEpoch) return false
    state.mutationEpoch += 1
    return true
  }
  const advanceWorkspace = () => {
    state.workspaceEpoch += 1
    state.mutationEpoch += 1
    if (state.owner && !state.owner.applied) state.owner.releaseBeforeMutation()
  }
  return {
    acquireApplyLease, captureMutationIntent, allowMutation, noteAuthorEdit, advanceWorkspace,
    captureWorkspaceIntent, allowWorkspaceChange,
    isMutationBlocked: computed(() => state.owner !== null),
    get workspaceEpoch() { return state.workspaceEpoch },
    owns: (lease: WriterApplyLease) => state.owner === lease,
    markClean: (lease: WriterApplyLease) => { if (state.owner === lease) cleanLease = lease },
  }
}
