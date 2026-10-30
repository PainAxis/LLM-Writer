/** Deterministic raw-to-real-v4-artifact compilation. Never saves or calls a model. */
import type { CreativeCompileRefusal, CreativeCompileResult, CreativeJson, CreativeRequest, CreativeResponse, CreativeSourceView, PreparedCreativeInputV1 } from '../../types/creativePilot'
import { assertScalarText, canonicalCampaignText, canonicalStringify, hashCampaignValue, measureCampaignText, utf8Bytes } from './protocol'
import { buildPlanningCanon } from './planningCanon'
import { PLANNING_STAGE_LIMITS, PlanningRefusalError, planningChapterAddress } from './planningProtocol'
import { CreativePilotError, sealCreativeArtifactCandidate, validateCreativeRequest, validateCreativeResponse } from './creativePilotProtocol'
import { compileCreativeInput } from './creativePilotContext'
import { creativePlanOutputSchema } from './creativePilotSchema'
import { CreativeJsonError, parseCreativeJson } from './creativePilotJson'

class CompileFailure extends Error { constructor(readonly reason: CreativeCompileRefusal) { super(reason) } }
function refuse(reason: CreativeCompileRefusal): never { throw new CompileFailure(reason) }
const equal = (a: unknown, b: unknown) => canonicalStringify(a) === canonicalStringify(b)
type Schema = Record<string, CreativeJson>
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function schemaOf(value: CreativeJson | undefined): Schema { if (!record(value)) throw new CreativePilotError('integrity'); return value as Schema }
function dereference(schema: Schema, defs: Schema): Schema {
  if (typeof schema.$ref !== 'string') return schema
  if (!schema.$ref.startsWith('#/$defs/')) throw new CreativePilotError('integrity')
  return schemaOf(defs[schema.$ref.slice(8)])
}
function validateWire(value: unknown, input: Schema, defs: Schema, check: () => void): void {
  check(); const schema = dereference(input, defs)
  const alternatives = schema.oneOf ?? schema.anyOf
  if (Array.isArray(alternatives)) {
    let matches = 0
    for (const choice of alternatives) {
      try { validateWire(value, schemaOf(choice), defs, check); matches++ }
      catch (error) { if (!(error instanceof CompileFailure)) throw error }
    }
    if (!matches || (schema.oneOf && matches !== 1)) refuse('output_schema')
    return
  }
  if (Object.hasOwn(schema, 'const')) { if (value !== schema.const) refuse('output_schema'); return }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value as CreativeJson)) refuse('output_schema')
  switch (schema.type) {
    case 'null': if (value !== null) refuse('output_schema'); return
    case 'boolean': if (typeof value !== 'boolean') refuse('output_schema'); return
    case 'integer':
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < Number(schema.minimum) || value > Number(schema.maximum)) refuse('output_schema')
      return
    case 'string':
      if (typeof value !== 'string' || value.length < Number(schema.minLength ?? 0)
        || (schema['x-maxUtf16'] !== undefined && value.length > Number(schema['x-maxUtf16']))
        || (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value))) refuse('output_schema')
      return
    case 'array': {
      if (!Array.isArray(value) || value.length < Number(schema.minItems) || value.length > Number(schema.maxItems)) refuse('output_schema')
      for (const item of value) validateWire(item, schemaOf(schema.items), defs, check)
      if (schema.uniqueItems === true && new Set(value.map(item => canonicalStringify(item))).size !== value.length) refuse('output_schema')
      return
    }
    case 'object': {
      if (!record(value)) refuse('output_schema')
      const properties = schemaOf(schema.properties), keys = Object.keys(value)
      if (keys.length !== Object.keys(properties).length || keys.some(key => !Object.hasOwn(properties, key))) refuse('output_schema')
      for (const [key, child] of Object.entries(properties)) validateWire(value[key], schemaOf(child), defs, check)
      return
    }
    default: throw new CreativePilotError('integrity')
  }
}
function mapWire(value: unknown, input: Schema, defs: Schema, prepared: PreparedCreativeInputV1, view: CreativeSourceView, check: () => void): unknown {
  check(); const schema = dereference(input, defs)
  if (schema['x-chapterAddress'] === true) return planningChapterAddress(view.manifest, value as number)
  if (Array.isArray(schema['x-planningRef'])) {
    if (!record(value)) throw new CreativePilotError('integrity')
    if (value.source === 'self') return { source: 'self', artifact: null, recordKind: value.recordKind, recordId: value.recordId }
    const token = value.token as number, row = prepared.catalog[token - 1]
    if (!row || row.token !== token || !schema['x-planningRef'].includes(row.identity.recordKind)) refuse('invalid_reference')
    return { source: 'ancestor', artifact: { ...row.identity.artifact }, recordKind: row.identity.recordKind, recordId: row.identity.recordId }
  }
  const alternatives = schema.oneOf ?? schema.anyOf
  if (Array.isArray(alternatives)) {
    for (const alternative of alternatives) {
      const child = schemaOf(alternative)
      try { validateWire(value, child, defs, check) } catch (error) { if (error instanceof CompileFailure) continue; throw error }
      return mapWire(value, child, defs, prepared, view, check)
    }
    throw new CreativePilotError('integrity')
  }
  if (schema.type === 'array') return (value as unknown[]).map(item => mapWire(item, schemaOf(schema.items), defs, prepared, view, check))
  if (schema.type === 'object') {
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    for (const [key, child] of Object.entries(schemaOf(schema.properties))) result[key] = mapWire((value as Record<string, unknown>)[key], schemaOf(child), defs, prepared, view, check)
    return result
  }
  return value
}
function scalarTree(value: unknown, check: () => void): void {
  check()
  if (typeof value === 'string') { try { assertScalarText(value) } catch { refuse('invalid_scalar') } }
  else if (Array.isArray(value)) value.forEach(item => scalarTree(item, check))
  else if (record(value)) for (const [key, child] of Object.entries(value)) { try { assertScalarText(key) } catch { refuse('invalid_scalar') }; scalarTree(child, check) }
}
function planningFailure(error: PlanningRefusalError): CreativeCompileRefusal {
  switch (error.code) {
    case 'invalid_planning_reference': case 'missing_planning_source': return 'invalid_reference'
    case 'invalid_planning_schedule': case 'incomplete_plan': case 'invalid_planning_graph': return 'invalid_schedule'
    case 'planning_budget_exceeded': case 'canon_budget_exceeded': case 'context_budget_exceeded': return 'planning_capacity'
    case 'source_identity_mismatch': throw new CreativePilotError('source_changed')
    case 'planning_cancelled': throw new CreativePilotError('cancelled')
    default: return 'output_schema'
  }
}

