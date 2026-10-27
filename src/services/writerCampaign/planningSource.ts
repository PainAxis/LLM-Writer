/** Pure planning inputs: no persistence version, fixture identity or authority. */
import type { CampaignArtifact, CampaignManifest } from '../../types/writerCampaign'

export type PlanningSourceManifest = Pick<CampaignManifest, 'campaignId' | 'hash' | 'language' | 'tasks'>
export type PlanningSourceArtifact = Pick<CampaignArtifact,
  'campaignId' | 'taskId' | 'kind' | 'revision' | 'hash' | 'dependencies' | 'text'>
