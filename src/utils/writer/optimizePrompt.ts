/** Substitute the passage literally, including replacement tokens and braces in its text. */
export function buildWriterOptimizePrompt(template: string, originalContent: string): string {
  const hasPassageVariable = template.includes('{原文内容}')
  const instructions = template.replace(/\{原文内容\}/g, () => originalContent)
  const passage = hasPassageVariable ? '' : `\n\n原始内容：\n${originalContent}`
  return `${instructions}${passage}\n\n请直接输出优化后的内容，无需额外说明：`
}
