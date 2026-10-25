/** Closed-schema equality oracle. Every normal comparison follows full state validation. */
import assert from 'node:assert/strict'
import type { CampaignArtifactRef, CampaignRequestRef, CampaignState, CampaignTaskState } from '../src/types/writerCampaign'
import { canonicalStringify, emptyCampaignBudget, validateCampaignState } from '../src/services/writerCampaign/protocol'
import { emptyCampaignStorage } from '../src/services/writerCampaign/storageAccounting'
import { campaignArtifactRefEqual, campaignRequestRefEqual, campaignTaskEqual } from '../src/services/writerCampaign/store'

const HASH = 'a'.repeat(64), OTHER_HASH = 'b'.repeat(64)
const MAX_ID = `A${':'.repeat(127)}`
const TASK_FIELDS = ['taskId', 'revision', 'status', 'artifact', 'priorArtifact', 'request'].sort()
const ARTIFACT_REF_FIELDS = ['taskId', 'revision', 'hash'].sort()
const REQUEST_REF_FIELDS = ['id', 'revision', 'hash'].sort()
const ar = (): CampaignArtifactRef => ({ taskId: 'task', revision: 0, hash: HASH })
const rr = (): CampaignRequestRef => ({ id: 'request', revision: 0, hash: HASH })
const task = (): CampaignTaskState => ({ taskId: 'task', revision: 0, status: 'pending', artifact: null, priorArtifact: null, request: null })
let comparisons = 0, refusals = 0
function state(t: CampaignTaskState): CampaignState {
  return { status: 'running', reason: null, executionEpoch: 0, candidateId: 'candidate', tasks: [t], budget: emptyCampaignBudget(), storage: emptyCampaignStorage(524_288), lastWallTime: 1 }
}
function check(a: CampaignTaskState, b: CampaignTaskState): void {
  validateCampaignState(state(a)); validateCampaignState(state(b))
  assert.equal(campaignTaskEqual(a, b), canonicalStringify(a) === canonicalStringify(b))
  comparisons++
}
function reversed<T extends object>(value: T): T { return Object.fromEntries(Object.entries(value).reverse()) as T }
function main() {
  assert.deepEqual(Object.keys(task()).sort(), TASK_FIELDS)
  assert.deepEqual(Object.keys(ar()).sort(), ARTIFACT_REF_FIELDS)
  assert.deepEqual(Object.keys(rr()).sort(), REQUEST_REF_FIELDS)
  const variants: CampaignTaskState[] = []
  const statuses: CampaignTaskState['status'][] = ['pending', 'reserved', 'dispatch_intent', 'response_retained', 'committed', 'known_failed', 'outcome_unknown', 'invalidated']
  for (const status of statuses) for (const revision of [0, 2048]) for (const prior of [null, ar()]) {
    const t: CampaignTaskState = { ...task(), status, revision, priorArtifact: prior, artifact: status === 'committed' ? ar() : null,
      request: ['pending', 'invalidated', 'committed'].includes(status) ? null : rr() }
    variants.push(t)
    check(t, structuredClone(t))
    check(t, reversed({ ...t, artifact: t.artifact ? reversed(t.artifact) : null, priorArtifact: t.priorArtifact ? reversed(t.priorArtifact) : null, request: t.request ? reversed(t.request) : null }))
  }
  for (const a of variants) for (const b of variants) check(a, b)
  const base = { ...task(), status: 'reserved' as const, request: rr(), priorArtifact: ar() }
  const mutations: CampaignTaskState[] = [
    { ...base, taskId: MAX_ID }, { ...base, revision: 2048 }, { ...base, status: 'known_failed' },
    { ...base, priorArtifact: null }, { ...base, priorArtifact: { ...ar(), taskId: MAX_ID } },
    { ...base, priorArtifact: { ...ar(), revision: 2048 } }, { ...base, priorArtifact: { ...ar(), hash: OTHER_HASH } },
    { ...base, request: { ...rr(), id: MAX_ID } }, { ...base, request: { ...rr(), revision: 2048 } }, { ...base, request: { ...rr(), hash: OTHER_HASH } },
  ]
  for (const m of mutations) { check(base, m); assert.equal(campaignTaskEqual(base, m), false) }
  const committed = { ...base, status: 'committed' as const, artifact: ar() }
  for (const artifact of [{ ...ar(), taskId: MAX_ID }, { ...ar(), revision: 2048 }, { ...ar(), hash: OTHER_HASH }]) check(committed, { ...committed, artifact })
  check(task(), { ...task(), request: rr() })
  check(task(), { ...task(), priorArtifact: ar() })
  check({ ...task(), revision: -0 }, { ...task(), revision: 0 })
  for (const revision of [1, 9, 10, 99, 100, 999, 1000, 2047, 2048]) check({ ...base, revision }, base)
  const artifactRefs: Array<CampaignArtifactRef | null> = [null, ar(), reversed(ar()), { ...ar(), taskId: MAX_ID }, { ...ar(), revision: 2048 }, { ...ar(), hash: OTHER_HASH }]
  for (const a of artifactRefs) for (const b of artifactRefs) {
    validateCampaignState(state({ ...task(), priorArtifact: a })); validateCampaignState(state({ ...task(), priorArtifact: b }))
    assert.equal(campaignArtifactRefEqual(a, b), canonicalStringify(a) === canonicalStringify(b)); comparisons++
  }
  const requestRefs: Array<CampaignRequestRef | null> = [null, rr(), reversed(rr()), { ...rr(), id: MAX_ID }, { ...rr(), revision: 2048 }, { ...rr(), hash: OTHER_HASH }]
  for (const a of requestRefs) for (const b of requestRefs) {
    validateCampaignState(state({ ...task(), request: a })); validateCampaignState(state({ ...task(), request: b }))
    assert.equal(campaignRequestRefEqual(a, b), canonicalStringify(a) === canonicalStringify(b)); comparisons++
  }
  // Unknown/missing fields must not quietly become equivalent, even if a future
  // caller forgets the required full validator. Both paths refuse closed-shape drift.
  for (const key of TASK_FIELDS) {
    const missing = { ...base } as unknown as Record<string, unknown>; delete missing[key]
    assert.throws(() => validateCampaignState(state(missing as unknown as CampaignTaskState)))
    assert.throws(() => campaignTaskEqual(missing as unknown as CampaignTaskState, missing as unknown as CampaignTaskState)); refusals += 2
  }
  const unknown = { ...base, extra: 1 }
  assert.throws(() => validateCampaignState(state(unknown)))
  assert.throws(() => campaignTaskEqual(unknown, unknown)); refusals += 2
  for (const [value, fields, compare] of [[ar(), ARTIFACT_REF_FIELDS, campaignArtifactRefEqual], [rr(), REQUEST_REF_FIELDS, campaignRequestRefEqual]] as const) {
    for (const key of fields) {
      const missing = { ...value } as Record<string, unknown>; delete missing[key]
      assert.throws(() => (compare as (a: unknown, b: unknown) => boolean)(missing, missing)); refusals++
    }
    const extra = { ...value, extra: true }
    assert.throws(() => (compare as (a: unknown, b: unknown) => boolean)(extra, extra)); refusals++
  }
  for (const revision of [-1, 2049, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
    assert.throws(() => validateCampaignState(state({ ...base, revision }))); refusals++
  }
  console.log(JSON.stringify({ suite: 'writer-campaign-comparisons', status: 'pass', comparisons, refusals, taskFields: 6, artifactRefFields: 3, requestRefFields: 3, liveCalls: 0 }))
}
try { main() } catch { console.error(JSON.stringify({ suite: 'writer-campaign-comparisons', status: 'fail', comparisons, refusals, category: 'comparison_check_failed', liveCalls: 0 })); process.exitCode = 1 }
