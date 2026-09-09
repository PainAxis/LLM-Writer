export function stripWriterHtml(content: string): string {
  return content.replace(/<[^>]*>/g, '').trim()
}

export function formatGeneratedBody(rawContent: string): string {
  return formatGeneratedContent(rawContent, '')
}

export function formatGeneratedContent(rawContent: string, chapterTitle: string): string {
  let formatted = rawContent.trim()

  if (chapterTitle && !formatted.includes(chapterTitle)) {
    formatted = `<h3>${chapterTitle}</h3>\n\n${formatted}`
  }

  return formatted
    .split('\n')
    .filter(paragraph => paragraph.trim())
    .map(paragraph => {
      const trimmed = paragraph.trim()
      if (trimmed.startsWith('#') || trimmed === chapterTitle) {
        return `<h3>${trimmed.replace(/^#+\s*/, '')}</h3>`
      }
      if (trimmed.startsWith('"') || trimmed.startsWith('“') || trimmed.startsWith('「')) {
        return `<p class="dialogue">${trimmed}</p>`
      }
      return `<p>${trimmed}</p>`
    })
    .join('')
}
