/** Offline typed-plot schema/source gates; store and backup integration have separate smokes. */
import assert from 'node:assert/strict'
import { MemoryIndex } from '../src/services/memory/engine'
import { chapterRevision } from '../src/services/memory/revision'
import {
  confirmFactPlotLink, createFactPlotLink, emptyFactGraph, FactGraphValidationError,
  FACT_GRAPH_MAX_PLOT_LINKS, selectFactGraph, selectFactPlotLinks, validateFactGraphDocument, validateFactPlotLink,
} from '../src/services/memory/factGraph'
import type { FactAnchor, FactRelation } from '../src/types/factGraph'
import type { MemoryProjectInput } from '../src/types/memory'

let requests = 0
const originalFetch = globalThis.fetch
globalThis.fetch = async () => { requests++; throw new Error('Offline plot schema smoke cannot use the network') }
const project: MemoryProjectInput = {
  id: 'novel:plot-smoke', title: '铜铃与远渡', clues: [], chapters: [
    { id: 'z-open', title: '开篇', text: '🌧️沈砚留下缺角铜铃，约定三声后接应。' },
    { id: 'a-bridge', title: '桥梁', text: '缺角铜铃也被称作暮钟，留有同样刻痕。' },
    { id: 'm-return', title: '归来', text: '阿宁听见暮钟三声，终于在渡口接到了沈砚。' },
  ],
}
const anchors: FactAnchor[] = await Promise.all(project.chapters.map(async chapter => ({
  chapterId: chapter.id, sourceRevision: await chapterRevision(chapter), start: 0, end: chapter.text.length, quote: chapter.text,
})))
const provenance = { campaignId: 'campaign-1', segmentId: 'segment-1', jobId: 'job-1', candidateId: 'candidate-1' }
const setup = createFactPlotLink({
  id: 'setup', projectId: project.id, mode: 'setup_candidate', title: '铜铃信号', explanation: '可能是伏笔，并不证明尚未回收。',
  origin: 'inferred', provenance, premises: [{ role: 'setup', evidence: [anchors[0]!] }],
})
const recovery = createFactPlotLink({
  ...setup, id: 'recovery', mode: 'possible_recovery', title: '暮钟可能呼应铜铃',
  premises: [
    { role: 'setup', evidence: [anchors[0]!] }, { role: 'context', evidence: [anchors[1]!] },
    { role: 'recovery', evidence: [anchors[2]!] },
  ],
})
const document = { ...emptyFactGraph(project.id), plotLinks: [recovery, setup] }
const index = new MemoryIndex()
const stats = await index.sync(project)
assert.equal(setup.createdBy, 'model')
assert.equal(setup.authorConfirmed, false)
const forced = createFactPlotLink({ ...recovery, createdBy: 'author', authorConfirmed: true } as Parameters<typeof createFactPlotLink>[0])
assert.equal(forced.createdBy, 'model')
assert.equal(forced.authorConfirmed, false)
assert.deepEqual(selectFactPlotLinks(project, stats, document, 'z-open').plotLinks.map(item => item.id), ['setup'])
assert.deepEqual(selectFactPlotLinks(project, stats, document, 'a-bridge').plotLinks.map(item => item.id), ['setup'])
assert.equal(selectFactPlotLinks(project, stats, document, 'm-return').plotLinks.length, 2)
assert.equal(selectFactPlotLinks(project, stats, document, 'z-open', '暮钟').plotLinks.length, 0)
assert.deepEqual(selectFactPlotLinks(project, stats, document, 'm-return').plotLinks[0]!.premises.map(p => p.role), ['setup', 'context', 'recovery'])
assert.deepEqual(selectFactGraph(project, stats, document, 'm-return'), { relations: [], nodes: [], truncated: false })
assert.deepEqual(project.clues, [], 'Plot candidates cannot become author MemoryClues')
console.log('✓ Model proposals stay unconfirmed, retain all roles, and do not become relations or MemoryClues')

assert.throws(() => confirmFactPlotLink(project, stats, document, 'a-bridge', recovery.id), /全部原文前提/)
const confirmed = confirmFactPlotLink(project, stats, document, 'm-return', recovery.id)
assert.equal(confirmed.plotLinks[0]!.authorConfirmed, true)
assert.equal(confirmed.plotLinks[0]!.origin, 'inferred')
assert.equal(confirmed.plotLinks[0]!.createdBy, 'model')
assert.deepEqual(confirmed.plotLinks[0]!.provenance, provenance)
assert.equal(document.plotLinks[0]!.authorConfirmed, false)
assert.equal(confirmed.revision, document.revision, 'Pure confirmation must not invent a committed revision')
assert.equal(selectFactPlotLinks(project, stats, confirmed, 'a-bridge').plotLinks.length, 1)
for (const chapterPosition of [0, 1, 2]) {
  const changed = structuredClone(project)
  changed.chapters[chapterPosition]!.text += '新'
  const updated = await index.sync(changed)
  assert.ok(!selectFactPlotLinks(changed, updated, confirmed, 'm-return').plotLinks.some(p => p.id === recovery.id))
  assert.throws(() => confirmFactPlotLink(changed, updated, confirmed, 'm-return', recovery.id), /全部原文前提/)
}
const retitled = structuredClone(project)
retitled.chapters[1]!.title = '修改章名'
assert.equal(selectFactPlotLinks(retitled, await index.sync(retitled), confirmed, 'm-return').plotLinks.length, 1)
const reordered = { ...project, chapters: [project.chapters[2]!, project.chapters[1]!, project.chapters[0]!] }
assert.equal(selectFactPlotLinks(reordered, await index.sync(reordered), confirmed, 'm-return').plotLinks.length, 0)
console.log('✓ Every setup/context/recovery premise is independently gated; confirmation cannot preserve stale or future information')

