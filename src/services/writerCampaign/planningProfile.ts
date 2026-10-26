/** Registered offline planning workloads. This policy is not a provider capability. */
import type { CampaignManifest, CampaignTaskSpec } from '../../types/writerCampaign'
import type { OfflineManifestOptions } from './engine'
import { canonicalStringify } from './protocol'
import { PlanningRefusalError } from './planningProtocol'
import { BODY_EVIDENCE_BODY_FIXTURES, bodyEvidenceFixtureBodyTarget } from './bodyEvidenceFixtureData'

export const PLANNING_PROFILE_PREFIX = 'planning-contract-'
export const PLANNING_THREE_CHAPTER_PROFILE = 'planning-contract-v1-three-chapter'
export const PLANNING_COMPACT_PROFILE = 'planning-contract-v1-compact-60'
export const BODY_EVIDENCE_THREE_CHAPTER_PROFILE = 'planning-contract-v1-body-evidence-three-chapter'
export const PLANNING_TEMPLATE_VERSION = 'campaign-planning-template-v1'
export type PlanningProfileName = 'three-chapter' | 'compact-60'
export type RegisteredPlanningProfileName = PlanningProfileName | 'body-evidence-three-chapter'

export const PLANNING_BRIEF = Object.freeze({
  zh: Object.freeze({ premise: '守塔人与潮汐记录员寻找铜铃，恢复灯塔信号。', scope: '离线固定结构夹具；规划意图不等于正文事实。读者可见仅指计划允许披露，不代表读者已知或事实已确立。角色认知和叙述者的时序分区只是作者规划，不授予读者披露许可。' }),
  en: Object.freeze({ premise: 'A lighthouse keeper and a tide recorder recover a brass bell and restore the signal.', scope: 'Fixed offline structural fixture; planning intent is not established prose truth. Reader-visible means disclosure-permitted in the plan, not observed reader knowledge or established truth. Epistemic and narrator time buckets are author-planning schedules, not reader disclosure permission.' }),
})
export const PLANNING_STAGE_INSTRUCTIONS = Object.freeze({
  zh: Object.freeze({
    outline: '仅返回规范 campaign-plan-v1 大纲对象；所有声明是规划意图。',
    character_bible: '仅返回规范 campaign-plan-v1 人设对象；世界事实不会自动成为角色知识。',
    detailed_outline: '仅返回规范 campaign-plan-v1 细纲对象；显式保留所有前提与章末状态转移。',
    chapter_outline: '仅返回规范 campaign-plan-v1 章纲对象；使用完整全局规划及本章所需记录。',
    chapter_body: '仅返回短篇离线正文夹具；不得把规划声明当作已验证的正文事实。',
  }),
  en: Object.freeze({
    outline: 'Return only the canonical campaign-plan-v1 outline object; every declaration is planning intent.',
    character_bible: 'Return only the canonical campaign-plan-v1 character bible; world facts do not automatically become character knowledge.',
    detailed_outline: 'Return only the canonical campaign-plan-v1 detailed outline; preserve all declared premises and end-of-chapter state transitions.',
    chapter_outline: 'Return only the canonical campaign-plan-v1 chapter outline using complete global planning and required chapter records.',
    chapter_body: 'Return only a short offline body fixture; do not treat planned declarations as verified prose facts.',
  }),
})

/** Unknown versions in the reserved namespace must never become opaque legacy text. */
export function isPlanningProfile(value: CampaignManifest | string): boolean {
  const version = typeof value === 'string' ? value : value.fixtureVersion
  if (version === PLANNING_THREE_CHAPTER_PROFILE || version === PLANNING_COMPACT_PROFILE || version === BODY_EVIDENCE_THREE_CHAPTER_PROFILE) return true
  if (version.startsWith(PLANNING_PROFILE_PREFIX)) throw new PlanningRefusalError('unsupported_profile')
  return false
}
export function planningChapterCount(manifest: CampaignManifest): 3 | 60 {
  if (!isPlanningProfile(manifest)) throw new PlanningRefusalError('unsupported_profile')
  return manifest.fixtureVersion === PLANNING_COMPACT_PROFILE ? 60 : 3
}
export function planningTasks(chapterCount: 3 | 60): CampaignTaskSpec[] {
  if (chapterCount !== 3 && chapterCount !== 60) throw new PlanningRefusalError('invalid_planning_graph')
  const global: CampaignTaskSpec[] = [
    { id: 'outline', kind: 'outline', chapterOrdinal: null, dependsOn: [] },
    { id: 'characters', kind: 'character_bible', chapterOrdinal: null, dependsOn: ['outline'] },
    { id: 'details', kind: 'detailed_outline', chapterOrdinal: null, dependsOn: ['outline', 'characters'] },
  ]
  const globalIds = global.map(task => task.id)
  const outlines: CampaignTaskSpec[] = Array.from({ length: chapterCount }, (_, index) => ({ id: `o-${index + 1}`, kind: 'chapter_outline', chapterOrdinal: index + 1, dependsOn: [...globalIds] }))
  const planningIds = [...globalIds, ...outlines.map(task => task.id)]
  const bodies: CampaignTaskSpec[] = Array.from({ length: chapterCount }, (_, index) => ({ id: `b-${index + 1}`, kind: 'chapter_body', chapterOrdinal: index + 1, dependsOn: index === 0 ? [...planningIds] : [...planningIds, `b-${index}`] }))
  return [...global, ...outlines, ...bodies]
}
export function validatePlanningProfile(manifest: CampaignManifest): boolean {
  if (!isPlanningProfile(manifest)) return false
  if (manifest.mode !== 'offline_fixture' || manifest.adapterId !== 'offline-fixture-v1'
    || manifest.maxProviderRetries !== 0 || manifest.maxRepairRounds !== 0
    || manifest.bodyTarget.characters !== (manifest.fixtureVersion === BODY_EVIDENCE_THREE_CHAPTER_PROFILE
      ? bodyEvidenceFixtureBodyTarget(manifest.language) : planningFixtureBodyTarget(manifest.language, planningChapterCount(manifest)))
    || canonicalStringify(manifest.tasks) !== canonicalStringify(planningTasks(planningChapterCount(manifest)))) {
    throw new PlanningRefusalError('invalid_planning_graph')
  }
  return true
}

