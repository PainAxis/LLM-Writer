export type TextEncoding = 'utf-8' | 'gbk'

export interface BookFile {
  name: string
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface ImportedBook {
  content: string
  format: 'txt' | 'docx'
  encoding: TextEncoding | null
}

// Only plain text leaves this function. Generated document HTML is never inserted
// into the page, so links, images and embedded markup cannot become active content.
function documentHtmlToText(html: string): string {
  const document = new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html')
  const body = document.getElementsByTagName('body')[0]
  if (!body) throw new Error('DOCX 正文解析失败')

  const readNode = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent || ''
    if (node.nodeType !== 1) return ''
    const tag = node.nodeName.toLowerCase()
    if (['script', 'style', 'img'].includes(tag)) return ''
    if (tag === 'br') return '\n'
    const text = Array.from(node.childNodes).map(readNode).join('')
    if (tag === 'td' || tag === 'th') return `${text.trimEnd()}\t`
    if (tag === 'tr') return `${text.trimEnd()}\n`
    if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table'].includes(tag)) return `${text}\n\n`
    if (tag === 'li') return `${text}\n`
    return text
  }

  return readNode(body).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export async function readBookFile(file: BookFile, encoding: TextEncoding = 'utf-8'): Promise<ImportedBook> {
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension !== 'txt' && extension !== 'docx') throw new Error('仅支持 .txt 和 .docx 文件')
  let buffer: ArrayBuffer
  try {
    buffer = await file.arrayBuffer()
  } catch {
    throw new Error('文件读取失败，请重新选择文件')
  }

  let content: string
  if (extension === 'docx') {
    try {
      // The browser entry also makes the same ArrayBuffer API usable in smoke
      // tests. Loading only on DOCX import keeps this parser out of page startup.
      const { default: mammoth } = await import('mammoth/mammoth.browser.js')
      const result = await mammoth.convertToHtml({ arrayBuffer: buffer }, {
        includeEmbeddedStyleMap: false,
        externalFileAccess: false,
        // Text import does not read or embed document images.
        convertImage: mammoth.images.imgElement(async () => ({ src: '' })),
      })
      if (result.messages.some(message => message.type === 'error')) throw new Error('Invalid DOCX')
      content = documentHtmlToText(result.value)
    } catch {
      throw new Error('DOCX 解析失败，请确认文件未损坏且为未加密的 .docx 文档')
    }
  } else {
    try {
      content = new TextDecoder(encoding, { fatal: true }).decode(buffer).replace(/\r\n?/g, '\n')
      if (content.includes('\0')) throw new Error('Binary file')
    } catch {
      throw new Error(`无法按 ${encoding.toUpperCase()} 读取文本，请尝试其他编码或检查文件格式`)
    }
  }

  if (!content.trim()) throw new Error('文件中没有可导入的正文')
  return { content, format: extension, encoding: extension === 'txt' ? encoding : null }
}

// A replacement or removal invalidates older async reads. Callers only commit a
// successful latest result, preserving the current book on errors.
export function createBookImporter() {
  let revision = 0
  return {
    cancel() { revision++ },
    async read(file: BookFile, encoding: TextEncoding): Promise<ImportedBook | null> {
      const request = ++revision
      try {
        const result = await readBookFile(file, encoding)
        return request === revision ? result : null
      } catch (error) {
        if (request !== revision) return null
        throw error
      }
    },
  }
}

export function splitBookLocally(text: string) {
  const chapters = []
  let startPos = 0
  while (startPos < text.length) {
    let endPos = Math.min(startPos + 3000, text.length)
    for (let i = endPos; i < Math.min(endPos + 200, text.length); i++) {
      if ('。！？\n'.includes(text[i]!)) {
        endPos = i + 1
        break
      }
    }
    // Do not split a UTF-16 surrogate pair at a length-based boundary.
    if (endPos < text.length && /[\uD800-\uDBFF]/.test(text[endPos - 1]!)) endPos++
    const content = text.slice(startPos, endPos)
    chapters.push({
      index: chapters.length,
      title: `第${chapters.length + 1}章`,
      startPos,
      endPos,
      wordCount: content.length,
      summary: '',
      content: content.slice(0, 100) + (content.length > 100 ? '...' : ''),
    })
    startPos = endPos
  }
  return chapters
}
