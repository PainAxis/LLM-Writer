/** Frozen synthetic source material. These are not autonomous prose or semantic judgments. */
export const BODY_EVIDENCE_SEGMENTS = Object.freeze({
  zh: Object.freeze([
    Object.freeze({
      mark: '林岚先核对铃座上的刻痕，再把位置记在纸上。',
      record: '阿澈抄下潮汐记号，把记录留在灯塔桌上。',
      belief: '林岚相信铜铃属于自己的家族，而不是灯塔。',
      narrator: '我断言铜铃从未属于灯塔；但我承认自己没有查过旧账。',
      unaware: '林岚说：“我还不知道石槽何时露出。”',
      ship: '一艘远船驶入雾中，没有留下目的地。',
    }),
    Object.freeze({
      learn: '阿澈解释记录后，林岚说：“我现在知道退潮时石槽会露出。”',
      forget: '浪声打断了她；过了一阵，林岚坦言：“我忘了石槽何时露出，必须重读记录。”',
    }),
    Object.freeze({
      relearn: '林岚重读桌上的记录，说：“我再次知道退潮时石槽会露出。”',
      recover: '退潮后，她依据第一天的铃座刻痕和潮汐记号，在石槽中找回铜铃。',
      signal: '她把铜铃装回铃座，灯塔信号重新响起。',
      ship: '远船的去向仍然没有揭晓。',
    }),
  ]),
  en: Object.freeze([
    Object.freeze({
      mark: 'Mara checked the mark on the bell seat before recording its position on paper.',
      record: 'Eli copied the tide notation and left the record on the lighthouse table.',
      belief: 'Mara believed the brass bell belonged to her family rather than the lighthouse.',
      narrator: 'I declared that the bell had never belonged to the lighthouse, though I admitted I had not checked the old accounts.',
      unaware: 'Mara said, "I do not yet know when the stone channel is exposed."',
      ship: 'A distant ship entered the fog without revealing its destination.',
    }),
    Object.freeze({
      learn: 'After Eli explained the record, Mara said, "I now know that the stone channel is exposed at low tide."',
      forget: 'The waves interrupted her. Later Mara admitted, "I have forgotten when the channel is exposed and must read the record again."',
    }),
    Object.freeze({
      relearn: 'Mara reread the record on the table and said, "I again know that the stone channel is exposed at low tide."',
      recover: 'At low tide, she used the first day\'s bell-seat mark and tide notation to recover the brass bell from the channel.',
      signal: 'She fitted the bell to its seat, and the lighthouse signal sounded again.',
      ship: 'The distant ship\'s destination remained unexplained.',
    }),
  ]),
})

/** A single literal separator is part of the frozen stored fixture, never an implicit chapter separator. */
export const BODY_EVIDENCE_BODY_FIXTURES = Object.freeze({
  zh: Object.freeze(BODY_EVIDENCE_SEGMENTS.zh.map(segments => Object.values(segments).join(' '))),
  en: Object.freeze(BODY_EVIDENCE_SEGMENTS.en.map(segments => Object.values(segments).join(' '))),
})
export function bodyEvidenceFixtureBodyTarget(language: 'zh' | 'en'): number {
  return BODY_EVIDENCE_BODY_FIXTURES[language].reduce((sum, text) => sum + [...text].length, 0)
}
