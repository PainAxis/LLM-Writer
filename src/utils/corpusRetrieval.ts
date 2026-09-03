/**
 * 语料库检索推荐纯函数集（字符 bigram 权重匹配，不上向量、不依赖分词）。
 * - 中文按 2 字窗口（bigram）统计重合度，对无分词的中文稳健
 * - 推荐：上下文与语料的 bigram 交集计分，达到 minScore 才入选，取 top-K
 * - 注入：组装进提示词的语料文本，按字符预算逐条截断
 */

/** 提取时忽略的高频虚词（最小集，够用即可） */
const STOPWORDS = new Set([
  '我们', '你们', '他们', '她们', '自己', '什么', '这个', '那个', '这些', '那些',
  '一个', '一些', '没有', '不是', '就是', '还是', '但是', '所以', '因为', '如果',
  '已经', '可以', '应该', '现在', '时候', '地方', '事情', '知道', '觉得', '说道',
])

export interface CorpusLike {
  id?: unknown
  title?: string
  content: string
}

export interface CorpusRecommendation<T extends CorpusLike> {
  item: T
  score: number
  matchedTerms: string[]
}

/** 2 字窗口集合（中英文连续段内滑窗），作为匹配的基本单元 */
function bigrams(text: string): Set<string> {
  const runs = text.match(/[\u4e00-\u9fa5a-zA-Z0-9]+/g) ?? []
  const set = new Set<string>()
  for (const run of runs) {
    const lowered = run.toLowerCase()
    for (let index = 0; index < lowered.length - 1; index += 1) {
      set.add(lowered.slice(index, index + 2))
    }
  }
  return set
}

/** 提取展示用关键词：中文取 2 字窗口（去停用词去重），英文取整词 */
export function extractKeywords(text: string, limit = 12): string[] {
  if (!text) return []
  const seen = new Set<string>()
  const keywords: string[] = []

  const push = (word: string): void => {
    const key = word.toLowerCase()
    if (word.length < 2 || STOPWORDS.has(key) || seen.has(key)) return
    seen.add(key)
    keywords.push(word)
  }

  const runs = text.match(/[\u4e00-\u9fa5a-zA-Z0-9]+/g) ?? []
  for (const run of runs) {
    if (/^[a-zA-Z0-9]+$/.test(run)) {
      push(run)
      continue
    }
    const lowered = run.toLowerCase()
    for (let index = 0; index < lowered.length - 1; index += 1) {
      push(lowered.slice(index, index + 2))
    }
  }

  return keywords.slice(0, limit)
}

/** 语料与上下文的重合度评分（bigram 交集计数） */
export function scoreCorpusItem<T extends CorpusLike>(item: T, contextGrams: Set<string>): CorpusRecommendation<T> {
  const grams = bigrams(`${item.title ?? ''}\n${item.content}`)
  let score = 0
  const matchedTerms: string[] = []

  for (const gram of grams) {
    if (contextGrams.has(gram)) {
      score += 1
      if (matchedTerms.length < 8) matchedTerms.push(gram)
    }
  }

  return { item, score, matchedTerms }
}

/**
 * 推荐语料：按重合度降序取 top-K。
 * minScore（默认 2）过滤巧合单字重叠；零重合语料不返回。
 */
export function recommendCorpus<T extends CorpusLike>(
  items: T[],
  contextText: string,
  options: { topK?: number; minScore?: number } = {},
): Array<CorpusRecommendation<T>> {
  const topK = options.topK ?? 5
  const minScore = options.minScore ?? 2
  const contextGrams = bigrams(contextText)
  if (contextGrams.size === 0 || items.length === 0) return []

  return items
    .map((item) => scoreCorpusItem(item, contextGrams))
    .filter((rec) => rec.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

/**
 * 组装注入提示词的语料文本：逐条「标题+正文」，整条放不下则丢弃（保持推荐排序优先级）；
 * 仅当第一条单独超出预算时截断其尾部，保证预算硬上限。
 */
export function buildCorpusInjection(
  items: Array<CorpusLike | CorpusRecommendation<CorpusLike>>,
  maxChars = 4000,
): { text: string; usedCount: number; truncated: boolean } {
  const plain = items.map((entry) => ('item' in entry ? entry.item : entry))
  const parts: string[] = []
  let total = 0
  let truncated = false

  for (const item of plain) {
    const title = (item.title ?? '').trim()
    const content = (item.content ?? '').trim()
    if (!content && !title) continue

    const header = title ? `【${title}】\n` : ''
    const part = `${header}${content}`
    // 条目之间以空行连接，分隔符成本计入预算
    const separator = parts.length > 0 ? 2 : 0

    if (total + separator + part.length > maxChars) {
      truncated = true
      if (parts.length === 0) {
        // 第一条即超预算：截断其尾部塞满预算
        const remaining = maxChars - total
        parts.push(`${header}${content.slice(0, Math.max(remaining - header.length - 1, 0))}…`)
      }
      break
    }

    parts.push(part)
    total += separator + part.length
  }

  return {
    text: parts.join('\n\n'),
    usedCount: parts.length,
    truncated,
  }
}