/** Short plain-text bodies are test material, not an autonomous writing result. */
export const PLANNING_BODY_FIXTURES = Object.freeze({
  zh: Object.freeze([
    '林岚查看铃座上的刻痕。阿澈把潮汐记号抄进记录，远处一艘船驶入雾中。林岚尚不明白记号的意义。',
    '阿澈逐行解释潮汐记录。林岚在章末读懂了退潮规律，决定等石槽露出后再行动。',
    '退潮后，林岚依据刻痕与潮汐记录找到石槽里的铜铃。信号重新响起。远船的去向仍未揭晓。',
  ]),
  en: Object.freeze([
    'Mara examined the mark on the bell seat. Eli copied the tide notation as a distant ship entered the fog. Mara did not yet understand the notation.',
    'Eli explained the tide record line by line. At the chapter end, Mara understood the low-tide pattern and decided to wait until the stone channel emerged.',
    'At low tide, Mara used the mark and the tide record to recover the brass bell from the channel. The signal sounded again. The distant ship remained unexplained.',
  ]),
})
export const PLANNING_COMPACT_BODY = Object.freeze({ zh: '灯塔日志记录了当日的信号。', en: 'The lighthouse log recorded the signal that day.' })
export function planningBodyFixture(manifest: CampaignManifest, ordinal: number): string {
  const count = planningChapterCount(manifest)
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > count) throw new PlanningRefusalError('invalid_planning_graph')
  return manifest.fixtureVersion === BODY_EVIDENCE_THREE_CHAPTER_PROFILE ? BODY_EVIDENCE_BODY_FIXTURES[manifest.language][ordinal - 1]!
    : count === 60 ? PLANNING_COMPACT_BODY[manifest.language] : PLANNING_BODY_FIXTURES[manifest.language][ordinal - 1]!
}
export interface PlanningManifestOptions {
  campaignId: string
  language: 'zh' | 'en'
  identity: Pick<CampaignManifest, 'runtimeIdentity' | 'source'>
  now?: number
  expiresAt?: number
  profile?: RegisteredPlanningProfileName
}
export function planningFixtureBodyTarget(language: 'zh' | 'en', count: 3 | 60): number {
  const bodies = count === 60 ? Array<string>(60).fill(PLANNING_COMPACT_BODY[language]) : PLANNING_BODY_FIXTURES[language]
  return bodies.reduce((sum, text) => sum + [...text].length, 0)
}
/** The engine's existing constructor remains the sole default-budget implementation. */
export function planningManifestOptions(options: PlanningManifestOptions): OfflineManifestOptions {
  if (options.profile !== undefined && options.profile !== 'three-chapter' && options.profile !== 'compact-60' && options.profile !== 'body-evidence-three-chapter') throw new PlanningRefusalError('unsupported_profile')
  const count = options.profile === 'compact-60' ? 60 : 3
  return { campaignId: options.campaignId, language: options.language, identity: options.identity,
    ...(options.now === undefined ? {} : { now: options.now }), ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
    fixtureVersion: options.profile === 'body-evidence-three-chapter' ? BODY_EVIDENCE_THREE_CHAPTER_PROFILE : count === 3 ? PLANNING_THREE_CHAPTER_PROFILE : PLANNING_COMPACT_PROFILE,
    tasks: planningTasks(count), bodyTarget: options.profile === 'body-evidence-three-chapter'
      ? bodyEvidenceFixtureBodyTarget(options.language) : planningFixtureBodyTarget(options.language, count) }
}
