/** Frozen pre-strategy synthetic sources. Oracle vectors test wiring, NOT model quality. */
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

export const SEMANTIC_FIXTURE_VERSION = 'stage3-candidate-4096-v1'
const VERSION = SEMANTIC_FIXTURE_VERSION
const sha = value => createHash('sha256').update(value).digest('hex')
const json = value => `${JSON.stringify(value, null, 2)}\n`
const projectId = 'candidate-fixture-4096-v1'
const chapterId = ordinal => `chapter-${sha(`opaque-source-v1:${ordinal}`).slice(0, 20)}`
const passageId = ordinal => `passage:${JSON.stringify([chapterId(ordinal), 0])}`
const revision = chapter => sha(JSON.stringify([chapter.title, chapter.text]))
const seeds = [0x47a1c293, 0x18d5ef61, 0x703c962b, 0x2ab4d0e7]
const families = [
  ['evacuation rhythm at the flooded quay', '江芜', '船坞涨水时，江芜敲了两慢一快的竹梆，邻人依约离开低地。'],
  ['who kept the borrowed musical instrument', '孟霁', '孟霁离家前把旧琵琶托给门外卖茶的寡妇，三个月后才来取回。'],
  ['the hiding place chosen for the unsigned letter', '叶岑', '叶岑没有把未署名的信带走，而是压在灶台第三块松动的青砖下面。'],
  ['the reason a messenger turned back before dawn', '柳禾', '柳禾走到半山便折返，因为桥边的红灯说明山路已经被落石堵住。'],
  ['what convinced the apprentice that the stranger was genuine', '陶芷', '陶芷见来客把破损瓷杯的两片缺口拼齐，才认定他是师父托付的人。'],
  ['the destination promised after the winter thaw', '沈汀', '沈汀答应等冰层化开就带妹妹去南岸的杏林，那里有父亲种下的树。'],
  ['which humble object concealed the emergency money', '林澈', '林澈将救急的散银缝进旧棉鞋底，外面又补了一层寻常的麻布。'],
  ['why the watchman left one window unlatched', '裴蘅', '裴蘅每夜把西窗留一条缝，是为让送药的孩子不必穿过有人看守的正门。'],
]
const suffixes = ['in the earlier rain journey', 'in the second river journey', 'in the autumn market journey', 'in the last mountain journey']
const plant = new Map()
const cases = []
const usedOrdinals = new Set([1, 2048, 4096, 3901, 4079, 3991, 4057, 4063, 4093])
const addPlant = (ordinal, quote) => {
  const items = plant.get(ordinal) ?? []
  items.push(quote)
  plant.set(ordinal, items)
  return { ordinal, quote }
}
const addCase = (id, group, query, premises, extra = {}) => {
  cases.push({ id, group, query, limit: 8, throughOrdinal: 4096, premises, ...extra })
}
function random(seed) {
  let state = seed >>> 0
  return max => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return Math.floor(state / 0x1_0000_0000 * max)
  }
}
function allocate(next) {
  // Position generation never inspects any selector, candidate set, score or budget.
  for (;;) {
    const ordinal = 2 + next(4094)
    if (!usedOrdinals.has(ordinal)) { usedOrdinals.add(ordinal); return ordinal }
  }
}

const first = addPlant(1, '江芜约好听见三声铜铃便离开码头，若只有两声就继续等候。')
const firstLink = addPlant(1, '蓝绸带的保管人是叶鹭，旁人只能代送，不能替她打开包裹。')
const last = addPlant(4096, '多年后叶鹭来到渡口，随身仍带着姐姐赠送的瓷笛。')
const middle = addPlant(2048, '楚蘅借宿时把药方藏在屋梁空洞内，离开前仍未取回。')
addCase('protocol-first', 'protocol-selection-aware', 'prearranged departure bell count', [first], { positiveRequired: true })
addCase('protocol-last', 'protocol-selection-aware', 'the instrument carried after the long reunion', [last], { positiveRequired: true })
addCase('protocol-interior', 'protocol-selection-aware', 'the concealed prescription after an overnight stay', [middle], { positiveRequired: true })
addCase('protocol-cross-chapter', 'protocol-selection-aware', 'what instrument does the custodian of the blue ribbon later carry', [firstLink, last], { positiveRequired: true, requiresAllPremises: true })

