/** Deterministic synthetic scope fixtures, not a semantic/model benchmark. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const LONG_PROFILE_ID = 'novel-candidate-long-v1'
export const LONG_CHAPTER_COUNT = 600
export const LONG_CHAPTER_CHARS = 2_200
export const LONG_DISCLOSED_CHAPTERS = 599
export const LONG_FUTURE_CANARY = 'FUTURE_ONLY_NOVEL_SCAN_64111'
export const PLOT_EXPLANATION_CANARY = 'MODEL_PLOT_EXPLANATION_NOT_WRITER_64111'
export const LONG_TARGET_TEXT = '沈砚来到渡口，准备沿旧路寻找阿宁。雨水刚停，青石阶上还留着浅浅的水痕。他把行囊放在茶棚旁，向掌柜问起河面上最后一艘船的去向。'
const filler = '河风经过青石街，行人收好伞，继续沿着日常熟悉的道路前行。茶棚里煮着清水，船工在岸边修补旧绳，远处传来零散的人声。'
const exactLength = (prefix, length) => {
  assert.ok(prefix.length <= length)
  return prefix + filler.repeat(Math.ceil((length - prefix.length) / filler.length)).slice(0, length - prefix.length)
}
export const revisionFor = source => createHash('sha256').update(JSON.stringify([source.title, source.text])).digest('hex')
export function buildLongProfile() {
  const chapters = Array.from({ length: LONG_CHAPTER_COUNT }, (_, index) => {
    const ordinal = index + 1
    let prefix = `第${ordinal}站的见闻。`
    if (ordinal === 587) prefix = '沈砚将渡口药铺托付给阿宁，阿宁点头接下钥匙。'
    if (ordinal === 588) prefix = '白鹭离开前，把编号银匣64111藏在井下，说等自己回来再开。'
    if (ordinal === 592) prefix = '旧户帖记得分明：白鹭改名裁雨，两个名字属于同一人。'
    if (ordinal === 598) prefix = '裁雨回到故居，从井下取出编号银匣64111，读完了多年未启的信。'
    if (ordinal === 599) prefix = LONG_TARGET_TEXT
    if (ordinal === 600) prefix = `${LONG_FUTURE_CANARY}。结局才披露的血缘与幕后身份不能进入扫描或Writer。`
    const text = exactLength(prefix, LONG_CHAPTER_CHARS)
    return { sourceId: `L${ordinal}`, id: `long-${ordinal}`, ordinal, title: `长篇受控来源 第${ordinal}章`, text,
      cues: ordinal === 587 ? [{ kind: 'relation', keys: ['沈砚', '阿宁'] }]
        : ordinal === 588 ? [{ kind: 'setup', keys: ['白鹭'] }]
          : ordinal === 592 ? [{ kind: 'bridge', keys: ['白鹭', '裁雨'] }]
            : ordinal === 598 ? [{ kind: 'recovery', keys: ['裁雨'] }] : [] }
  })
  const disclosed = chapters.slice(0, LONG_DISCLOSED_CHAPTERS)
  const totalChars = chapters.reduce((sum, chapter) => sum + chapter.text.length, 0)
  const disclosedChars = disclosed.reduce((sum, chapter) => sum + chapter.text.length, 0)
  assert.equal(totalChars, 1_320_000)
  assert.equal(disclosedChars, 1_317_800)
  return { id: LONG_PROFILE_ID, chapters, throughChapterId: disclosed.at(-1).id,
    totalChars, disclosedChars, totalChapterCount: chapters.length, disclosedChapterCount: disclosed.length,
    sourceSha256: createHash('sha256').update(JSON.stringify(chapters.map(({ id, title, text }) => [id, title, text]))).digest('hex') }
}

/** 180 singleton + 179 adjacent pairs + 178 adjacent triples = 537 jobs (>512). */
export function buildReviewCapacityProfile(count = 180) {
  assert.ok(Number.isSafeInteger(count) && count >= 174 && count <= 600)
  const chapters = Array.from({ length: count }, (_, index) => {
    const ordinal = index + 1, tag = String(ordinal).padStart(4, '0')
    return { sourceId: `C${ordinal}`, id: `capacity-${ordinal}`, ordinal, title: `容量来源 ${ordinal}`,
      text: `巡守甲${tag}把编号物件${tag}交给巡守乙${tag}，委托他照看这一班的库房。`,
      cues: [{ kind: 'relation', keys: [`编号物件${tag}`] }] }
  })
  return { id: 'novel-candidate-review-capacity-v1', chapters, throughChapterId: chapters.at(-1).id,
    disclosedChars: chapters.reduce((sum, chapter) => sum + chapter.text.length, 0),
    expectedMinimumJobs: count + count - 1 + count - 2 }
}

/** JSON escaping worst cases are source, not instructions or a truncation excuse. */
export function buildEscapingProfile() {
  const units = ['\u0000', '\u0001', '\b', '\t', '\n', '\f', '\r', '"', '\\', '𠮷', '🙂', '汉']
  const chapters = units.map((unit, index) => ({ id: `escape-${index}`, title: `转义来源 ${index}`,
    text: (`原文${unit}`).repeat(4_117) + '终点原文不可遗漏。' }))
  return { id: 'novel-candidate-escaping-v1', chapters,
    throughChapterId: chapters.at(-1).id, totalChars: chapters.reduce((sum, chapter) => sum + chapter.text.length, 0) }
}
