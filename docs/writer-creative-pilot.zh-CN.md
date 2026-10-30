# 任意简报到三章正文 — Creative Pilot v4

[English](writer-creative-pilot.md) | [简体中文](writer-creative-pilot.zh-CN.md)

状态：本地实现与离线就绪验证中。本文不代表尚未执行的准确 head CI 已通过，也不批准外部供应商、密钥传输、付费运行或公开正文数据。

## 实际创作链路

Campaign Lab 接收作者自行填写的中文或英文简报，不是让作者从固定故事中选择。一次明确授权推进固定顺序：**大纲 → 人设 → 细纲 → 三份章纲 → 三章正文**，共九次终身请求，无重试、修复、额外章节或隐藏工具调用。

每章正文依赖全部六份已接受规划与所有已接受前章正文。第三章实际收到第一、二章的完整原文，不用摘要、哈希或截断窗口冒充。测试端点根据真实 SDK 请求动态构造合成响应；生产代码不导入测试故事或响应配方。

默认应用**没有调用 host**：可以准备和检查简报，但 Start 禁用，engine 也独立拒绝调用。只有显式安装的不透明离线控制 host 能调用真实有界 SDK，目标限制为 loopback。URL 参数、localStorage 和保存的 Campaign 均不授予 host。这是可运行的离线纵向链路，不是发送真实小说给供应商的授权。

## 作者操作和披露

- **Prepare** 创建新的 Campaign v4，持久保存精确简报，并确定 15 分钟有效期；编辑草稿不创建 Campaign 或调用。语言固定。
- **Replace brief** 只允许在首次请求预留前明确替换一次，生成新候选与来源身份，撤销旧预览，不延长有效期或补回额度。任何已花费或未知预留都不能被改名为新九次运行。
- **Dry prepare** 展示精确 system/prompt、来源身份、实际提供／省略清单及端点／模型状态，零模型调用。编辑、切换选择和 Stop 撤销预览与同意。
- **Start** 须针对当前候选与固定范围重新明确同意：未来步骤会自动传输新生成的规划和全部已接受前章正文；未来文字尚未产生，不能假称作者已预览这些文字。
- **Stop** 撤销本实例的创作权限；**Resume** 是另一项明确操作，不重置原请求期限或已花费额度。刷新只检查，不自动恢复。
- **Resolve retained** 仅本地核验／接纳，不调用 SDK、不自动进入下一任务。**Close without publication** 可结清已知响应，但不把有效文字伪称编译失败。**Cancel** 持久取消，不能撤回已发请求或抹去未知义务。

规划意图不等于已实现正文证据或角色知识。输入区分作者专有／读者可见事实、按时间划分的角色／叙述者状态、适用伏笔义务与转折，以及真实前章正文。正文输入提供完整全局 canon 和当前所选章纲；另外两份章纲文本明确列为省略，其引用及 full-plan root 不表示已提供这些文字。没有新增检索、事实图写入、审计循环或修复循环。

## 原始响应、具名编译和只读审阅

实际 SDK HTTP body 在 intent 前经过检查并绑定哈希。完整有界响应先持久保存，再判断内容，包括无效规划 JSON、无效 scalar 或非正常结束。无损可见文字表示能保留孤立 surrogate，随后明确拒绝。HTTP 原始字节、headers、密钥和隐藏 reasoning／tool 内容不持久保存；隐藏内容只投影为封闭异常标记。

规划响应采用具名封闭 schema。确定性编译器将 catalog token 解析为精确来源身份，应用既有规划语法和 canon／时序规则，保留原始到派生产物的关联。派生展开先检查对应阶段字节上限，再调用未改动的旧解析器；超限为 `compiled_capacity`，不是截断或偷偷放宽旧限制。正文原样保存，计数仍为 `crlf-lf-nfc-scalar-v1`。

返回模型和用量证据来自有界、fatal UTF-8、拒绝重复键的兼容 HTTP JSON 的实际字段，不采用 SDK 默认补值；缺失计数为 null，不是零。模型缺失／不匹配、隐藏 reasoning／tools、无效内容结构、非 stop 结束和编译失败均保留为拒绝结果。离线 partial／unavailable 用量不能证明真实成本上限。所有已接受产物的语义状态仍是 **not reviewed**。Lab 显示原响应、规划／正文、身份、拒绝、未知义务和最后核验的预算，不把文字写入普通 Writer 小说。