for (let replicate = 0; replicate < seeds.length; replicate++) {
  const next = random(seeds[replicate])
  for (let family = 0; family < families.length; family++) {
    const ordinal = allocate(next)
    const [query, actor, fact] = families[family]
    // Each replica has distinct natural-language event wording, not a queried numeric code.
    const contextual = `关于${actor}的${['雨夜往事', '河岸旧事', '秋市经历', '山中归程'][replicate]}，记录写道：${fact}`
    addCase(`eval-single-${replicate + 1}-${family + 1}`, 'evaluation-fixed-seed', `${query} ${suffixes[replicate]}`, [addPlant(ordinal, contextual)], {
      seed: seeds[replicate], replicate: replicate + 1, family: family + 1,
      positiveRequired: false, expectedAnswerScope: 'Exact predeclared source retrieval only; generated answer unverified.',
    })
  }
}
const multiRandom = random(0x51c320a9)
const naturalNames = ['江蓼', '许榆', '邵萤', '温荻', '顾芩', '闻溪', '苏棠', '秦葭', '尹萝', '陆萩', '贺芦', '宁荇']
for (let i = 0; i < naturalNames.length; i++) {
  const actor = naturalNames[i]
  const item = ['银簪', '竹笛', '绣袋', '旧扇', '木梳', '石印', '草鞋', '铜镜', '茶碗', '布伞', '玉扣', '香囊'][i]
  const courtyard = ['清棠小院', '荷风小院', '疏梅小院', '竹影小院'][i - 8]
  const finalRefuge = ['西岭', '北亭', '柳湾', '芦洲'][i - 8]
  const firstOrdinal = allocate(multiRandom)
  const secondOrdinal = allocate(multiRandom)
  const premises = [
    addPlant(firstOrdinal, `把${item}留在井旁的人叫${actor}，街坊只记得她当时披着灰斗篷。`),
    addPlant(secondOrdinal, i >= 8
      ? `${actor}后来独自去了芦湾，借住在${courtyard}，直到院子改作学堂的那天仍未离开。`
      : `${actor}后来独自去了芦湾，借住在染坊后院，没有前往亲戚家的茶馆。`),
  ]
  if (i >= 8) premises.push(addPlant(allocate(multiRandom), `${courtyard}在霜降后改作学堂，当时所有借住的人都搬到了${finalRefuge}。`))
  addCase(`eval-multi-${i + 1}`, 'evaluation-fixed-seed-multi', `${i >= 8 ? 'final refuge after the school conversion' : 'later shelter'} of the grey cloaked person who left the ${['hairpin', 'flute', 'embroidered pouch', 'folding fan', 'comb', 'stone seal', 'sandals', 'mirror', 'tea bowl', 'cloth umbrella', 'jade clasp', 'perfume sachet'][i]} beside the well`, premises, {
    seed: 0x51c320a9, requiresAllPremises: true, positiveRequired: false,
    fixtureJoinOracle: { item, person: actor, residence: courtyard ?? '染坊后院', finalRefuge: finalRefuge ?? null, scope: 'Controlled planted facts only; production answerability remains unverified.' },
  })
}
addCase('eval-late-3901', 'evaluation-fixed-position-late', 'how the traveler remembered the route without written directions', [addPlant(3901, '夏蘅沿途把绳结分别系成圆环和十字，靠触摸它们记住夜行时的转弯方向。')], { positiveRequired: false })
addCase('eval-late-4079', 'evaluation-fixed-position-late', 'the quiet sign that the absent ferryman had returned', [addPlant(4079, '久未露面的船夫回来后，只在空船头放下一篮青李，邻居见了便替他点起炉火。')], { positiveRequired: false })

