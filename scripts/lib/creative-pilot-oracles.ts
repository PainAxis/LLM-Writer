/** Independent acceptance oracles; never import a production hash/count/compiler helper. */
export function controlAssert(value: unknown, code = 'creative_control_invalid'): asserts value { if (!value) throw new Error(code) }
export function controlObject(value: unknown): asserts value is Record<string, unknown> { controlAssert(value !== null && typeof value === 'object' && !Array.isArray(value)) }
export function controlKeys(value: unknown, names: readonly string[]): asserts value is Record<string, unknown> { controlObject(value); controlAssert(Object.keys(value).length === names.length && names.every(key => Object.hasOwn(value, key))) }
export function scalarOracle(text: string): void {
  for (let i = 0; i < text.length; i++) {
    const n = text.charCodeAt(i)
    if (n >= 0xd800 && n <= 0xdbff) { const low = text.charCodeAt(++i); controlAssert(low >= 0xdc00 && low <= 0xdfff) }
    else controlAssert(n < 0xdc00 || n > 0xdfff)
  }
}
export function byteOracle(text: string): number { scalarOracle(text); return new TextEncoder().encode(text).byteLength }
export function canonicalOracle(value: unknown): string {
  let nodes = 0
  function encode(v: unknown, depth: number): string {
    controlAssert(++nodes <= 100_000 && depth <= 32)
    if (v === null) return 'null'
    if (typeof v === 'string') { scalarOracle(v); return JSON.stringify(v) }
    if (typeof v === 'boolean') return v ? 'true' : 'false'
    if (typeof v === 'number') { controlAssert(Number.isSafeInteger(v) && v >= 0); return String(v) }
    if (Array.isArray(v)) return '[' + v.map(x => encode(x, depth + 1)).join(',') + ']'
    controlObject(v)
    controlAssert(Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)
    return '{' + Object.keys(v).sort().map(k => { scalarOracle(k); return JSON.stringify(k) + ':' + encode(v[k], depth + 1) }).join(',') + '}'
  }
  return encode(value, 0)
}
export async function hashOracle(text: string): Promise<string> { scalarOracle(text); return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), n => n.toString(16).padStart(2, '0')).join('') }
export async function domainOracle(domain: string, value: unknown): Promise<string> { return hashOracle(canonicalOracle({ domain, value })) }
export async function metricsOracle(text: string) { scalarOracle(text); return { hash: await hashOracle(text), utf8Bytes: byteOracle(text), utf16Units: text.length, scalars: Array.from(text).length } }
export async function bodyOracle(text: string) { return { raw: await metricsOracle(text), canonical: await metricsOracle(text.replace(/\r\n/g, '\n').normalize('NFC')) } }
export function storageCounterOracle(value: unknown): number { controlAssert(typeof value === 'string' && /^[0-9]{16}$/.test(value)); const n = Number(value); controlAssert(Number.isSafeInteger(n) && n >= 0 && String(n).padStart(16, '0') === value); return n }
export function writeBytesOracle(rows: readonly { key: string; value: string }[]): number { return rows.reduce((sum, row) => sum + byteOracle(row.key) + byteOracle(row.value), 0) }
export async function rowMapOracle(rows: ReadonlyMap<string, string>): Promise<string> { return hashOracle(canonicalOracle([...rows].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))) }
