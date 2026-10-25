import type { CampaignArtifact, CampaignManifest, CampaignReceipt, CampaignRequest, CampaignState } from '../../types/writerCampaign'
import { canonicalStringify } from './protocol'
import { campaignRequestReservation } from './budget'
import { buildPlanningCanon, PlanningParseCache } from './planningCanon'
import { compilePlanningContext } from './planningContext'
import { PlanningRefusalError } from './planningProtocol'
import { validatePlanningProfile } from './planningProfile'

type Canon = Awaited<ReturnType<typeof buildPlanningCanon>>
const ref = (artifact: CampaignArtifact) => ({ taskId: artifact.taskId, revision: artifact.revision, hash: artifact.hash })
const equal = (a: unknown, b: unknown) => canonicalStringify(a) === canonicalStringify(b)

/** Read/action-local typed source view. Never persisted or reused by another read.
 * The repository supplies already hash-verified artifacts from its private state.
 * Historical replay advances this view in event order, not from the final index.
 * Only active planning texts and the latest preceding body survive advancement.
 */
export class PlanningValidationView {
  private readonly parseCache = new PlanningParseCache()
  private readonly sources = new Map<string, CampaignArtifact>()
  private canonKey: string | null = null
  private canon: Canon | null = null
  readonly enabled: boolean
  constructor(private readonly manifest: CampaignManifest, private readonly check: () => void = () => {}) {
    this.enabled = validatePlanningProfile(manifest)
  }
  private async validatedCanon(artifacts: CampaignArtifact[]): Promise<Canon> {
    this.check()
    const key = canonicalStringify(artifacts.map(ref))
    if (this.canonKey === key && this.canon) return this.canon
    const canon = await buildPlanningCanon(this.manifest, artifacts, this.check, this.parseCache)
    this.check()
    this.canonKey = key; this.canon = canon
    return canon
  }
  /** Seed only from the repository's freshly verified private active snapshot. */
  seed(state: CampaignState, artifacts: Map<string, CampaignArtifact>): void {
    if (!this.enabled) return
    for (const task of state.tasks) if (task.status === 'committed' && task.artifact) {
      const artifact = artifacts.get(task.artifact.hash)
      if (!artifact || !equal(ref(artifact), task.artifact)) throw new PlanningRefusalError('source_identity_mismatch')
      this.sources.set(task.taskId, artifact)
    }
    this.pruneBodies()
  }
  private pruneBodies(): void {
    let last: CampaignArtifact | null = null
    for (const artifact of this.sources.values()) if (artifact.kind === 'chapter_body') {
      const ordinal = this.manifest.tasks.find(task => task.id === artifact.taskId)!.chapterOrdinal!
      if (!last || ordinal > this.manifest.tasks.find(task => task.id === last!.taskId)!.chapterOrdinal!) last = artifact
    }
    for (const [id, artifact] of this.sources) if (artifact.kind === 'chapter_body' && artifact !== last) this.sources.delete(id)
  }
  async reserve(previous: CampaignState, request: CampaignRequest): Promise<void> {
    if (!this.enabled) return
    this.check()
    const task = this.manifest.tasks.find(task => task.id === request.taskId)
    const state = previous.tasks.find(task => task.taskId === request.taskId)
    if (!task || !state || state.revision !== request.taskRevision || previous.candidateId !== request.candidateId) throw new PlanningRefusalError('source_identity_mismatch')
    const dependencies = task.dependsOn.map(id => {
      const state = previous.tasks.find(task => task.taskId === id)
      const source = this.sources.get(id)
      if (!state || state.status !== 'committed' || !state.artifact || !source || source.taskRevision !== state.revision || !equal(ref(source), state.artifact)) throw new PlanningRefusalError('missing_planning_source')
      return source
    })
    const canon = await this.validatedCanon(dependencies.filter(artifact => artifact.kind !== 'chapter_body'))
    const prepared = await compilePlanningContext({ manifest: this.manifest, candidateId: previous.candidateId, task, taskRevision: state.revision, dependencies }, undefined, this.check, canon)
    const reservation = campaignRequestReservation(prepared.bytes, prepared.utf16, this.manifest.tasks.length, prepared.responseBytes)
    if (request.preparedInput !== prepared.text || request.inputDigest !== prepared.digest || request.inputBytes !== prepared.bytes || request.inputUtf16 !== prepared.utf16 || !equal(request.reservation, reservation)) throw new PlanningRefusalError('source_identity_mismatch')
    this.check()
  }
  async advance(next: CampaignState, kind: CampaignReceipt['kind'], artifacts: CampaignArtifact[]): Promise<void> {
    if (!this.enabled) return
    this.check()
    if (kind === 'replace_candidate' && artifacts.some(artifact => artifact.kind === 'chapter_body')) throw new PlanningRefusalError('invalid_planning_payload')
    const additions = new Map(artifacts.map(artifact => [artifact.taskId, artifact]))
    for (const [id, source] of this.sources) {
      const task = next.tasks.find(task => task.taskId === id)
      if (task?.status !== 'committed' || !task.artifact || !equal(task.artifact, ref(source))) this.sources.delete(id)
    }
    for (const [id, artifact] of additions) {
      const task = next.tasks.find(task => task.taskId === id)
      if (task?.status !== 'committed' || !task.artifact || !equal(task.artifact, ref(artifact))) throw new PlanningRefusalError('source_identity_mismatch')
      this.sources.set(id, artifact)
    }
    this.pruneBodies()
    if (artifacts.some(artifact => artifact.kind !== 'chapter_body')) {
      await this.validatedCanon([...this.sources.values()].filter(artifact => artifact.kind !== 'chapter_body'))
    }
    this.check()
  }
}
