/** Pixel offsets for variable-height rows; estimates are replaced after rendering. */
export function messageOffsets(ids: readonly string[], heights: ReadonlyMap<string, number>, estimate = 80): number[] {
  const offsets = [0]
  for (const id of ids) offsets.push(offsets[offsets.length - 1] + (heights.get(id) ?? estimate))
  return offsets
}

export function messageIndexAt(offsets: readonly number[], pixel: number): number {
  let low = 0
  let high = Math.max(0, offsets.length - 2)
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2)
    if (offsets[middle] <= pixel) low = middle
    else high = middle - 1
  }
  return low
}

export function messageWindow(offsets: readonly number[], top: number, height: number, overscan = 5) {
  const count = offsets.length - 1
  if (!count) return { start: 0, end: 0, before: 0, after: 0 }
  const start = Math.max(0, messageIndexAt(offsets, top) - overscan)
  const end = Math.min(count, messageIndexAt(offsets, top + height) + overscan + 1)
  return { start, end, before: offsets[start], after: offsets[count] - offsets[end] }
}
