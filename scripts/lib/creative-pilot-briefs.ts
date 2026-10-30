/** Synthetic positive corpus frozen by the approved v4 design. No production imports. */
export type CreativeFixtureId = 'zh01' | 'zh02' | 'zh03' | 'en01' | 'en02' | 'en03'
export interface ControlBrief { protocol: 'creative-brief-v1'; language: 'zh' | 'en'; premise: string; constraints: string[] }
const literals: readonly { id: CreativeFixtureId; brief: ControlBrief }[] = [
  {
    "id": "zh01",
    "brief": {
      "protocol": "creative-brief-v1",
      "language": "zh",
      "premise": "沿河小城的修伞师林芦发现，邻居们都把一把没人认领的蓝伞说成自己的。她必须在旧桥封闭前决定怎样归还它。",
      "constraints": [
        "故事发生在一天内，不使用魔法、暴力或犯罪阴谋。",
        "争议通过可观察的日常细节推进；人物不能凭空知道别人没有说出的事。",
        "蓝伞必须影响最后的公开决定；保留林芦与姐姐之间一个未解决的小分歧。"
      ]
    }
  },
  {
    "id": "zh02",
    "brief": {
      "protocol": "creative-brief-v1",
      "language": "zh",
      "premise": "高原温室的维护机器人禾七只剩够灌溉两片苗床的水，却收到保护第三片实验田的旧指令。年轻农技员索南要求它先解释每一种选择会牺牲什么。",
      "constraints": [
        "采用有限视角，不安排全知旁白或突然到来的补给。",
        "用三个章节呈现一次资源分配决定及其不可逆代价。",
        "机器人的能力受现有传感器和工具限制；沟通不能立刻消除所有分歧。"
      ]
    }
  },
  {
    "id": "zh03",
    "brief": {
      "protocol": "creative-brief-v1",
      "language": "zh",
      "premise": "旧港口茶馆的琴师阿澄发现庆典曲谱少了一页。她循着一只磨损的木谱夹，拜访曾在茶馆排练的三个人。",
      "constraints": [
        "这是没有超自然事件的历史日常故事，不使用谋杀情节。",
        "木谱夹在开头出现，并在后文提供与缺页有关的具体线索。",
        "让一段误解得到解释，但不要让所有人物达成相同的艺术选择。"
      ]
    }
  },
  {
    "id": "en01",
    "brief": {
      "protocol": "creative-brief-v1",
      "language": "en",
      "premise": "Mara, a linguist in a small undersea habitat, must negotiate access to a damaged acoustic archive with the engineer who thinks opening it will erase the only surviving record of his mentor.",
      "constraints": [
        "Communication with the surface is unavailable; no rescue fleet or new technology arrives.",
        "A sound introduced in the first chapter must acquire a different supported meaning later.",
        "Keep the viewpoint limited and distinguish what the archive contains from what either person believes it contains."
      ]
    }
  },
  {
    "id": "en02",
    "brief": {
      "protocol": "creative-brief-v1",
      "language": "en",
      "premise": "At a provincial Regency botanical exhibition, a meticulous widow and an improvised young gardener both claim responsibility for a rare plant that has bloomed under the wrong label.",
      "constraints": [
        "Write a domestic comedy without supernatural events or a villain who explains everything.",
        "Their motives should differ even when they cooperate.",
        "A promised public decision must occur in the third chapter, while one minor social tension remains open."
      ]
    }
  },
  {
    "id": "en03",
    "brief": {
      "protocol": "creative-brief-v1",
      "language": "en",
      "premise": "A Martian courier carrying two undeliverable messages reaches a relay station with enough power to preserve only one. The station keeper refuses to choose until the courier explains why both destinations have vanished from the schedule.",
      "constraints": [
        "Use a sparse cast and a concrete, unchanged power limit.",
        "Do not solve the dilemma with an unexpected ship, unlimited backup, or secret duplicate.",
        "Resolve the immediate delivery decision while leaving a secondary question about the station keeper open."
      ]
    }
  }
]
/** Return detached values; callers cannot change the frozen corpus by alias. */
export function creativePilotBriefs(): { id: CreativeFixtureId; brief: ControlBrief }[] { return structuredClone(literals) as { id: CreativeFixtureId; brief: ControlBrief }[] }
