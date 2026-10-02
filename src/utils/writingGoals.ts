import type { GoalProgress, WritingGoal } from '@/types/management'
import type { WriterTimestamp } from '@/types/writer'

type JsonObject = Record<string, unknown>
const object = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
const timestamp = (value: unknown): WriterTimestamp =>
  typeof value === 'string' || typeof value === 'number' || value instanceof Date ? value : ''

export function toGoalDate(value: WriterTimestamp): Date {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number)
    return new Date(year, month - 1, day)
  }
  return new Date(value instanceof Date ? value.getTime() : value)
}

/** Normalize legacy records without inventing past activity or dropping extension fields. */
export function normalizeWritingGoals(value: unknown): WritingGoal[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) throw new Error('写作目标数据必须是数组')
  return value.map((item, index) => {
    if (!object(item) || !['number', 'string'].includes(typeof item.id) || typeof item.title !== 'string') {
      throw new Error(`第 ${index + 1} 个写作目标格式无效`)
    }
    const history = Array.isArray(item.progressHistory) ? item.progressHistory : []
    const progressHistory: GoalProgress[] = history.map((record, recordIndex) => {
      if (!object(record)) throw new Error('写作目标进度记录格式无效')
      return {
        ...record,
        id: typeof record.id === 'number' || typeof record.id === 'string' ? record.id : `legacy-${index}-${recordIndex}`,
        date: timestamp(record.date), increment: finite(record.increment, 0),
        note: typeof record.note === 'string' ? record.note : '',
      }
    })
    return {
      ...item, id: item.id as WritingGoal['id'], title: item.title,
      type: typeof item.type === 'string' ? item.type : 'daily',
      targetValue: Math.max(1, finite(item.targetValue, 1000)),
      currentValue: Math.max(0, finite(item.currentValue, 0)),
      status: typeof item.status === 'string' ? item.status : 'active',
      unit: typeof item.unit === 'string' ? item.unit : item.type === 'streak_days' ? '天' : '字',
      startDate: timestamp(item.startDate), endDate: timestamp(item.endDate), progressHistory,
    }
  })
}

/** A calendar ordinal avoids DST-length days. Date-only legacy values stay on their named day. */
function calendarDay(value: WriterTimestamp): number {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number)
    const date = new Date(year, month - 1, day)
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
      ? Date.UTC(year, month - 1, day) / 86_400_000 : NaN
  }
  const date = new Date(value instanceof Date ? value.getTime() : value)
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000
}

export function writingStreak(goals: readonly WritingGoal[], now = new Date()): number {
  const today = calendarDay(now)
  const days = new Set<number>()
  for (const goal of goals) {
    if (goal.type === 'streak_days') continue
    const totals = new Map<number, number>()
    for (const record of goal.progressHistory) {
      const day = calendarDay(record.date)
      if (Number.isFinite(day) && day <= today) totals.set(day, (totals.get(day) ?? 0) + record.increment)
    }
    for (const [day, total] of totals) if (total > 0) days.add(day)
  }
  // Yesterday's streak remains visible until there has been an opportunity to write today.
  let day = days.has(today) ? today : today - 1
  let count = 0
  while (days.has(day--)) count++
  return count
}

export function wordsWrittenToday(goals: readonly WritingGoal[], now = new Date()): number {
  const today = calendarDay(now)
  return Math.max(0, goals.filter(goal => goal.unit === '字').reduce((total, goal) =>
    total + goal.progressHistory.filter(record => calendarDay(record.date) === today)
      .reduce((sum, record) => sum + record.increment, 0), 0))
}

export function sortActiveGoals(goals: readonly WritingGoal[]): WritingGoal[] {
  return goals.filter(goal => goal.status === 'active').sort((a, b) =>
    (a.priority ?? Infinity) - (b.priority ?? Infinity)
    || (new Date(a.createdAt ?? 0).getTime() || 0) - (new Date(b.createdAt ?? 0).getTime() || 0))
}

export function applyGoalProgress(
  goal: WritingGoal, value: number, mode: 'total' | 'increment', note: string,
  now: Date, recordId: GoalProgress['id'],
): WritingGoal {
  if (!Number.isFinite(value) || value < 0) throw new Error('进度必须是非负有限数值')
  const currentValue = mode === 'total' ? value : goal.currentValue + value
  const increment = currentValue - goal.currentValue
  const cleanNote = note.trim()
  if (increment === 0 && !cleanNote) return goal
  const result: WritingGoal = {
    ...goal, currentValue, updatedAt: now.toISOString(),
    progressHistory: [{ id: recordId, date: now.toISOString(), increment, note: cleanNote }, ...goal.progressHistory],
  }
  if (currentValue >= result.targetValue) {
    result.status = 'completed'
    result.completedAt ??= now.toISOString()
  } else if (result.status === 'completed') {
    result.status = 'active'
    delete result.completedAt
  }
  return result
}