## 持久调用与有限预算

V4 在普通 Campaign head 下建立新聚合，使用独立 `v4:` 不可变子记录和既有 32 Campaign catalog。它不迁移 v2／v3、不藏入 v2 字段、不新增第二份存储额度。旧 API 和限制不变，旧 writer 不能靠 stale CAS 覆盖 v4 head。

状态为 `reserved → dispatch_intent → [outcome_unknown] → response_retained → resolved`。只有新鲜、明确成功的 winning intent CAS 才允许派发一次。回放 receipt、未知 ACK、刷新或保存 JSON 都不给调用权限。核验为 reserved／无 intent 的原预留只能在原准入与期限内继续；intent／unknown 永不重放。重复 Start 共用同一在途 Promise。Stop／Cancel 后已知完整响应仍可在原 owner 的结算期限内保留，但不能发布或进入下一章；独立恢复另占有限 metadata slot，不重新授予生成权限。

| 限制 | V4 合同 |
| --- | --- |
| 简报合计 | 1,024 UTF-16 units／4,096 UTF-8 bytes；0–8 项约束 |
| 每章目标／接受范围 | 512／256–1,024 canonical scalars |
| 原始正文 | 2,048 UTF-16 units／8,192 UTF-8 bytes |
| 各阶段已准备输入 | 12／20／48／56／64 KiB |
| 实际 HTTP 请求／响应 | 各 64 KiB |
| 原始及派生规划 | 大纲 8 KiB；人设 16 KiB；细纲 32 KiB；每份章纲 6 KiB |
| SDK 输出 | 每次 4,096 tokens；九次共预留 36,864 |
| SDK／阶段 owner | 30 秒／60 秒，固定原期限 |
| V4 完整核验读／mutation／metadata owner | 总计 10 秒；每次实际 IO／CAS 等待最多 3 秒 |
| Metadata | 创建、一次替换、最多三次独立恢复、一次受保护 Cancel |
| Active 预留 | 最多 600,000 ms；正常成功预留 550,000 ms |
| 存储 | 单一 64 MiB `W + U + P`；保护恢复初始 524,288 bytes |
| 每请求存储预留 | 1,900,544 bytes；只有已证明终局才释放未用 U |
| 账本／读取 | 最多 48 operations；173 条已存记录加缺失后继；每批最多 33 keys |

字节／UTF-16 **不是输入 tokens**。输入 token 预留为 null，enforcement 为 `not_enforced_offline_control`，没有暗示真实输入 token 或金额已被封顶。独立 Campaign SDK 策略不改变普通 API 的 1,200-token 限制。temperature 0.7 在实际 HTTP 字符串检查，不进入只允许整数的 Campaign canonical 对象。

每次完整读取重新核验不可变记录、依赖图、编译结果与守恒，再逐项栅栏检查所有观察到的原始行及 catalog／head／缺失后继，不信任调用方 map 或重启前缓存。V4 明确的 10 秒核验操作不是“旧 3 秒读取变快”的声明。取消、挂起 hash 和迟到 ACK 仍受原 owner 限制，不重置计时器或产生后台执行授权。

## 分开验收

冻结计划区分六个 Node Campaign（54 次真实本地 SDK 任务）、两个真实 built-App／原生 IDB Campaign（18 次任务）、24 个 compiler controls、6 个 metamorphic controls、63 个 ACK cuts、20 个 engine controls、16 个 App interruptions 和 16 个 report／archive controls。组件测试不计为真实 App。原生／App 仅在授权 CI 执行；既有兼容性与性能门槛全部保留，新 pilot 成功不能豁免旧失败。

新增 archive 恰好包含 `node-summary.json`、`browser-summary.json`、`manifest.json`，只有封闭有界身份、计数、结果与哈希，不含简报、prompt、正文、响应、原始存储、备份、截图或自由文本诊断。原始失败 map 私下保留用于诊断，保留未知请求身份和未结清责任。

本切片补齐短程自主“规划到正文”链路，不验收文学质量或百万字符小说。真实 pilot 仍须另外确定精确端点／模型、密钥通道、真实作者简报／语言、请求／输出 token 上限、可执行的输入 token 与金额限制，以及传输所披露／生成文字的授权；随后审查实际三章及规划／正文一致性。离线结构通过不能替代文学审查。扩展长篇还需要全书一致性覆盖、有界修复和资源校准，才能验收两部自主百万字符小说。