const exactQuote = '迟来的验货簿只登记了封条 QV-7329，颜色是绛紫，不是旧册中的浅青。'
const clueQuote = '月亮落到残桥背面时，唐汀才把油灯移上石阶，接应的人一直等着这个动作。'
const overlapQuote = '霍苇将船契夹在竹帘内侧，留给隔日来访的木匠取走。'
const secondClueQuote = '祁萝把补过的青布鞋放在门槛上，表示伤者已能独自走路。'
addCase('local-late-exact', 'local-channel-regression', 'QV-7329', [addPlant(3991, exactQuote)], { positiveRequired: true, sourceKind: 'passage', explicitCodeException: true })
addCase('local-late-clue', 'local-channel-regression', '残桥灯火接应', [addPlant(4057, clueQuote)], { positiveRequired: true, sourceKind: 'clue' })
addCase('local-clue-passage-dedup', 'local-channel-regression', '竹帘船契 木匠取件', [addPlant(4063, overlapQuote)], { positiveRequired: true, sourceKind: 'either' })
addCase('local-late-clue-second', 'local-channel-regression', '复健归家暗记', [addPlant(4093, secondClueQuote)], { positiveRequired: true, sourceKind: 'clue' })
for (const [id, query] of [['negative-1', 'the orbital reactor activation password'], ['negative-2', 'the submarine treaty signed by the queen'], ['negative-3', 'the lunar laboratory experiment outcome'], ['negative-4', 'the interstellar court verdict']]) {
  addCase(id, 'negative-synthetic-construction', query, [], { positiveRequired: false, sourceTruth: 'not planted in this closed synthetic fixture; not a product absence claim' })
}

const actors = ['阿宁', '青禾', '砚舟', '听雪', '望川', '知微', '照川', '怀瑾']
const places = ['木桥', '茶棚', '旧驿', '河堤', '松林', '石阶', '集市', '南街']
const chapters = Array.from({ length: 4096 }, (_, i) => {
  const ordinal = i + 1
  const actor = actors[i % actors.length]
  const place = places[Math.floor(i / 8) % places.length]
  const intro = `${actor}经过${place}时天色尚早。铺子外摆着${ordinal + 7}只待修的竹篮，掌柜请路人暂借一点地方。${ordinal % 17 === 0 ? '她在账旁画了一只🦉，又添上雨云🌧️。' : ''}`
  const facts = (plant.get(ordinal) ?? []).join('\n')
  const text = `${intro}\n${facts ? `${facts}\n` : ''}暮色降下后，众人各自整理行囊，没有把听来的传闻写成已经发生的事实。值夜人将门前碎石扫到墙边，约定次日再核对交接清单。`
  assert.ok(text.length > 0 && text.length < 1200 && !/^\s|\s$/u.test(text))
  return { id: chapterId(ordinal), title: `${place}杂记`, text }
})
const source = (ordinal, quote) => {
  const chapter = chapters[ordinal - 1]
  const start = chapter.text.indexOf(quote)
  assert.ok(start >= 0 && chapter.text.indexOf(quote, start + 1) === -1)
  return {
    projectId, chapterId: chapter.id, ordinal, revision: revision(chapter),
    start, end: start + quote.length, quote,
    passageId: passageId(ordinal), passageStart: 0, passageEnd: chapter.text.length,
    passageQuoteSha256: sha(chapter.text),
  }
}
const clueSpecs = [
  [1, first.quote, '码头旧约', ['出发钟声']],
  [4057, clueQuote, '残桥灯火接应', ['等候约定']],
  [4063, overlapQuote, '竹帘船契', ['木匠取件']],
  [4093, secondClueQuote, '归家暗记', ['复健归家暗记']],
]
const clues = clueSpecs.map(([ordinal, quote, label, aliases], i) => {
  const anchor = source(ordinal, quote)
  return { id: `fixture-clue-${i + 1}`, chapterId: anchor.chapterId, sourceRevision: anchor.revision, start: anchor.start, end: anchor.end, quote, label, aliases }
})
const project = { id: projectId, title: '候选语义检索固定工程语料', chapters, clues }
for (const item of cases) {
  item.throughChapterId = chapterId(item.throughOrdinal)
  item.premises = item.premises.map(premise => source(premise.ordinal, premise.quote))
  item.answerability = 'unverified'
}

