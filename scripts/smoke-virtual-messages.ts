import assert from 'node:assert/strict'
import { messageIndexAt, messageOffsets, messageWindow } from '../src/utils/virtualMessages'

assert.deepEqual(messageWindow([0], 0, 500), { start: 0, end: 0, before: 0, after: 0 })
const ids = Array.from({ length: 10000 }, (_, i) => String(i))
const heights = new Map([['0', 240], ['1', 20], ['5000', 1200], ['9999', 32]])
const offsets = messageOffsets(ids, heights)
assert.equal(messageIndexAt(offsets, 239), 0)
assert.equal(messageIndexAt(offsets, 240), 1)
assert.equal(messageIndexAt(offsets, 259), 1)
assert.equal(messageIndexAt(offsets, 260), 2)
for (const top of [0, 230, 260, offsets[5000] + 700, offsets.at(-1)! - 400]) {
  const range = messageWindow(offsets, top, 400)
  assert.ok(range.end - range.start < 30, 'Rendered row count stays bounded for long histories')
  assert.ok(offsets[range.start] <= top)
  assert.ok(offsets[range.end] >= Math.min(top + 400, offsets.at(-1)!))
  assert.equal(range.before + (offsets[range.end] - offsets[range.start]) + range.after, offsets.at(-1))
}
const last = messageWindow(offsets, offsets.at(-1)! - 400, 400)
assert.equal(last.end, ids.length)
assert.equal(last.after, 0)
heights.set('0', 500)
const resized = messageOffsets(ids, heights)
// Keeping the same anchor and inset compensates for a preceding row growing.
assert.equal(resized[5000] + 17 - (offsets[5000] + 17), 260)
assert.equal(ids.length, 10000, 'Presentation never truncates the source history')
console.log('Virtual message window smoke passed')
