import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ref } from 'vue'
import { useWriterGenerationArbiter } from '../src/composables/useWriterGenerationArbiter'

type Owner = 'chapterContent' | 'continue' | 'optimize' | 'outline'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

function testDelayedRegistrationAndOwnerAwarePrepare() {
  const calls: string[] = []
  const warnings: string[] = []
  let apiReady = true
  let apiChecks = 0
  const commitPending = ref(false)
  const arbiter = useWriterGenerationArbiter<Owner>({
    checkApiReady: () => {
      apiChecks += 1
      calls.push('api')
      return apiReady
    },
    notifyBlocked: message => warnings.push(message),
  })

  // Construction is useful before any controller exists. Controllers may keep
  // this callback and scopes can be registered after their own construction.
  const ensureContentReady = () => arbiter.prepare('chapterContent')
  assert.equal(ensureContentReady(), true)
  assert.deepEqual(calls, ['api'])

  arbiter.registerScope('chapterContent', {
    reset: () => { calls.push('content:reset') },
    interrupt: () => { calls.push('content:interrupt') },
  })
  arbiter.registerScope('continue', {
    reset: () => { calls.push('continue:reset') },
    interrupt: () => { calls.push('continue:interrupt') },
  })
  arbiter.registerScope('optimize', {
    reset: () => { calls.push('optimize:reset') },
  })
  arbiter.registerBarrier('chapter-content-commit', {
    isPending: commitPending,
    wait: () => true,
  })

  calls.length = 0
  commitPending.value = true
  assert.equal(ensureContentReady(), false)
  assert.equal(apiChecks, 1, '提交屏障必须先于 API 检查')
  assert.deepEqual(calls, [], '提交期间不能中断任何工作区')
  assert.equal(warnings.at(-1), '工作区正在保存，请稍候再开始新的 AI 操作')

  commitPending.value = false
  apiReady = false
  assert.equal(ensureContentReady(), false)
  assert.deepEqual(calls, ['api'], 'API 不可用时不能破坏已有工作区')

  calls.length = 0
  apiReady = true
  assert.equal(ensureContentReady(), true)
  assert.deepEqual(calls, [
    'api',
    'continue:interrupt',
    'optimize:reset',
  ], '仅保留当前 owner，并优先使用 interrupt')

  calls.length = 0
  const unregisterOld = arbiter.registerScope('outline', {
    reset: () => { calls.push('old-outline') },
  })
  const unregisterCurrent = arbiter.registerScope('outline', {
    reset: () => { calls.push('new-outline') },
  })
  assert.equal(ensureContentReady(), true)
  assert.equal(calls.includes('old-outline'), true)
  assert.equal(calls.includes('new-outline'), true,
    '同 owner 的重叠注册都必须保持可中断，不能静默覆盖旧活动任务')

  calls.length = 0
  unregisterOld()
  assert.equal(ensureContentReady(), true)
  assert.equal(calls.includes('old-outline'), false)
  assert.equal(calls.includes('new-outline'), true,
    '旧注册的清理函数不能删除后来替换的端口')
  unregisterCurrent()
}

