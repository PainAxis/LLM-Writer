export interface ShortStoryOption {
  value: string
  label: string
  description?: string
  prompt?: string
}

export interface ShortStoryConfig {
  genres: ShortStoryOption[]
  plotTypes: ShortStoryOption[]
  emotions: ShortStoryOption[]
  timeFrames: ShortStoryOption[]
  writingStyles: ShortStoryOption[]
}

export interface ShortArticleDraft {
  title: string
  wordCount: number
  style: string
  prompt: string
  references: Array<{ title: string; content: string }>
}

export interface ShortStoryDraft {
  title: string
  protagonist: { name: string; gender: string; age: number }
  genre: string
  plotType: string
  emotion: string
  timeFrame: string
  location: string
  wordCount: number
  referenceText: string
}
