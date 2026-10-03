/** Agent Skills packages supported by the browser writing host. */
export interface SkillPackageFile {
  /** Relative to the selected package, or prefixed by its selected folder. */
  path: string
  content: string
}

export type SkillFileKind = 'instructions' | 'reference' | 'asset' | 'script' | 'other'

export interface SkillFile extends SkillPackageFile {
  kind: SkillFileKind
}

export interface WritingSkill {
  id: string
  name: string
  description: string
  instructions: string
  /** All YAML frontmatter, including fields this host does not interpret. */
  metadata: Record<string, unknown>
  files: SkillFile[]
  source: 'builtin' | 'imported'
  packageName?: string
  warnings: string[]
}

export interface SkillReferenceSelection {
  skillId: string
  path: string
}

export interface SkillContextResult {
  text: string
  usedSkillIds: string[]
  omittedSkillIds: string[]
  truncated: boolean
}

export interface SkillReferenceRead {
  skillId: string
  path: string
  text: string
  offset: number
  nextOffset?: number
  truncated: boolean
}