function testPrepareFailureAndBarrierReplacement() {
  const warnings: string[] = []
  let apiChecks = 0
  const oldStoragePending = ref(true)
  const currentStoragePending = ref(true)
  const arbiter = useWriterGenerationArbiter<Owner>({
    checkApiReady: () => {
      apiChecks += 1
      return true
    },
    notifyBlocked: message => warnings.push(message),
    blockedMessage: '正在落盘',
  })

  const unregisterOld = arbiter.registerBarrier('storage', {
    isPending: oldStoragePending,
    wait: () => true,
  })
  const unregisterCurrent = arbiter.registerBarrier('storage', {
    isPending: currentStoragePending,
    wait: () => true,
  })
  assert.equal(arbiter.prepare('continue'), false,
    '同 id 的后注册 barrier 不能覆盖旧 pending barrier')
  assert.equal(apiChecks, 0)
  unregisterOld()
  assert.equal(arbiter.prepare('continue'), false)
  assert.equal(apiChecks, 0)
  assert.equal(warnings.at(-1), '正在落盘')

  currentStoragePending.value = false
  const laterCommit = ref(false)
  arbiter.registerBarrier('late-commit', {
    isPending: laterCommit,
    wait: () => true,
  })
  arbiter.registerScope('optimize', {
    reset: () => undefined,
    interrupt: () => {
      laterCommit.value = true
      return true
    },
  })
  assert.equal(arbiter.prepare('continue'), false,
    '中断其他 scope 后同步进入的提交必须由第二次屏障检查拦截')

  unregisterCurrent()

  const throwingApi = useWriterGenerationArbiter<Owner>({
    checkApiReady: () => { throw new Error('配置读取失败') },
    notifyBlocked: () => { throw new Error('通知失败') },
  })
  let interrupted = false
  throwingApi.registerScope('outline', {
    reset: () => { interrupted = true },
  })
  assert.equal(throwingApi.prepare('continue'), false)
  assert.equal(interrupted, false)

  const throwingInterrupt = useWriterGenerationArbiter<Owner>({
    checkApiReady: () => true,
    notifyBlocked: () => { throw new Error('通知组件已销毁') },
  })
  let followingScopeInterrupted = false
  throwingInterrupt.registerScope('continue', {
    reset: () => undefined,
    interrupt: () => { throw new Error('中断失败') },
  })
  throwingInterrupt.registerScope('outline', {
    reset: () => { followingScopeInterrupted = true },
  })
  assert.equal(throwingInterrupt.prepare('chapterContent'), false)
  assert.equal(followingScopeInterrupted, true,
    '一个端口异常不能阻止其余旧请求被撤销')

  const changingRegistry = useWriterGenerationArbiter<Owner>({
    checkApiReady: () => true,
    notifyBlocked: () => undefined,
  })
  changingRegistry.registerScope('continue', {
    reset: () => undefined,
    interrupt: () => {
      changingRegistry.registerScope('outline', { reset: () => undefined })
    },
  })
  assert.equal(changingRegistry.prepare('chapterContent'), false,
    '中断过程中新增的 scope 未包含在旧快照中，本次 claim 必须失败')
}

function testResetAllPreservesOwnersAndAggregatesFailures() {
  const calls: string[] = []
  const arbiter = useWriterGenerationArbiter<Owner>({
    checkApiReady: () => true,
    notifyBlocked: () => undefined,
  })
  arbiter.registerScope('chapterContent', {
    reset: () => { calls.push('content') },
  })
  arbiter.registerScope('continue', {
    reset: () => {
      calls.push('continue')
      return false
    },
  })
  arbiter.registerScope('optimize', {
    reset: () => {
      calls.push('optimize')
      throw new Error('编辑器已销毁')
    },
  })
  arbiter.registerScope('outline', {
    reset: () => { calls.push('outline') },
  })
  const commitPending = ref(true)
  arbiter.registerBarrier('content-save', {
    isPending: commitPending,
    wait: () => true,
  })

  assert.equal(arbiter.resetAll('chapterContent'), false)
  assert.deepEqual(calls, [], 'pending barrier 期间不能重置任何 source state')
  commitPending.value = false

  assert.equal(arbiter.resetAll(['chapterContent', 'outline']), false)
  assert.deepEqual(calls, ['continue', 'optimize'],
    '重置失败仍应继续清理其他非保留 owner')

  calls.length = 0
  assert.equal(arbiter.resetAll('continue'), false)
  assert.deepEqual(calls, ['content', 'optimize', 'outline'])
}

