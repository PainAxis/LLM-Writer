/** Read-only project tools shared by the assistant and future writing runtimes. */
export type WritingToolId =
  | 'writing_get_project'
  | 'writing_list_chapters'
  | 'writing_read_chapter'
  | 'writing_search'
  | 'writing_list_materials'
  | 'writing_read_material'

export type WritingMaterialKind = 'characters' | 'worldSettings' | 'events' | 'corpus'
export type WritingSourceKind = 'chapter' | WritingMaterialKind

export interface WritingToolDescriptor {
  id: WritingToolId
  label: string
  description: string
  readOnly: true
}

export interface WritingProjectSummary {
  id: number
  title: string
  chapterCount: number
  materialCount: number
}

export interface WritingToolOptions {
  /** Only these tools are exposed; an empty allowlist exposes no tools. */
  enabledToolIds?: readonly WritingToolId[]
}

export interface WritingSourceReference {
  /** Stable within the selected project; never a URL or another project lookup. */
  reference: string
  projectId: number
  kind: WritingSourceKind
  id: number
  title: string
  /** Stored revision timestamp, when present. Not an inferred fact revision. */
  updatedAt?: string
}
