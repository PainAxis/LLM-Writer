const ASCII_IDENTIFIER_CHAR = /^[A-Za-z0-9_-]$/u
const IDENTIFIER = /^(?=.*[a-z])(?=.*[0-9])[a-z0-9]+(?:[-_][a-z0-9]+)*$/u

/** Maximal ASCII codes only: 2–64 characters, letters and digits, optional internal -/_. */
export function memoryIdentifiers(text: string, edges = 0): string[] {
  const identifiers = new Set<string>()
  for (const match of text.matchAll(/[A-Za-z0-9_-]+/gu)) {
    // A source quote can start/end inside a larger token. Never index that fragment.
    if ((match.index === 0 && (edges & 1))
      || (match.index + match[0].length === text.length && (edges & 2))) continue
    if (match[0].length > 64) continue
    const value = match[0].toLowerCase()
    if (IDENTIFIER.test(value)) identifiers.add(value)
  }
  return [...identifiers]
}

/** Only the two adjacent source characters affect maximal-token membership. */
export function identifierEdges(text: string, start: number, end: number): number {
  return (ASCII_IDENTIFIER_CHAR.test(text[start - 1] ?? '') ? 1 : 0)
    | (ASCII_IDENTIFIER_CHAR.test(text[end] ?? '') ? 2 : 0)
}