async function testWaitRevokesFirstAndRequiresOnlyCommitSuccess() {
  const events: string[] = []
  const commitGate = deferred<boolean>()
  const materialGate = deferred<boolean>()
  const selectionGate = deferred<boolean>()
  const contentCommitPending = ref(true)
  const materialCommitPending = ref(true)
  const selectionPending = ref(true)

  const arbiter = useWriterGenerationArbiter<Owner>({
    checkApiReady: () => true,
    notifyBlocked: () => undefined,
  })
  arbiter.registerScope('chapterContent', {
    reset: () => undefined,
    revokeBeforeWait: () => { events.push('revoke:content') },
  })
  arbiter.registerScope('outline', {
    reset: () => undefined,
    revokeBeforeWait: () => { events.push('revoke:outline') },
  })
  arbiter.registerBarrier('content-commit', {
    isPending: contentCommitPending,
    wait: async () => {
      events.push('wait:content')
      const result = await commitGate.promise
      contentCommitPending.value = false
      return result
    },
  })
  arbiter.registerBarrier('material-commit', {
    isPending: materialCommitPending,
    wait: async () => {
      events.push('wait:material')
      const result = await materialGate.promise
      materialCommitPending.value = false
      return result
    },
  })
  arbiter.registerBarrier('chapter-selection', {
    mode: 'settle',
    isPending: selectionPending,
    wait: async () => {
      events.push('wait:selection')
      try {
        return await selectionGate.promise
      } finally {
        selectionPending.value = false
      }
    },
  })

  let finished = false
  const waitRequest = arbiter.waitForCommits()
  assert.equal(arbiter.waitForCommits(), waitRequest,
    '并发导航应复用同一个完整 barrier 等待')
  assert.equal(arbiter.isWaitingForCommits(), true)
  const waiting = waitRequest.then(result => {
    finished = true
    return result
  })
  assert.deepEqual(events, [
    'revoke:content',
    'revoke:outline',
    'wait:content',
    'wait:material',
    'wait:selection',
  ], '所有撤销必须在任一 waiter 开始前同步完成')

  selectionGate.resolve(false)
  commitGate.resolve(true)
  await flushMicrotasks()
  assert.equal(finished, false, '所有 barrier 应并发等待，不能提前放行')
  assert.equal(arbiter.prepare('continue'), false,
    '等待落盘期间新的 AI 请求仍必须被屏障拦截')

  materialGate.resolve(true)
  assert.equal(await waiting, true,
    'settle barrier 的取消结果 false 不代表保存失败')
  assert.equal(arbiter.isWaitingForCommits(), false)
}

async function testWaitFailureModesAndLateBarrierRace() {
  const commitFalse = useWriterGenerationArbiter<Owner>({
    checkApiReady: () => true,
    notifyBlocked: () => undefined,
  })
  commitFalse.registerBarrier('failed-save', {
    isPending: ref(false),
    wait: () => false,
  })
  assert.equal(await commitFalse.waitForCommits(), false)

  const commitReject = useWriterGenerationArbiter<Owner>({
    checkApiReady: () => true,
    notifyBlocked: () => undefined,
  })
  let secondWaiterCalled = false
  commitReject.registerBarrier('rejected-save', {
    isPending: ref(false),
    wait: () => Promise.reject(new Error('磁盘不可用')),
  })
  commitReject.registerBarrier('other-save', {
    isPending: ref(false),
    wait: () => {
      secondWaiterCalled = true
      return true
    },
  })
  commitReject.registerBarrier('cancelled-selection', {
    mode: 'settle',
    isPending: ref(false),
    wait: () => Promise.reject(new Error('切章意图已撤销')),
  })
  assert.equal(await commitReject.waitForCommits(), false)
  assert.equal(secondWaiterCalled, true,
    '一个 barrier 拒绝不能跳过其他非取消型保存等待')

  const declinedRevoke = useWriterGenerationArbiter<Owner>({
    checkApiReady: () => true,
    notifyBlocked: () => undefined,
  })
  let waitedDespiteRevokeFailure = false
  declinedRevoke.registerScope('outline', {
    reset: () => undefined,
    revokeBeforeWait: () => false,
  })
  declinedRevoke.registerBarrier('save', {
    isPending: ref(false),
    wait: () => {
      waitedDespiteRevokeFailure = true
      return true
    },
  })
  assert.equal(await declinedRevoke.waitForCommits(), true,
    '取消返回 false 可能只是请求已进入可等待的提交屏障')
  assert.equal(waitedDespiteRevokeFailure, true)

  const asyncRevoke = useWriterGenerationArbiter<Owner>({
    checkApiReady: () => true,
    notifyBlocked: () => undefined,
  })
  asyncRevoke.registerScope('outline', {
    reset: () => undefined,
    // Runtime defense for an untyped consumer; the exported TypeScript port
    // rejects async revokers at compile time.
    revokeBeforeWait: (async () => {
      throw new Error('异步撤销失败')
    }) as unknown as () => void,
  })
  asyncRevoke.registerBarrier('save', {
    isPending: ref(false),
    wait: () => true,
  })
  assert.equal(await asyncRevoke.waitForCommits(), false)
  await flushMicrotasks()

  const unsafeRevoke = useWriterGenerationArbiter<Owner>({
    checkApiReady: () => true,
    notifyBlocked: () => undefined,
  })
  unsafeRevoke.registerScope('outline', {
    reset: () => undefined,
    revokeBeforeWait: () => { throw new Error('无法撤销请求生命周期') },
  })
  unsafeRevoke.registerBarrier('save', {
    isPending: ref(false),
    wait: () => true,
  })
  assert.equal(await unsafeRevoke.waitForCommits(), false)

  const lateBarrier = useWriterGenerationArbiter<Owner>({
    checkApiReady: () => true,
    notifyBlocked: () => undefined,
  })
  const reenteredCommit = ref(false)
  lateBarrier.registerBarrier('reentered-save', {
    isPending: reenteredCommit,
    wait: async () => {
      await Promise.resolve()
      reenteredCommit.value = true
      reenteredCommit.value = false
      return true
    },
  })
  assert.equal(await lateBarrier.waitForCommits(), false,
    '捕获 wait 后重新进入的 barrier 不能被旧结果放行')

  const changedRegistry = useWriterGenerationArbiter<Owner>({
    checkApiReady: () => true,
    notifyBlocked: () => undefined,
  })
  const slowGate = deferred<boolean>()
  changedRegistry.registerBarrier('slow-save', {
    isPending: ref(false),
    wait: () => slowGate.promise,
  })
  const registryWait = changedRegistry.waitForCommits()
  changedRegistry.registerBarrier('new-save', {
    isPending: ref(false),
    wait: () => true,
  })
  slowGate.resolve(true)
  assert.equal(await registryWait, false,
    '等待快照后新增的 barrier 必须让本次导航保守失败')
}

