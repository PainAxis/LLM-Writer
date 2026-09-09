import { watch, type Ref, type WatchStopHandle } from 'vue'

export type WriterGenerationBarrierMode = 'commit' | 'settle'

type WriterGenerationAction = () => boolean | void
type WriterGenerationRevocation = () => boolean | void

/**
 * A single AI workspace owned by one generation flow.
 *
 * `interrupt` is used when another owner claims the workspace. If omitted,
 * `reset` is used for both interruption and full workspace resets.
 * `revokeBeforeWait` synchronously invalidates work that is still safe to
 * cancel before route/chapter navigation waits on persistence barriers. Its
 * return value is intentionally ignored: many controllers return `false` when
 * a request has already crossed into a barrier, which is safe once awaited.
 */
export interface WriterGenerationScopePort {
  reset: WriterGenerationAction
  interrupt?: WriterGenerationAction
  revokeBeforeWait?: WriterGenerationRevocation
}

/**
 * A non-cancellable boundary that must settle before source state is reset.
 *
 * `commit` barriers require a `true` result. `settle` barriers only protect
 * their lifetime: cancellation, `false`, or rejection does not mean that a
 * persistence operation failed.
 */
export interface WriterGenerationBarrierPort {
  isPending: Readonly<Ref<boolean>>
  wait: () => PromiseLike<boolean | void> | boolean | void
  mode?: WriterGenerationBarrierMode
}

export interface WriterGenerationArbiterOptions {
  checkApiReady: () => boolean
  notifyBlocked: (message: string) => unknown
  blockedMessage?: string
}

interface ScopeRegistration {
  port: WriterGenerationScopePort
}

interface BarrierRegistration {
  port: WriterGenerationBarrierPort
  stopActivityWatch: WatchStopHandle
}

const DEFAULT_BLOCKED_MESSAGE = '工作区正在保存，请稍候再开始新的 AI 操作'

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> => Boolean(
  value
  && (typeof value === 'object' || typeof value === 'function')
  && typeof (value as PromiseLike<unknown>).then === 'function',
)

/**
 * Coordinates independent Writer AI scopes without owning their business
 * state. Ports may be registered after construction, which lets controllers
 * receive `prepare(owner)` while those same controllers are still being built.
 */
