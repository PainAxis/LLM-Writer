import assert from 'node:assert/strict'
import { inspectHistoricalEvidence } from './jina-writing-evidence'

const tower = 'In 1822 the lighthouse tower was constructed.'
const laterLens = 'In 1822 Augustin Jean Fresnel introduced a new lens design.'
const evidence = inspectHistoricalEvidence(`${tower}\n${'Unrelated coastal history. '.repeat(30)}\n${laterLens}`, 1822)
assert.equal(evidence.yearOccurrences, 2)
assert.equal(evidence.firstOccurrenceSupported, false)
assert.equal(evidence.matchingOccurrences, 1)
assert.equal(evidence.inventionSupported, true, 'Examine later matching dates after a construction-only first mention')
assert.equal(inspectHistoricalEvidence(tower, 1822).inventionSupported, false)
assert.equal(inspectHistoricalEvidence('In 1822 a tower was designed and constructed.', 1822).inventionSupported, false)
assert.equal(inspectHistoricalEvidence('The Fresnel lens was first installed and used in 1823.', 1823).firstUseSupported, true)
assert.equal(inspectHistoricalEvidence('The Fresnel lens was installed in 1854.', 1854).firstUseSupported, false)
console.log('Jina historical evidence regression passed: later matching dates, construction exclusions and first use')