async function testUnregisterAndDispose() {
  let resetCalls = 0
  const pending = ref(true)
  const arbiter = useWriterGenerationArbiter<Owner>({
    checkApiReady: () => true,
    notifyBlocked: () => undefined,
  })
  const unregisterScope = arbiter.registerScope('continue', {
    reset: () => { resetCalls += 1 },
  })
  const unregisterBarrier = arbiter.registerBarrier('save', {
    isPending: pending,
    wait: () => true,
  })
  assert.equal(arbiter.hasPendingBarrier(), true)
  unregisterScope()
  unregisterBarrier()
  assert.equal(arbiter.resetAll(), true)
  assert.equal(resetCalls, 0)
  assert.equal(arbiter.hasPendingBarrier(), false)

  arbiter.registerScope('continue', {
    reset: () => { resetCalls += 1 },
  })
  arbiter.registerBarrier('save', {
    isPending: pending,
    wait: () => false,
  })
  arbiter.dispose()
  pending.value = false
  assert.equal(arbiter.prepare('chapterContent'), true)
  assert.equal(await arbiter.waitForCommits(), true)
  assert.equal(arbiter.resetAll(), true)
  assert.equal(resetCalls, 0)
}

testDelayedRegistrationAndOwnerAwarePrepare()
testPrepareFailureAndBarrierReplacement()
testResetAllPreservesOwnersAndAggregatesFailures()
await testWaitRevokesFirstAndRequiresOnlyCommitSuccess()
await testWaitFailureModesAndLateBarrierRace()
await testUnregisterAndDispose()

const writerSource = readFileSync(new URL('../src/views/Writer.vue', import.meta.url), 'utf8')
assert.match(writerSource, /useWriterGenerationArbiter\(\{/)
assert.match(writerSource, /prepareIndependentWriterAI = owner => generationArbiter\.prepare\(owner\)/)
for (const owner of [
  'chapterContent',
  'continue',
  'optimize',
  'batchCharacter',
  'batchWorld',
  'characterForm',
  'worldForm',
  'chapterOutline',
  'chapterEditOutline',
  'promptPicker',
]) {
  assert.match(writerSource, new RegExp(`['"]${owner}['"]`), `Writer 必须注册 ${owner} scope`)
}
for (const barrier of [
  'materialMutation',
  'characterImport',
  'worldImport',
  'chapterOutlineCommit',
  'chapterContentCommit',
  'continueCommit',
  'optimizeCommit',
]) {
  assert.match(
    writerSource,
    new RegExp(`registerBarrier\\(['"]${barrier}['"]`),
    `Writer 必须注册 ${barrier} barrier`,
  )
}
assert.match(writerSource, /waitForWorkspaceCommits = generationArbiter\.waitForCommits/)
assert.match(writerSource, /stopWriterStreams = \(\) => generationArbiter\.resetAll\(\)/)
assert.doesNotMatch(writerSource, /const checkApiAndBalance/)

console.log('Writer generation arbiter smoke checks passed')
