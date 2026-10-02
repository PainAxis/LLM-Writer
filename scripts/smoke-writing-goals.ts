import assert from 'node:assert/strict'
import { createWritingGoalsState } from '../src/stores/writingGoals'
import { normalizeWritingGoals, toGoalDate, writingStreak, wordsWrittenToday } from '../src/utils/writingGoals'
import type { WritingGoal } from '../src/types/management'

process.env.TZ = 'America/Los_Angeles'
const now = new Date(2026, 9, 2, 12)
let sequence = 100
let disk: unknown = [{ id: 'legacy', title: 'Legacy goal', type: 'daily', targetValue: 1000,
  currentValue: 100, status: 'active', startDate: '2026-10-01', endDate: '2026-10-31',
  extension: { retained: true }, progressHistory: [{ id: 1, date: '2026-10-01', increment: 100, note: 'Yesterday' }] }]
let fail = false
const state = createWritingGoalsState({
  read: () => disk, now: () => now, id: () => sequence++,
  write: async goals => { if (fail) throw new Error('Injected write failure'); disk = JSON.parse(JSON.stringify(goals)) },
})
await state.recordProgress('legacy', 200, 'total', 'Home dialog note')
assert.equal(state.goals.value[0].progressHistory[0].increment, 100)
assert.equal(state.goals.value[0].progressHistory[0].note, 'Home dialog note')
await state.recordProgress('legacy', 50, 'increment', 'Goal page note')
assert.equal(state.goals.value[0].currentValue, 250)
assert.equal(state.goals.value[0].progressHistory.length, 3)
assert.equal(state.streak.value, 2)
assert.equal(state.todayWords.value, 150)
const original = JSON.stringify(state.goals.value)
fail = true
await assert.rejects(state.recordProgress('legacy', 500, 'total', 'Must not commit'), /Injected/)
await assert.rejects(state.saveGoal({ title: 'Unsaved edit', type: 'daily', targetValue: 1000, startDate: now, endDate: now }, 'legacy'), /Injected/)
assert.equal(JSON.stringify(state.goals.value), original)
assert.equal(state.pending.value, 0)
fail = false
await Promise.all([state.recordProgress('legacy', 25, 'increment', 'First'), state.recordProgress('legacy', 25, 'increment', 'Second')])
assert.equal(state.goals.value[0].currentValue, 300)
await state.saveGoal({ title: 'Edited', type: 'daily', targetValue: 1000, startDate: now, endDate: now }, 'legacy')
assert.deepEqual((state.goals.value[0] as WritingGoal & { extension: unknown }).extension, { retained: true })
assert.equal(state.goals.value[0].currentValue, 300)
assert.equal(state.goals.value[0].progressHistory.length, 5)
await state.recordProgress('legacy', 1000, 'total', 'Complete')
assert.equal(state.goals.value[0].status, 'completed')
assert.ok(state.goals.value[0].completedAt)
await state.recordProgress('legacy', 900, 'total', 'Correct total')
assert.equal(state.goals.value[0].progressHistory[0].increment, -100)
assert.equal(state.goals.value[0].status, 'active')
assert.equal(state.goals.value[0].completedAt, undefined)
const count = state.goals.value[0].progressHistory.length
await state.recordProgress('legacy', 900, 'total', '')
assert.equal(state.goals.value[0].progressHistory.length, count)
await state.recordProgress('legacy', 900, 'total', 'Note without new work')
assert.equal(state.goals.value[0].progressHistory[0].increment, 0)
await assert.rejects(state.recordProgress('legacy', NaN, 'total', ''), /进度/)
await assert.rejects(state.recordProgress('legacy', -1, 'increment', ''), /进度/)
await state.reload()
assert.equal(state.goals.value[0].progressHistory[0].note, 'Note without new work')
await state.deleteGoal('legacy')
await assert.rejects(state.recordProgress('legacy', 1, 'increment', 'Late dialog'), /已删除/)
assert.deepEqual(state.goals.value, [])

const fixture = (dates: Array<[string | number, number]>, unit = '字') => normalizeWritingGoals([{
  id: 1, title: 'Activity', unit, progressHistory: dates.map(([date, increment], id) => ({ id, date, increment })),
}])
assert.equal(writingStreak(fixture([['2026-09-30', 1], ['2026-10-01', 1]]), now), 2)
assert.equal(writingStreak(fixture([['2026-09-29', 1]]), now), 0)
assert.equal(writingStreak(fixture([['2026-10-01', 1], ['2026-10-02', 1], ['2026-10-02', -1]]), now), 1)
assert.equal(writingStreak(fixture([['invalid', 100], ['2026-10-03', 100], ['2026-10-02', 0]]), now), 0)
assert.equal(writingStreak(fixture([['2026-03-07', 1], ['2026-03-08', 1], ['2026-03-09', 1]]), new Date(2026, 2, 9, 12)), 3)
assert.equal(toGoalDate('2026-10-02').getDate(), 2)
assert.equal(wordsWrittenToday(fixture([[now.getTime(), 30]]), now), 30)
assert.equal(wordsWrittenToday(fixture([[now.getTime(), 30]], '小时'), now), 0)
assert.deepEqual(normalizeWritingGoals([{ id: 9, title: 'Without history', currentValue: 99 }])[0].progressHistory, [])
console.log('Writing goals shared state, history, rollback, serialization, corrections and local-calendar streak smoke passed')
