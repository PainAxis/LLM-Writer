/** Observer-only classification. It does not change runtime phases or deadlines. */
const terminalPhases = new Set(['failed', 'stale', 'cancelled', 'expired', 'needs_author_input'])
export function classifyWriterAgentPhase(expected, actual) {
  if (actual === expected) return 'ready'
  return terminalPhases.has(actual) ? 'terminal_mismatch' : 'pending'
}