// A mock vector is an exact fixture-oracle lookup, never a language model or hash-semantic claim.
const dimensions = 128
const axesByPassage = new Map()
const queryVectors = []
let axis = 0
for (const item of cases.filter(item => item.group.startsWith('protocol') || item.group.startsWith('evaluation'))) {
  const axes = []
  for (const premise of item.premises) {
    if (!axesByPassage.has(premise.passageId)) axesByPassage.set(premise.passageId, axis++)
    axes.push(axesByPassage.get(premise.passageId))
  }
  queryVectors.push({ caseId: item.id, query: item.query, axes: [...new Set(axes)] })
}
assert.ok(axis < dimensions - 1)
const controlledVectors = {
  dimensions, passageAxes: [...axesByPassage].map(([id, index]) => ({ id, axes: [index] })), queryVectors,
  irrelevantPassageAxes: [127], negativeQueryAxes: [126], localRegressionQueryAxes: [126],
  semantics: 'Sparse unit axes padded to 128 dimensions; a multi-premise query uses one coordinate per relevant passage. Normalize before cosine if desired. Every irrelevant passage is orthogonal. Look up by exact current source identity plus body, not substring or fixture IDs inside text.',
  sourceValidationRequired: true,
}

const newFirstQuote = first.quote.replace('三声铜铃', '四声木哨')
const editedFirstChapter = { ...chapters[0], text: chapters[0].text.replace(first.quote, newFirstQuote) }
const newLastQuote = last.quote.replace('瓷笛', '竹笛')
const editedLastChapter = { ...chapters[4095], text: chapters[4095].text.replace(last.quote, newLastQuote) }
const mutation = (name, before, after, oldQuote, newQuote) => ({
  name, chapterId: before.id, beforeRevision: revision(before), afterRevision: revision(after), replacementChapter: after,
  oldQuote, newQuote, newStart: after.text.indexOf(newQuote), newEnd: after.text.indexOf(newQuote) + newQuote.length,
  retainOldClueAnchorsToTestStaleness: true,
})
const mutations = [mutation('edit-first-selected-source', chapters[0], editedFirstChapter, first.quote, newFirstQuote), mutation('edit-last-selected-source', chapters[4095], editedLastChapter, last.quote, newLastQuote)]


export const SEMANTIC_FIXTURE_HASHES = Object.freeze({
  corpus: '6cb8be20910e7d313f4ebed5756f0048301cf74ed1a01472c117e4605b524b5a',
  cases: '8b58cbb85e41ddd3d69df99c2af3c17c649b039358370aecadd4661033b947d4',
  vectors: 'f5af160a990212bb927159ec66d4c20e91ce79ef37ea6b1cfbcf880a401959dc',
  mutations: '73f823065e7619bdaf19c603138253488af255897646f417b79cf9ee8683ab72',
})
assert.equal(sha(json(project)), SEMANTIC_FIXTURE_HASHES.corpus)
assert.equal(sha(json({ version: VERSION, offsetUnit: 'UTF-16 code units', cases })), SEMANTIC_FIXTURE_HASHES.cases)
assert.equal(sha(json(controlledVectors)), SEMANTIC_FIXTURE_HASHES.vectors)
assert.equal(sha(json({ version: VERSION, mutations })), SEMANTIC_FIXTURE_HASHES.mutations)

/** Fresh copies prevent mutation cases from contaminating later queries. No file or network I/O. */
export function createFrozenSemanticFixture() {
  return structuredClone({ version: VERSION, project, cases, controlledVectors, mutations, hashes: SEMANTIC_FIXTURE_HASHES })
}
