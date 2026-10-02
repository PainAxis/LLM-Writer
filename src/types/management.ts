import type { WriterChapter, WriterNovel, WriterTimestamp } from './writer'

export interface ManagedChapter extends WriterChapter {
  summary?: string
  tags?: string[]
}
export interface ManagedNovel extends WriterNovel {
  chapterList?: ManagedChapter[]
}
export interface GenreDefinition {
  code: string
  name: string
  prompt: string
  tags: string[]
  examples?: string
  isDefault?: boolean
  usageCount?: number
  createdAt?: WriterTimestamp
  updatedAt?: WriterTimestamp
}
export interface GoalProgress {
  id: number | string
  date: WriterTimestamp
  increment: number
  note: string
  /** Captured unit keeps historical activity meaningful when a goal changes units. */
  unit?: string
}
export interface WritingGoal {
  id: number | string
  title: string
  type: string
  targetValue: number
  currentValue: number
  status: string
  startDate: WriterTimestamp
  endDate: WriterTimestamp
  description?: string
  unit?: string
  reminder?: boolean
  reminderTime?: string | Date | null
  priority?: number
  createdAt?: WriterTimestamp
  updatedAt?: WriterTimestamp
  completedAt?: WriterTimestamp
  progressHistory: GoalProgress[]
}
export interface GoalForm {
  title: string
  type: string
  unit: string
  targetValue: number
  description: string
  dateRange: Date[] | null
  reminder: boolean
  reminderTime: string | Date | null
}
