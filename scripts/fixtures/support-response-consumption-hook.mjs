/**
 * Test-only one-shot mutation at the real HTTP body's EOF, before the bounded
 * adapter/SDK can publish its parsed reply. Self-contained for page.evaluate.
 * SDK v7 drains ReadableStream directly, not Response.json()/text().
 */
export function installSupportBodyConsumptionHook({ fixtureOrigin, novelId, chapterId }) {
  const originalFetch = globalThis.fetch
  const state = { fired: false, reachedEof: false, bytes: 0, chunks: 0, status: null }
  globalThis.__supportFinalReadHook = state
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.startsWith(`${fixtureOrigin}/`) || !url.endsWith('/chat/completions')) return originalFetch(input, init)
    // Never leave a global hook installed for later requests or failure paths.
    globalThis.fetch = originalFetch
    const response = await originalFetch(input, init)
    state.status = response.status
    if (response.status !== 200 || !response.body) return response
    const originalGetReader = response.body.getReader.bind(response.body)
    response.body.getReader = (...args) => {
      const reader = originalGetReader(...args)
      const originalRead = reader.read.bind(reader)
      reader.read = async (...readArgs) => {
        const part = await originalRead(...readArgs)
        if (part.done && !state.fired) {
          state.reachedEof = true
          if (state.bytes === 0) throw new Error('Synthetic response consumption hook received no body')
          const novels = JSON.parse(localStorage.getItem('novels'))
          const chapter = novels.find(novel => novel.id === novelId)?.chapterList.find(item => item.id === chapterId)
          if (!chapter) throw new Error('Synthetic response consumption hook could not find source')
          chapter.title += '（响应读取后改题）'
          localStorage.setItem('novels', JSON.stringify(novels))
          state.fired = true
        } else if (!part.done) {
          state.bytes += part.value.byteLength
          state.chunks++
        }
        return part
      }
      return reader
    }
    return response
  }
}