const invalid: unknown[] = [
  null, { ...recovery, mode: 'recovered' }, { ...recovery, title: 't'.repeat(121) },
  { ...recovery, explanation: 'x'.repeat(241) }, { ...recovery, authorConfirmed: 'yes' },
  { ...recovery, semanticValidation: 'semantically-proven' }, { ...recovery, provenance: { ...provenance, jobId: '' } },
  { ...recovery, premises: [] }, { ...recovery, premises: [{ role: 'support', evidence: [anchors[0]] }] },
  { ...recovery, premises: [{ role: 'recovery', evidence: [anchors[0]] }] },
  { ...recovery, premises: [{ role: 'setup', evidence: [anchors[0]] }] },
  { ...recovery, premises: [{ role: 'setup', evidence: [anchors[0]] }, { role: 'recovery', evidence: [anchors[0]] }] },
  { ...setup, premises: [{ role: 'setup', evidence: [{ ...anchors[0], sourceRevision: 'old' }] }] },
  { ...setup, premises: [{ role: 'setup', evidence: [{ ...anchors[0], start: -1 }] }] },
  { ...setup, premises: [{ role: 'setup', evidence: [{ ...anchors[0], end: 999 }] }] },
]
for (const value of invalid) assert.throws(() => validateFactPlotLink(value))
assert.throws(() => validateFactPlotLink(recovery, 'other-novel'))
assert.throws(() => validateFactGraphDocument({ ...document, plotLinks: [setup, setup] }))
assert.throws(() => validateFactGraphDocument({ ...document, plotLinks: null }))
assert.throws(() => validateFactGraphDocument({ ...document, version: 1 }))
const legacy = { version: 1, projectId: project.id, revision: 'legacy', relations: [] }
assert.deepEqual(validateFactGraphDocument(legacy), { ...legacy, version: 2, plotLinks: [] })
assert.equal(legacy.version, 1)
assert.throws(() => validateFactGraphDocument({ ...legacy, version: 9 }), error => error instanceof FactGraphValidationError && error.code === 'unsupported-version')
const cloned = validateFactGraphDocument(document)
cloned.plotLinks[0]!.premises[0]!.evidence[0]!.quote = 'not the original'
cloned.plotLinks[0]!.provenance.jobId = 'changed'
assert.deepEqual(document.plotLinks[0], recovery)
console.log('✓ Typed validators reject bad roles, duplicated premises, oversized fields and unsupported versions without mutating inputs')

const all = { ...emptyFactGraph(project.id), plotLinks: Array.from({ length: FACT_GRAPH_MAX_PLOT_LINKS }, (_, id) => ({ ...setup, id: `s-${id}` })) }
assert.equal(validateFactGraphDocument(all).plotLinks.length, 2_000)
assert.equal(selectFactPlotLinks(project, stats, all, 'z-open').plotLinks.length, 200)
assert.equal(selectFactPlotLinks(project, stats, all, 'z-open').truncated, true)
all.plotLinks.push({ ...setup, id: 'over-cap' })
assert.throws(() => validateFactGraphDocument(all))
const hiddenThenVisible = { ...document, plotLinks: [
  ...Array.from({ length: 300 }, (_, id) => ({ ...recovery, id: `future-${id}` })), setup,
] }
assert.deepEqual(selectFactPlotLinks(project, stats, hiddenThenVisible, 'z-open'), {
  plotLinks: selectFactPlotLinks(project, stats, document, 'z-open').plotLinks, truncated: false,
})
const longQuote = { ...anchors[0]!, start: 0, end: 2_000, quote: '字'.repeat(2_000) }
const row: FactRelation = {
  id: 'quote', projectId: project.id, source: { type: 'person', label: '字' }, target: { type: 'object', label: '字' },
  predicate: '相接', origin: 'inferred', createdBy: 'model', authorConfirmed: false, evidence: [longQuote],
}
const sharedBudget = { ...emptyFactGraph(project.id), relations: Array.from({ length: 4_000 }, (_, i) => ({ ...row, id: `q-${i}` })) }
assert.equal(validateFactGraphDocument(sharedBudget).relations.length, 4_000)
assert.throws(() => validateFactGraphDocument({ ...sharedBudget, plotLinks: [setup] }), /容量/)
const escaped = { ...row, evidence: [{ ...longQuote, quote: '\u0000'.repeat(2_000) }] }
assert.throws(() => validateFactGraphDocument({ ...emptyFactGraph(project.id), relations: Array.from({ length: 2_000 }, (_, i) => ({ ...escaped, id: `e-${i}` })) }), /容量/)
assert.throws(() => validateFactPlotLink({ ...setup, premises: [{ role: 'setup', evidence: Array.from({ length: 5 }, (_, i) => ({ ...longQuote, chapterId: `large-${i}` })) }] }))
assert.equal(requests, 0)
globalThis.fetch = originalFetch
console.log('✓ Shared 8M quote/24M serialized limits and 2,000-link capacity are explicit; source filtering precedes the display budget')
console.log('\n=== ALL TYPED PLOT LINK TESTS PASSED ===')
