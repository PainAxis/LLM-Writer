/** Bounded JSON admission shared by the v4 compiler and its HTTP metadata gate.
 * Duplicate evidence is collected before JSON.parse can erase it. Resource
 * bounds win first, then whole-value syntax, then duplicate decoded keys.
 * Decoded strings are not normalized or scalar-validated here: known malformed
 * visible output must remain losslessly retainable before content refusal. */
export type CreativeJsonErrorCode = 'planning_capacity' | 'invalid_json' | 'duplicate_json_key'
export class CreativeJsonError extends Error {
  constructor(readonly code: CreativeJsonErrorCode) { super(code); this.name = 'CreativeJsonError' }
}
export interface CreativeJsonLimits { maxUtf16: number; maxDepth: number; maxNodes: number }

export function parseCreativeJson(raw: string, limits: CreativeJsonLimits, check: () => void = () => {}): unknown {
  check()
  if (typeof raw !== 'string' || !Number.isSafeInteger(limits.maxUtf16) || limits.maxUtf16 < 1 || limits.maxUtf16 > 65_536
    || !Number.isSafeInteger(limits.maxDepth) || limits.maxDepth < 1 || limits.maxDepth > 32
    || !Number.isSafeInteger(limits.maxNodes) || limits.maxNodes < 1 || limits.maxNodes > 16_384
    || raw.length > limits.maxUtf16) throw new CreativeJsonError('planning_capacity')
  const tokenPattern = /"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g
  const stack: Array<{ object: boolean; keyExpected: boolean; keys: Set<string> }> = []
  let nodes = 0, duplicate = false
  for (let match = tokenPattern.exec(raw); match; match = tokenPattern.exec(raw)) {
    check()
    const token = match[0]
    if (token === '{' || token === '[') {
      if (++nodes > limits.maxNodes || stack.length >= limits.maxDepth) throw new CreativeJsonError('planning_capacity')
      stack.push({ object: token === '{', keyExpected: token === '{', keys: new Set() })
      continue
    }
    if (token === '}' || token === ']') { stack.pop(); continue }
    const owner = stack.at(-1)
    if (token === ',') { if (owner?.object) owner.keyExpected = true; continue }
    if (token === ':') { if (owner?.object) owner.keyExpected = false; continue }
    if (++nodes > limits.maxNodes) throw new CreativeJsonError('planning_capacity')
    if (owner?.object && owner.keyExpected && token.startsWith('"')) {
      try {
        const key = JSON.parse(token) as string
        duplicate ||= owner.keys.has(key)
        owner.keys.add(key)
      } catch { /* The complete syntax pass below owns invalid_json precedence. */ }
      owner.keyExpected = false
    }
  }
  check()
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new CreativeJsonError('invalid_json') }
  check()
  if (duplicate) throw new CreativeJsonError('duplicate_json_key')
  return value
}
