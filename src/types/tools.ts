export type ToolType =
  | 'outline'
  | 'cheat'
  | 'opening'
  | 'title'
  | 'genre'
  | 'brainstorm'
  | 'synopsis'
  | 'worldview'
  | 'character'
  | 'conflict'
export type ToolId = string | number
export interface ToolField {
  key: string
  label: string
  type: 'input' | 'textarea' | 'select' | 'novel-select' | 'chapter-select' | 'prompt-select'
  placeholder: string
  required?: boolean
  category?: string
  options?: Array<{ label: string; value: string }>
}
export interface ToolDefinition {
  title: string
  icon: string
  cardTitle: string
  description: string
  hasNovelSelector?: boolean
  fields: ToolField[]
}
export interface ToolForm {
  selectedNovel?: ToolId
  selectedChapters?: ToolId[]
  count?: string | number
  [key: string]: string | number | ToolId[] | undefined
}
export interface ToolSourceNovel {
  id?: ToolId
  title?: string
  genre?: string
  description?: string
  tags?: string[]
  characters?: Array<{ name?: string; description?: string; personality?: string }>
  worldSettings?: Array<{ name?: string; title?: string; description?: string; content?: string }>
}
export interface ToolPromptSource {
  type: ToolType
  form: ToolForm
  selectedPrompt: { content: string } | null
  novels: Array<{ value: ToolId; label: string }>
  chapters: Array<{ value: ToolId; label: string; content: string; description: string }>
  originals: ToolSourceNovel[]
}