export async function compileCreativeResponse(viewInput: CreativeSourceView, requestInput: CreativeRequest, responseInput: CreativeResponse, check: () => void = () => {}): Promise<CreativeCompileResult> {
  check()
  const view = structuredClone(viewInput), request = structuredClone(requestInput), response = structuredClone(responseInput)
  await validateCreativeRequest(request); check(); await validateCreativeResponse(response); check()
  if (request.campaignId !== view.manifest.campaignId || request.manifestHash !== view.manifest.hash
    || request.candidateHash !== view.candidate.hash || response.campaignId !== request.campaignId || response.requestHash !== request.hash) throw new CreativePilotError('integrity')
  const prepared = await compileCreativeInput(view, request.taskId, check)
  if (!equal(prepared, request.prepared) || !equal(request.dependencies, prepared.sourceRefs) || request.taskRevision !== prepared.identity.taskRevision) throw new CreativePilotError('source_changed')
  try {
    if (response.finishReason !== 'stop') refuse('finish_incomplete')
    if (response.reportedModel.status === 'absent') refuse('reported_model_absent')
    if (response.reportedModel.status === 'invalid') refuse('reported_model_invalid')
    if (response.reportedModel.status !== 'matched' || response.reportedModel.value !== request.adapter.effectiveModelId) refuse('reported_model_mismatch')
    if (response.contentEvidence.anomalies.includes('reasoning_present') || (response.usage.reasoningTokens ?? 0) > 0) refuse('reasoning_disallowed')
    if (response.usage.status === 'invalid' || (response.usage.outputTokens ?? 0) > 4096
      || (response.usage.reasoningTokens !== null && response.usage.outputTokens !== null && response.usage.reasoningTokens > response.usage.outputTokens)) refuse('usage_invalid')
    if (response.contentEvidence.stepCount !== 1 || response.contentEvidence.anomalies.length) refuse('content_evidence_invalid')
    const raw: unknown = JSON.parse(response.textJson)
    if (typeof raw !== 'string') throw new CreativePilotError('integrity')
    try { assertScalarText(raw) } catch { refuse('invalid_scalar') }
    if (!raw.length) refuse('empty_output')
    const stage = prepared.identity.stage, isBody = stage === 'chapter_body'
    const rawLimit = isBody ? 8192 : PLANNING_STAGE_LIMITS[stage].responseBytes
    if (utf8Bytes(raw) > rawLimit || (isBody && raw.length > 2048)) refuse('raw_output_capacity')
    let text = raw
    if (!isBody) {
      const wire = parseCreativeJson(raw, { maxUtf16: 65536, maxDepth: 12, maxNodes: 16384 }, check)
      scalarTree(wire, check)
      const schema = schemaOf(creativePlanOutputSchema(stage, request.taskId, view.manifest.language).schema)
      const defs = schemaOf(schema.$defs)
      validateWire(wire, schema, defs, check)
      const mapped = mapWire(wire, schema, defs, prepared, view, check) as { payload: unknown }
      text = canonicalStringify({ protocol: 'campaign-plan-v1', stage, language: view.manifest.language, dependencies: request.dependencies, payload: mapped.payload })
      if (utf8Bytes(text) > PLANNING_STAGE_LIMITS[stage].responseBytes) refuse('compiled_capacity')
    }
    const rawMetrics = await measureCampaignText(text), canonical = await measureCampaignText(canonicalCampaignText(text))
    check()
    if (isBody && (canonical.scalars < 256 || canonical.scalars > 1024)) refuse('body_length')
    const chapterTable = [1, 2, 3].map(ordinal => planningChapterAddress(view.manifest, ordinal))
    const catalogRoot = await hashCampaignValue('creative-catalog-mapping-v1', { catalogDigest: prepared.catalogDigest, chapterTable, compilerVersion: prepared.compilerVersion })
    const artifact = await sealCreativeArtifactCandidate(request, response, { text, raw: rawMetrics, canonical, catalogRoot, semanticStatus: 'not_reviewed' })
    check()
    if (!isBody) {
      const parents = request.dependencies.map(ref => {
        const parent = view.artifacts.get(ref.hash)
        if (!parent || parent.taskId !== ref.taskId || parent.revision !== ref.revision) throw new CreativePilotError('source_changed')
        return parent
      })
      await buildPlanningCanon(view.manifest, [...parents, artifact], check)
    }
    check(); return { outcome: 'accepted', artifact }
  } catch (error) {
    if (error instanceof CompileFailure) return { outcome: 'refused', reason: error.reason }
    if (error instanceof CreativeJsonError) return { outcome: 'refused', reason: error.code }
    if (error instanceof PlanningRefusalError) return { outcome: 'refused', reason: planningFailure(error) }
    throw error
  }
}
