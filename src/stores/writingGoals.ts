import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'
import type { WritingGoal } from '@/types/management'
import { storageGet, storageSet, StorageKeys, writeSerializedWithRetry } from '@/utils/storage'
import { withStorageCommit } from '@/services/storageCoordination'
import { generateUniqueId } from '@/utils/id'
import { applyGoalProgress, normalizeWritingGoals, resolveGoalUnit, sortActiveGoals, toGoalDate, wordsWrittenToday, writingStreak } from '@/utils/writingGoals'

type GoalDetails = Pick<WritingGoal, 'title' | 'type' | 'targetValue' | 'startDate' | 'endDate'>
  & Partial<Pick<WritingGoal, 'description' | 'unit' | 'reminder' | 'reminderTime'>>
interface GoalStorage {
  read(): unknown
  write(goals: WritingGoal[]): void | Promise<void>
  /** Re-read and transform the committed value while holding the cross-tab gate. */
  update?(change: (current: WritingGoal[]) => WritingGoal[]): Promise<WritingGoal[]>
  now?(): Date
  id?(): number
}

/** Both goal UIs share this state and commit only after storage accepts the complete snapshot. */
export function createWritingGoalsState(storage: GoalStorage) {
  const goals = ref(normalizeWritingGoals(storage.read()))
  const clock = ref((storage.now ?? (() => new Date()))())
  const pending = ref(0)
  let queue = Promise.resolve()
  const now = () => (storage.now ?? (() => new Date()))()
  const id = () => (storage.id ?? generateUniqueId)()
  const activeGoals = computed(() => sortActiveGoals(goals.value))
  const streak = computed(() => writingStreak(goals.value, clock.value))
  const todayWords = computed(() => wordsWrittenToday(goals.value, clock.value))

  function mutate(change: (current: WritingGoal[]) => WritingGoal[]): Promise<void> {
    pending.value++
    const result = queue.then(async () => {
      let next: WritingGoal[]
      if (storage.update) next = await storage.update(change)
      else {
        next = change(goals.value)
        await storage.write(next)
      }
      goals.value = next
      clock.value = now()
    }).finally(() => { pending.value-- })
    queue = result.catch(() => undefined)
    return result
  }
  function requireGoal(current: WritingGoal[], goalId: WritingGoal['id']): WritingGoal {
    const goal = current.find(item => item.id === goalId)
    if (!goal) throw new Error('写作目标已删除，请重新打开')
    return goal
  }
  async function saveGoal(details: GoalDetails, goalId?: WritingGoal['id']): Promise<void> {
    if (!details.title.trim() || !Number.isFinite(details.targetValue) || details.targetValue <= 0) {
      throw new Error('请填写目标标题和有效目标数值')
    }
    const start = toGoalDate(details.startDate).getTime()
    const end = toGoalDate(details.endDate).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('请选择有效的目标时间范围')
    const draft = { ...details, title: details.title.trim() }
    await mutate(current => {
      const time = now().toISOString()
      if (goalId !== undefined) {
        const existing = requireGoal(current, goalId)
        const unit = resolveGoalUnit(draft.type, draft.unit ?? (existing.type === draft.type ? existing.unit : undefined))
        const previousUnit = resolveGoalUnit(existing.type, existing.unit)
        const updated = { ...existing, ...draft, unit, updatedAt: time }
        if (unit !== previousUnit) {
          updated.currentValue = 0
          updated.progressHistory = existing.progressHistory.map(record => ({ ...record, unit: record.unit ?? previousUnit }))
          if (updated.status === 'completed') updated.status = 'active'
          delete updated.completedAt
        }
        return current.map(goal => goal.id === goalId ? updated : goal)
      }
      return [...current, {
        ...draft, id: id(), unit: resolveGoalUnit(draft.type, draft.unit),
        currentValue: 0, status: 'active', progressHistory: [], createdAt: time, updatedAt: time,
        priority: Math.max(-1, ...current.map(goal => goal.priority ?? -1)) + 1,
      }]
    })
  }
  function recordProgress(goalId: WritingGoal['id'], value: number, mode: 'total' | 'increment', note: string) {
    return mutate(current => {
      const goal = requireGoal(current, goalId)
      const next = applyGoalProgress(goal, value, mode, note, now(), id())
      return current.map(item => item.id === goalId ? next : item)
    })
  }
  function pauseGoal(goalId: WritingGoal['id']) {
    return mutate(current => {
      requireGoal(current, goalId)
      return current.map(goal => goal.id === goalId ? { ...goal, status: 'paused', updatedAt: now().toISOString() } : goal)
    })
  }
  function deleteGoal(goalId: WritingGoal['id']) {
    return mutate(current => current.filter(goal => goal.id !== goalId))
  }
  function reorderGoals(ids: WritingGoal['id'][]) {
    return mutate(current => current.map(goal => {
      const priority = ids.indexOf(goal.id)
      return priority < 0 ? goal : { ...goal, priority }
    }))
  }
  async function reload() {
    await queue
    goals.value = normalizeWritingGoals(storage.read())
    clock.value = now()
  }
  const refreshClock = () => { clock.value = now() }
  return { goals, activeGoals, streak, todayWords, pending, saveGoal, recordProgress, pauseGoal, deleteGoal, reorderGoals, reload, refreshClock }
}

export const useWritingGoalsStore = defineStore('writingGoals', () => {
  const state = createWritingGoalsState({
    read: () => storageGet(StorageKeys.writingGoals, []),
    write: goals => storageSet(StorageKeys.writingGoals, goals),
    update: change => withStorageCommit(() => {
      const current = normalizeWritingGoals(storageGet(StorageKeys.writingGoals, []))
      const next = change(current)
      writeSerializedWithRetry(StorageKeys.writingGoals, JSON.stringify(next))
      return next
    }),
  })
  if (typeof window !== 'undefined') {
    const onStorage = (event: StorageEvent) => {
      if (event.key === StorageKeys.writingGoals || event.key === null) void state.reload().catch(console.error)
    }
    const onVisible = () => { if (!document.hidden) state.refreshClock() }
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(state.refreshClock, 60_000)
    onScopeDispose(() => {
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    })
  }
  return state
})
