import type { MemoryProjectInput, MemoryIndexStats } from './memory'

export type FactEntityType = 'person' | 'event' | 'object' | 'place'

/** Display names are source occurrences, never an undisclosed canonical identity. */
export interface FactEntity {
  type: FactEntityType
  label: string
}

/** All offsets are UTF-16 code units in the exact chapter revision. */
export interface FactAnchor {
  chapterId: string
  sourceRevision: string
  start: number
  end: number
  quote: string
}

export interface FactRelation {
  id: string
  projectId: string
  source: FactEntity
  target: FactEntity
  predicate: string
  origin: 'explicit' | 'inferred'
  createdBy: 'author' | 'model'
  /** Confirmation never changes the original status or bypasses source validation. */
  authorConfirmed: boolean
  evidence: FactAnchor[]
}

/** A separate annotation document; revision is empty only before its first save. */
export interface FactGraphDocument {
  version: 1
  projectId: string
  revision: string
  relations: FactRelation[]
}

export interface VisibleFactAnchor extends FactAnchor {
  chapterTitle: string
  ordinal: number
}

export interface VisibleFactRelation extends Omit<FactRelation, 'evidence'> {
  evidence: VisibleFactAnchor[]
}

export interface FactGraphNode extends FactEntity {
  id: string
}

/** Only eligible, disclosed data may cross the visualization boundary. */
export interface FactGraphSelection {
  relations: VisibleFactRelation[]
  nodes: FactGraphNode[]
  truncated: boolean
}

/** Source and manifests must belong to the same completed index sync. */
export interface FactGraphSource {
  project: MemoryProjectInput
  stats: MemoryIndexStats
}
