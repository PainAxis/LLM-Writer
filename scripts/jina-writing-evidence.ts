/** Pure grounding checks shared by the live harness and its offline regression. */
export function inspectHistoricalEvidence(text: string, year: unknown) {
  const historicalYear = typeof year === 'number' && Number.isInteger(year) && year >= 1000 && year <= 9999 ? year : null
  const witnesses = historicalYear === null ? [] : [...text.matchAll(new RegExp(`\\b${historicalYear}\\b`, 'g'))]
    .map(match => text.slice(Math.max(0, match.index - 220), match.index + 220))
  const lens = (witness: string) => /Fresnel|lens|菲涅耳|透镜/i.test(witness)
  const invention = (witness: string) => lens(witness) && /invent|develop|devis|design|introduc/i.test(witness)
  const firstUse = (witness: string) => lens(witness) && /first|install|used|use|operat/i.test(witness)
  const relevant = historicalYear === 1822 ? invention : historicalYear === 1823 ? firstUse : () => false
  return {
    historicalYear, yearOccurrences: witnesses.length, matchingOccurrences: witnesses.filter(relevant).length,
    firstOccurrenceSupported: witnesses.length > 0 && relevant(witnesses[0]!),
    inventionSupported: historicalYear === 1822 && witnesses.some(invention),
    firstUseSupported: historicalYear === 1823 && witnesses.some(firstUse),
  }
}
