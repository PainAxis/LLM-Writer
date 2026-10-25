/** Exact acceptance/error equivalence for the stateless scalar fast path.
 * Reference is the accepted dfb94ffd implementation, not a second regexp oracle.
 * Enumerates every UTF-16 unit, every valid supplementary scalar, and every
 * possible adjacent unit at malformed high/low boundaries. No stored hashes change.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { assertScalarText, canonicalCampaignText, hashText, measureCampaignText, utf8Bytes } from '../src/services/writerCampaign/protocol'

async function main() {

function reference(value: unknown): string | null {
  if (typeof value !== 'string') return 'Expected text'
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return 'Unpaired high surrogate'
    } else if (!(code < 0xdc00 || code > 0xdfff)) return 'Unpaired low surrogate'
  }
  return null
}
let checked = 0
function equivalent(value: unknown) {
  const expected = reference(value)
  let message: string | null = null
  try { assertScalarText(value as string) } catch (error) {
    assert.ok(error instanceof Error)
    assert.equal((error as { code?: string }).code, 'integrity')
    message = error.message
  }
  assert.equal(message, expected)
  checked++
}
const before = Date.now()
for (const value of [null, undefined, 0, 1, false, {}, [], new String('scalar')]) equivalent(value)
for (let code = 0; code <= 0xffff; code++) {
  const unit = String.fromCharCode(code)
  equivalent(unit)
  equivalent(`A\0${unit}\n中`)
  // Every possible second/first code unit at the high/low boundary.
  equivalent(`\ud800${unit}`)
  equivalent(`${unit}\udfff`)
  equivalent(`\udbff${unit}x`)
  equivalent(`x${unit}\udc00`)
}
for (let high = 0xd800; high <= 0xdbff; high++) for (let low = 0xdc00; low <= 0xdfff; low++) {
  equivalent(String.fromCharCode(high, low))
}
const bmp = Array.from({ length: 0x10000 }, (_, code) => code < 0xd800 || code > 0xdfff ? String.fromCharCode(code) : '').join('')
const longVectors = [bmp, 'a'.repeat(65_536), '中'.repeat(65_536), '\0\n\r\t\\"'.repeat(10_000),
  'e\u0301'.repeat(32_768), '😀'.repeat(32_768), 'a'.repeat(32_767) + '😀' + '中'.repeat(32_767),
  '\ud800' + 'a'.repeat(65_535), 'a'.repeat(65_535) + '\udfff',
  'a'.repeat(32_768) + '\ud800' + 'a'.repeat(32_768)]
for (const value of longVectors) equivalent(value)
for (const value of ['', 'a\r\nb\rc', 'e\u0301😀中', '\0\t\n\\"', bmp, ...longVectors.slice(1, 7)]) {
  const expectedBytes = Buffer.byteLength(value, 'utf8'), expectedHash = createHash('sha256').update(value, 'utf8').digest('hex')
  assert.equal(utf8Bytes(value), expectedBytes)
  assert.equal(await hashText(value), expectedHash)
  assert.deepEqual(await measureCampaignText(value), { hash: expectedHash, utf8Bytes: expectedBytes, utf16Units: value.length, scalars: Array.from(value).length })
  assert.equal(canonicalCampaignText(value), value.replace(/\r\n/g, '\n').normalize('NFC'))
}
// The legacy lone-CR normalization contract is unchanged.
assert.equal(canonicalCampaignText('A\rB'), 'A\rB')
assert.notEqual(await hashText(canonicalCampaignText('A\rB')), await hashText('A\nB'))
console.log(JSON.stringify({ suite: 'writer-campaign-scalar-equivalence', checked, allBmpUnits: 65_536,
  allWellFormedSurrogatePairs: 1_048_576, malformedBoundaryVectors: 262_144, elapsedMs: Date.now() - before,
  wireAndHashContract: 'unchanged', semanticConsistency: 'NOT_RUN' }))
}
try { await main() } catch { process.stderr.write('scalar_equivalence_assertion_failed\n'); process.exitCode = 1 }
