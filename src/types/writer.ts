/**
 * Writer page domain types.
 *
 * Project data is persisted as JSON and has evolved over time, so timestamps
 * and non-essential fields intentionally accept the shapes found in existing
 * records. The index signatures let components adopt these types gradually
 * without discarding extension data stored by older releases.
 */

export type WriterTimestamp = Date | string | number

type OpenString = string & Record<never, never>

export type WriterNovelStatus = 'writing' | 'completed' | 'paused' | OpenString
export type WriterChapterStatus = 'outline' | 'draft' | 'completed' | 'published' | OpenString
export type WriterCharacterRole = 'protagonist' | 'supporting' | 'antagonist' | 'minor' | OpenString
export type WriterCharacterGender = 'male' | 'female' | 'other' | OpenString
export type WriterWorldSettingCategory =
  | 'setting'
  | 'magic'
  | 'politics'
  | 'geography'
  | 'history'
  | OpenString
export type WriterCorpusType =
  | 'description'
  | 'dialogue'
  | 'emotion'
  | 'action'
  | 'psychology'
  | OpenString
export type WriterEventImportance = 'low' | 'normal' | 'high' | 'critical' | OpenString
export type WriterNarrativeStyle = 'first-person' | 'third-person' | 'omniscient' | OpenString
export type WriterChapterTemplate = 'general' | 'battle' | 'emotion' | 'turning' | OpenString
export type WriterOptimizeMode = 'selection' | 'full'

export interface WriterChapter {
  id: number
  title: string
  description?: string
  content?: string
  wordCount?: number
  status?: WriterChapterStatus
  createdAt?: WriterTimestamp
  updatedAt?: WriterTimestamp
  /** Fields used by the older novel-store chapter representation. */
  generatedText?: string
  isCompleted?: boolean
  [key: string]: unknown
}

/**
 * Writer characters deliberately do not extend the store Character type.
 * Writer persists role/profile fields while the older store model uses
 * description/traits; both optional legacy fields remain readable here.
 */
export interface WriterCharacter {
  id: number
  name: string
  role?: WriterCharacterRole
  gender?: WriterCharacterGender
  age?: number | string
  appearance?: string
  personality?: string
  background?: string
  tags?: string[]
  avatar?: string
  description?: string
  traits?: string[]
  createdAt?: WriterTimestamp
  updatedAt?: WriterTimestamp
  generated?: boolean
  selected?: boolean
  [key: string]: unknown
}

export interface WriterWorldSetting {
  id: number
  title: string
  description?: string
  /** Category used by the edit form and persisted Writer records. */
  category?: WriterWorldSettingCategory
  /** Type emitted by the current AI world-setting parser. */
  type?: string
  details?: string
  createdAt?: WriterTimestamp
  updatedAt?: WriterTimestamp
  generated?: boolean
  selected?: boolean
  [key: string]: unknown
}

export interface WriterCorpusItem {
  id: number
  /** Older corpus records may contain only content and a timestamp. */
  title?: string
  content: string
  type?: WriterCorpusType
  category?: string
  tags?: string[]
  createdAt?: WriterTimestamp
  updatedAt?: WriterTimestamp
  [key: string]: unknown
}

export interface WriterEvent {
  id: number
  title: string
  description?: string
  /** New records store a one-based chapter number; legacy records may store a title. */
  chapter?: string | number
  /** Legacy data may contain character names in addition to numeric ids. */
  characterIds?: Array<number | string>
  time?: string
  importance?: WriterEventImportance
  createdAt?: WriterTimestamp
  updatedAt?: WriterTimestamp
  [key: string]: unknown
}

export interface WriterWritingRecord {
  id?: number
  date?: WriterTimestamp
  wordsWritten?: number
  timeSpent?: number
  note?: string
  [key: string]: unknown
}

export interface WriterNovel {
  id: number
  title?: string
  genre?: string
  description?: string
  cover?: string
  tags?: string[]
  status?: WriterNovelStatus
  chapterList?: WriterChapter[]
  characters?: WriterCharacter[]
  worldSettings?: WriterWorldSetting[]
  corpusData?: WriterCorpusItem[]
  events?: WriterEvent[]
  writingRecords?: WriterWritingRecord[]
  chapters?: number
  wordCount?: number
  totalWords?: number
  avgWordsPerChapter?: number
  writingDays?: number
  genrePrompt?: string
  createdAt?: WriterTimestamp
  updatedAt?: WriterTimestamp
  [key: string]: unknown
}

/** Prompt records from the shared prompt library, including older user entries. */
export interface PromptTemplate {
  id: number
  title: string
  category: string
  content: string
  description?: string
  tags?: string[]
  /** User-created prompts historically omitted this flag. */
  isDefault?: boolean
  [key: string]: unknown
}

export type WriterPromptVariables = Record<string, string>

export interface WriterSelectedMaterials {
  characters: WriterCharacter[]
  worldSettings: WriterWorldSetting[]
  corpus: WriterCorpusItem[]
  events: WriterEvent[]
}

export interface WriterChapterForm {
  title: string
  description: string
  status: WriterChapterStatus
}

export interface WriterCharacterForm {
  id: number | null
  name: string
  role: WriterCharacterRole
  gender: WriterCharacterGender
  age: number
  appearance: string
  personality: string
  background: string
  tags: string[]
  avatar: string
  createdAt?: WriterTimestamp
}

export interface WriterWorldSettingForm {
  id: number | null
  title: string
  description: string
  category: WriterWorldSettingCategory
  details: string
  createdAt?: WriterTimestamp
}

export interface WriterCorpusForm {
  id: number | null
  title: string
  type: WriterCorpusType
  category: string
  content: string
  tags: string[]
  createdAt?: WriterTimestamp
}

export interface WriterEventForm {
  id: number | null
  title: string
  description: string
  chapter: string
  characterIds: Array<number | string>
  time: string
  importance: WriterEventImportance
  createdAt?: WriterTimestamp
}

export interface WriterChapterGenerationConfig {
  wordCount: number
  style: WriterNarrativeStyle
  focus: string
}

export interface WriterBatchCharacterGenerationConfig {
  count: number
  includeMainCharacters: boolean
  includeSupportingCharacters: boolean
  includeMinorCharacters: boolean
  customPrompt: string
  autoAssignRoles: boolean
}

export interface WriterWorldGenerationConfig {
  count: number
  includeGeography: boolean
  includeCulture: boolean
  includeHistory: boolean
  includeMagic: boolean
  includeTechnology: boolean
  includePolitics: boolean
  includeReligion: boolean
  includeEconomy: boolean
  includeRaces: boolean
  includeLanguage: boolean
  customPrompt: string
}

export interface WriterSingleChapterGenerationForm {
  title: string
  plotRequirement: string
  template: WriterChapterTemplate
}

export interface WriterBatchChapterGenerationForm {
  count: number
  plotRequirement: string
  template: WriterChapterTemplate
}

export interface WriterContentGenerationForm {
  wordCount: number
  style: WriterNarrativeStyle
  focus: string
}

export interface WriterOptimizeForm {
  originalContent: string
  optimizedContent: string
  customPrompt: string
  selectedPrompt: PromptTemplate | null
  mode: WriterOptimizeMode
  isOptimizing: boolean
}

export interface WriterContinueForm {
  direction: string
  wordCount: number
  isStreaming: boolean
}