export function useWriterGenerationArbiter<Owner extends string = string>(
  options: WriterGenerationArbiterOptions,
) {
  // Sets retain overlapping registrations. Silently replacing a live port
  // could otherwise make its pending persistence promise unreachable.
  const scopes = new Map<Owner, Set<ScopeRegistration>>()
  const barriers = new Map<string, Set<BarrierRegistration>>()
  let registryRevision = 0
  let barrierActivityRevision = 0
  let waitingForCommits = false
  let activeWait: Promise<boolean> | null = null

  const scopeRegistrations = (): ScopeRegistration[] =>
    [...scopes.values()].flatMap(registrations => [...registrations])

  const barrierRegistrations = (): BarrierRegistration[] =>
    [...barriers.values()].flatMap(registrations => [...registrations])

  const warnBlocked = (): void => {
    try {
      options.notifyBlocked(options.blockedMessage ?? DEFAULT_BLOCKED_MESSAGE)
    } catch {
      // A notification failure must not allow a conflicting request to start.
    }
  }

  const barrierIsPending = (registration: BarrierRegistration): boolean => {
    try {
      return registration.port.isPending.value
    } catch {
      // An unreadable barrier is treated as busy; proceeding could reset the
      // source state of an operation whose persistence status is unknown.
      return true
    }
  }

  const hasPendingBarrier = (): boolean =>
    barrierRegistrations().some(barrierIsPending)

  const registerScope = (
    owner: Owner,
    port: WriterGenerationScopePort,
  ): (() => void) => {
    const registration: ScopeRegistration = { port }
    let registrations = scopes.get(owner)
    if (!registrations) {
      registrations = new Set()
      scopes.set(owner, registrations)
    }
    registrations.add(registration)
    registryRevision += 1
    return () => {
      const current = scopes.get(owner)
      if (!current?.delete(registration)) return
      if (current.size === 0) scopes.delete(owner)
      registryRevision += 1
    }
  }

  const registerBarrier = (
    id: string,
    port: WriterGenerationBarrierPort,
  ): (() => void) => {
    const stopActivityWatch = watch(
      port.isPending,
      (pending, previousPending) => {
        // Track starts, not expected true -> false completion. This makes a
        // false -> true -> false re-entry visible even if no task is pending
        // when a slower sibling barrier finally settles.
        if (pending && !previousPending) barrierActivityRevision += 1
      },
      { flush: 'sync' },
    )
    const registration: BarrierRegistration = { port, stopActivityWatch }
    let registrations = barriers.get(id)
    if (!registrations) {
      registrations = new Set()
      barriers.set(id, registrations)
    }
    registrations.add(registration)
    registryRevision += 1
    return () => {
      const current = barriers.get(id)
      if (!current?.delete(registration)) return
      registration.stopActivityWatch()
      if (current.size === 0) barriers.delete(id)
      registryRevision += 1
    }
  }

  const runScopeAction = (action: WriterGenerationAction | undefined): boolean => {
    if (!action) return true
    try {
      return action() !== false
    } catch {
      return false
    }
  }

  /** Claim the AI workspace for `owner`, preserving only that owner's scope. */
  const prepare = (owner: Owner): boolean => {
    // Persistence always wins over a new request, including a request from the
    // same owner. This check intentionally happens before API configuration UI.
    if (waitingForCommits || hasPendingBarrier()) {
      warnBlocked()
      return false
    }

    let apiReady = false
    try {
      apiReady = options.checkApiReady()
    } catch {
      return false
    }
    if (!apiReady) return false

    const capturedRevision = registryRevision
    let interruptedSafely = true
    for (const [registeredOwner, registrations] of [...scopes.entries()]) {
      if (registeredOwner === owner) continue
      for (const registration of [...registrations]) {
        const action = registration.port.interrupt ?? registration.port.reset
        if (!runScopeAction(action)) interruptedSafely = false
      }
    }

    // A defensive second check covers a port that crossed a synchronous
    // persistence boundary while another scope was being interrupted.
    if (!interruptedSafely
      || capturedRevision !== registryRevision
      || hasPendingBarrier()) {
      warnBlocked()
      return false
    }
    return true
  }

  const normalizePreservedOwners = (
    preserveOwner?: Owner | readonly Owner[],
  ): Set<Owner> => {
    if (preserveOwner === undefined) return new Set()
    return new Set(
      Array.isArray(preserveOwner)
        ? preserveOwner as readonly Owner[]
        : [preserveOwner as Owner],
    )
  }

  /** Reset every registered workspace except the explicitly preserved owner(s). */
  const resetAll = (preserveOwner?: Owner | readonly Owner[]): boolean => {
    const preserved = normalizePreservedOwners(preserveOwner)
    if (waitingForCommits || hasPendingBarrier()) {
      warnBlocked()
      return false
    }
    const capturedRevision = registryRevision
    let resetSafely = true
    for (const [owner, registrations] of [...scopes.entries()]) {
      if (preserved.has(owner)) continue
      for (const registration of [...registrations]) {
        if (!runScopeAction(registration.port.reset)) resetSafely = false
      }
    }
    return resetSafely && capturedRevision === registryRevision
  }

  const waitOnBarrier = async (registration: BarrierRegistration): Promise<boolean> => {
    const settleOnly = registration.port.mode === 'settle'
    try {
      const result = await registration.port.wait()
      return settleOnly || result === true
    } catch {
      // A settle-only boundary has fulfilled its only contract once the task
      // ends, regardless of how it ended. Commit rejection remains a failure.
      return settleOnly
    }
  }

  /**
   * Revoke cancellable pre-commit work, then await all non-cancellable
   * boundaries. Only failed `commit` barriers prevent navigation.
   */
  const performCommitWait = async (): Promise<boolean> => {
    const revocationRevision = registryRevision
    const capturedActivityRevision = barrierActivityRevision
    let revokedSafely = true
    for (const registration of scopeRegistrations()) {
      try {
        const result: unknown = registration.port.revokeBeforeWait?.()
        // The public port is deliberately synchronous. Defend against an
        // untyped async callback without leaking an unhandled rejection or
        // allowing navigation before revocation actually completes.
        if (isPromiseLike(result)) {
          revokedSafely = false
          void Promise.resolve(result).then(
            () => undefined,
            () => undefined,
          )
        }
      } catch {
        revokedSafely = false
      }
    }
    if (revocationRevision !== registryRevision) revokedSafely = false

    // Invoke every waiter before yielding so all currently active promises are
    // captured from one synchronous workspace snapshot.
    const capturedBarriers = barrierRegistrations()
    const capturedRevision = registryRevision
    const pendingWaits = capturedBarriers.map(waitOnBarrier)
    const results = await Promise.all(pendingWaits)

    // A changed registry or a still-pending barrier is not covered by the
    // captured wait. Refuse navigation and let the caller retry.
    return revokedSafely
      && results.every(Boolean)
      && capturedRevision === registryRevision
      && capturedActivityRevision === barrierActivityRevision
      && !hasPendingBarrier()
  }

  const waitForCommits = (): Promise<boolean> => {
    if (activeWait) return activeWait

    waitingForCommits = true
    const wait = performCommitWait()
    activeWait = wait
    void wait.then(
      () => {
        if (activeWait !== wait) return
        activeWait = null
        waitingForCommits = false
      },
      () => {
        if (activeWait !== wait) return
        activeWait = null
        waitingForCommits = false
      },
    )
    return wait
  }

  const dispose = (): void => {
    const registeredBarriers = barrierRegistrations()
    for (const registration of registeredBarriers) registration.stopActivityWatch()
    scopes.clear()
    barriers.clear()
    registryRevision += 1
  }

  return {
    registerScope,
    registerBarrier,
    hasPendingBarrier,
    isWaitingForCommits: () => waitingForCommits,
    prepare,
    resetAll,
    waitForCommits,
    dispose,
  }
}
