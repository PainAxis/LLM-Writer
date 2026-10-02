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

const unitState = createWritingGoalsState({
  read: () => [{ id: 'custom-words', title: 'Legacy custom words', type: 'custom', unit: '字',
    currentValue: 50, targetValue: 1000, status: 'active', startDate: now, endDate: now,
    progressHistory: [{ id: 1, date: now, increment: 50, note: 'Must remain words' }], extension: { retained: true } }],
  write: () => { if (fail) throw new Error('Injected unit failure') }, now: () => now, id: () => sequence++,
})
const details = { title: 'Chapter goal', type: 'chapters', targetValue: 10, startDate: now, endDate: now }
await unitState.saveGoal(details)
const chapterGoal = unitState.goals.value.find(goal => goal.type === 'chapters')!
assert.equal(chapterGoal.unit, '章')
await unitState.recordProgress(chapterGoal.id, 2, 'increment', 'Two chapters')
assert.equal(unitState.todayWords.value, 50, '章节与合法旧自定义字数目标并存，不能把章节加到今日字数')
await unitState.saveGoal({ ...details, title: 'Timed goal', type: 'custom', unit: '小时' })
const timedGoal = unitState.goals.value.find(goal => goal.unit === '小时')!
await unitState.recordProgress(timedGoal.id, 3, 'increment', 'Three hours')
assert.equal(unitState.todayWords.value, 50)
const prior = JSON.stringify(unitState.goals.value)
fail = true
await assert.rejects(unitState.saveGoal({ ...details, title: 'Convert legacy words' }, 'custom-words'), /Injected unit failure/)
assert.equal(JSON.stringify(unitState.goals.value), prior, '单位修改失败不得改变进度、历史或元数据')
fail = false
await unitState.saveGoal({ ...details, title: 'Convert legacy words' }, 'custom-words')
let converted = unitState.goals.value.find(goal => goal.id === 'custom-words')!
assert.equal(converted.unit, '章')
assert.equal(converted.currentValue, 0, '字数不能重新解释成章数')
assert.equal(converted.progressHistory[0].unit, '字')
assert.deepEqual((converted as WritingGoal & { extension: unknown }).extension, { retained: true })
assert.equal(unitState.todayWords.value, 50, '更改目标单位不重写历史字数')
await unitState.recordProgress('custom-words', 1, 'increment', 'A new chapter')
await unitState.saveGoal({ ...details, type: 'daily', title: 'Back to words' }, 'custom-words')
converted = unitState.goals.value.find(goal => goal.id === 'custom-words')!
assert.equal(converted.unit, '字')
assert.equal(converted.currentValue, 0)
assert.deepEqual(converted.progressHistory.map(record => record.unit), ['章', '字'])
await unitState.recordProgress('custom-words', 25, 'increment', 'New words')
assert.equal(unitState.todayWords.value, 75, '章数历史在目标改回字数后仍不计入今日字数')
await unitState.saveGoal({ ...details, type: 'weekly', title: 'Word period changed' }, 'custom-words')
assert.equal(unitState.goals.value.find(goal => goal.id === 'custom-words')!.currentValue, 25, '相同单位改期间保留当前进度')
const legacyUnits = normalizeWritingGoals([
  { id: 1, title: 'Ambiguous custom', type: 'custom', unit: '字' },
  { id: 2, title: 'Old chapters', type: 'custom', unit: '章节' },
  { id: 3, title: 'Old timed period', type: 'daily', unit: '小时' },
  { id: 4, title: 'Explicit chapters', type: 'chapters', unit: '字' },
])
assert.deepEqual(legacyUnits.map(goal => goal.unit), ['字', '章节', '小时', '章'], '旧custom单位不猜测，明确章节类型固定为章')

const streakState = createWritingGoalsState({
  read: () => [{ id: 'convert-streak', title: 'Yesterday writing', type: 'daily', unit: '字',
    currentValue: 100, targetValue: 1000, startDate: now, endDate: now,
    progressHistory: [{ id: 1, date: '2026-10-01', increment: 100, note: 'Real writing' }] }],
  write: () => {}, now: () => now, id: () => sequence++,
})
assert.equal(streakState.streak.value, 1)
await streakState.saveGoal({ ...details, type: 'streak_days', title: 'Converted streak goal' }, 'convert-streak')
assert.equal(streakState.goals.value[0].progressHistory[0].unit, '字')
assert.equal(streakState.streak.value, 1, '改为连续天数目标不能丢失原有真实写作历史')
await streakState.recordProgress('convert-streak', 1, 'increment', 'Manual day count')
assert.equal(streakState.streak.value, 1, '手动填写今天的天数不能伪造今天的写作活动')
await streakState.saveGoal({ ...details, type: 'daily', title: 'Converted back to writing' }, 'convert-streak')
assert.equal(streakState.streak.value, 1, '改回字数目标后历史天数仍不能变成写作活动')
await streakState.recordProgress('convert-streak', 50, 'increment', 'Real writing today')
assert.equal(streakState.streak.value, 2)
assert.equal(writingStreak(normalizeWritingGoals([{
  id: 'legacy-streak', title: 'Legacy manual days', type: 'streak_days',
  progressHistory: [{ id: 1, date: '2026-10-01', increment: 1 }],
}]), now), 0, '旧连续天数记录缺少历史单位时沿用原来的活动排除规则')
console.log('Writing streaks follow captured historical units across goal type changes and preserve legacy exclusions')
console.log('Goal units preserve legacy custom data, exclude chapters/time, and retain historical units across transactional edits')
console.log('Writing goals shared state, history, rollback, serialization, corrections and local-calendar streak smoke passed')
