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

/** Assigned by the application, never accepted from model response fields. */
export interface FactCandidateProvenance {
  campaignId: string
  segmentId: string
  jobId: string
  candidateId: string
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
  provenance?: FactCandidateProvenance
  /** Protocol/source validation is not a claim of semantic correctness. */
  semanticValidation?: 'protocol-and-current-sources'
}

export type FactPlotLinkMode = 'setup_candidate' | 'possible_recovery'
export type FactPlotPremiseRole = 'setup' | 'recovery' | 'context'

export interface FactPlotPremise {
  role: FactPlotPremiseRole
  evidence: FactAnchor[]
}

/** Multi-premise hypotheses, not single-anchor MemoryClues or Writer evidence. */
export interface FactPlotLink {
  id: string
  projectId: string
  mode: FactPlotLinkMode
  title: string
  explanation: string
  origin: 'explicit' | 'inferred'
  createdBy: 'author' | 'model'
  authorConfirmed: boolean
  semanticValidation: 'protocol-and-current-sources'
  provenance: FactCandidateProvenance
  premises: FactPlotPremise[]
}

/** A separate annotation document; revision is empty only before its first save. */
export interface FactGraphDocument {
  version: 2
  projectId: string
  revision: string
  relations: FactRelation[]
  plotLinks: FactPlotLink[]
}

export interface VisibleFactAnchor extends FactAnchor {
  chapterTitle: string
  ordinal: number
}

export interface VisibleFactRelation extends Omit<FactRelation, 'evidence'> {
  evidence: VisibleFactAnchor[]
}

export interface VisibleFactPlotLink extends Omit<FactPlotLink, 'premises'> {
  premises: Array<{ role: FactPlotPremiseRole; evidence: VisibleFactAnchor[] }>
}

export interface FactPlotLinkSelection {
  plotLinks: VisibleFactPlotLink[]
  truncated: boolean
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
