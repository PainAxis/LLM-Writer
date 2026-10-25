# Planning Contract v1：精确修订的规划上下文

[English](writer-campaign-planning.md) | [简体中文](writer-campaign-planning.zh-CN.md)

**仅离线 fixture。规划意图不是已成立的正文事实。** 本轮在 [Campaign 持久基础](writer-campaign-foundation.zh-CN.md)和 [v2 存储核算](writer-campaign-storage.zh-CN.md)上增加可复用的生产校验／上下文边界。固定中英文响应用于执行这条路径，不是自主创作决策。语义一致性、自主小说创作和全书审计仍为 **NOT RUN**。

## 体验有界生产路径

打开 `/#/campaigns`，明确选择“中文规划案例（3 章）”或“English planning fixture (3 chapters)”。旧的小型案例保持独立且不变。新注册 profile 为 `planning-contract-v1-three-chapter`；单独测量的容量 profile 为 `planning-contract-v1-compact-60`。规划 profile 命名空间中的未知版本直接拒绝，不退回旧版无结构正文解释。只有这两个固定工作负载已注册：合同的 60 章上限不是任意 N 的创建／导入接口。每个 fixture 的正文目标等于其冻结短正文的精确 scalar 数，不是旧版百万 scalar 目标。

创建、重开不会自动执行。每次明确点击“一步”至多推进一个持久任务：

1. 大纲。
2. 人设，依赖大纲。
3. 细纲，依赖大纲和人设。
4. **全部**三份章纲，每份依赖三个全局规划产物。
5. 按章顺序处理短正文 fixture；每章依赖全部规划，后续章还依赖紧邻上一章正文。

九个任务不是九次自主写作决策，固定短正文也不是百万字符小说。[长篇最终验收](writer-agent-longform-acceptance.zh-CN.md)仍要求中英文各一部 1,000,000 正文 Unicode scalar 的作品，并分别完成独立审计。

### 章节上下文只读预览

全部章纲接纳后，可选择任意章节编译精确本地上下文。选择调用生产 `previewPlanningContext(campaignId, chapterOrdinal)`，不调用 adapter；它进行有界的新鲜核验读取，并在返回前检查来源／head fence。不预留或派发请求，不保留响应，不保存正文。

预览显示所选不可变章节地址、精确来源修订／hash、canon-base／full-plan root、范围、digest 和实际 UTF-8／UTF-16 大小。可展开 packet 以转义纯文本在本地只读显示。其 purpose 固定为 `planning_preview`，不是 `body_fixture_dispatch`。第一章正文不存在时选择第三章，不会捏造上一章正文依据，也不会使第三章可越序执行。`nextEligibleBodyTaskId` 是独立计算的当前可执行正文任务，或 `null`。

规划缺失、待接纳或失效，未知 profile，来源改变，运行时／来源身份过期，取消、超时或不支持的上下文，都明确拒绝而非显示部分就绪。重新读取、执行、停止或切换 Campaign 会清除已有预览；较新的章节选择和卸载会阻止旧异步结果覆盖界面。编译期间核查跨页签变化；已经显示的 packet 不是持续授权。后续正文步骤始终重新计算资格并编译不同的派发 packet。

## 结构校验涵盖什么

四个规划阶段在既有不可变 artifact 的 text 中保存 canonical JSON。封闭的 `campaign-plan-v1` envelope 恰含 `protocol`、`stage`、`language`、有序精确 `dependencies` 与阶段专属 `payload`。正文保持纯文本，JSON 字段和规划材料不会计入正文进度。不新增持久记录类型或迁移，不改变既有 v2 计数／hash。

封闭记录包括题材规则、较丰富的 lore 实体、作者声明的世界规划事实、剧情承诺、起初冻结的刻意开放线索、人物、状态、认知状态、转变、情节 beat、伏笔义务、章节条目与场景。引用由精确 artifact 身份、记录类型和稳定 ID 组成，不是路径、URL、模糊名称或声称存在的正文引文。self 引用只在当前 payload 中解析；ancestor 引用须指向精确且可用的已接纳祖先修订。

校验覆盖已知字段／类型、canonical 拼写、合法 scalar、ID 唯一性、精确引用类型／修订、完整声明前提边、章节分配、因果顺序、必需场景动作和披露计划。lore／fact 邻接允许环；因果前驱不允许环。畸形或未来版本、重复 JSON key、正文包裹、过期引用和不支持的形状明确拒绝，不自动修复。

V1 仅支持线性叙事顺序上的章末转变。第 K 章末转变须由 K 的最后一个 beat 支持，旧状态在 K 全章有效，新状态从 K+1 开始。同章学习后立刻使用、非线性故事时间推断、没有下一章的终章转变均不获认证。没有认知行表示未建模知识，不代表可获取所有世界事实。规划中的 `knows` 是声明，不是正文已建立该知识的证据。

语义矛盾但结构有效的声明仍可能通过结构校验。这里不判断推断真伪、动机是否可信、未声明线索、实际正文剧透、文学质量或连续性，也不把规划引用转换为已成立正文事实锚点。


状态／认知校验针对明确声明的引用。仅列 cast 的场景、未引用的过期状态区间、能力支持的含义或未声明的知识使用，都不证明人物状态已完整覆盖。认知声明可以涉及历史事实或角色所信之事；类型本身不宣称它与当前世界事实同时为真，也不判断信念是否错误。这些未建模语义保持未审。 认知／叙述者的 current／future／past 分区是作者规划的时间表，不是对读者的披露许可；`readerVisibleFactRefs` 仅按世界事实声明的 `readerNotBefore` 确定，绝不将认知声明的 subject 提升为事实真值。

## 确定且有界的上下文

canon-base root 绑定合同、manifest 及有序精确大纲／人设／细纲 refs。full-plan root 进一步绑定每份已接纳章纲。完整 full-plan root 形成前，不允许正文请求。替换任意章纲会使所有正文失效；替换全局规划还会使其后代失效。规划替换是明确的候选编辑，不是语义修复；新 profile 拒绝正文替换，旧 profile 的行为不变。

章节和正文 packet 包含**完整全局规划 canon**：三个全局 payload、精确 refs 与 root，整体序列化上限单独为 **32,768 bytes**；还包含可用的所选章完整章纲、确定的声明引用闭包，以及明确的规划／人物认知／读者披露分区。不包含其他章纲全文；其精确 refs／full-plan root 只是身份绑定，不表示已供应叙事内容。范围为 `complete_global_planning_canon_and_selected_chapter`，明确报告未包含章纲数量。

闭包行使用封闭结构 `{container, recordKind, recordId}`，指向 packet 内已完整提供的 payload。`early_outline`／`early_character_bible` 分别绑定 `earlyPlanning.outline`／`earlyPlanning.characterBible` 与精确的 `sourceRefs[0]`／`[1]`；`global_outline`／`global_character_bible`／`global_detailed_outline` 分别绑定对应完整全局 payload 与精确的 `globalCanon.sources[0]`／`[1]`／`[2]`。编译器检查 payload 存在、记录类型合法、记录确实属于该 payload，以及来源身份完全一致，才省略行内重复 artifact ref。这只减少重复 wire 元数据，不删除记录、前提、payload、root、source ref 或 scope。

正文 fixture 派发如有上一章则包含其完整正文，但整个 packet 必须容纳得下；不能改用尾部或摘要。其正文范围最多只有上一章，不是完整已实现世界记忆。纯规划预览没有已成立正文依据。角色披露或容量冲突会拒绝，不泄露、不截断、不以排序删除必需材料，也不暗中降低目标。

`declaredReferenceCoverage: complete` 仅指已登记的引用。`semanticCompleteness: not_reviewed` 和独立的已实现正文覆盖标记，防止把它误认为语义完整。分区标签不证明生成模型不会泄露未来信息。

| 阶段 | 最大 prepared input | 最大 response text |
|---|---:|---:|
| 大纲 | 12 KiB | 8 KiB |
| 人设 | 20 KiB | 16 KiB |
| 细纲 | 48 KiB | 32 KiB |
| 章纲 | 56 KiB | 6 KiB |
| 正文 fixture | 64 KiB | 64 KiB |

上限针对精确序列化文本，包括 key、转义和 refs；较严格的聚合上限优先，单项最大值不承诺能同时装入。活动规划总量上限 512 KiB，最多 512 个规划记录、2,048 条引用边，每 payload 深度 12、JSON 节点 16,384。这些是 byte／结构上限，不是 provider token 或质量估计。

## 仓库强制校验与持久恢复

可复用编译器在预留前执行。仓库在 reserve 时，从注册 profile 和精确历史／当前来源视图独立重建**整个** prepared-input 字符串，而不是相信攻击者提供的匹配 digest 或貌似完整的 source list。阶段响应预留必须等于该阶段实际上限。接纳和替换校验精确保留的规划文本，不以归一化重写响应。历史 replay 根据当时活动的来源校验已接纳 payload 和请求输入，而非仅使用最终索引。

action-private exact-raw proof reuse 仍只是已核验状态的优化，不可跳过新的 typed validation。read-local 规划对象有界且在读取后释放，没有持久 canon 缓存或跨读取信任缓存。新生产模块与冻结 profile／prompt 都计入 Campaign core-source identity。旧构建仍可检查，但不会因此获得变更后身份下的执行权限。

既有持久 dispatch intent 仍是唯一派发授权点。有界无效响应可作为未接纳证据留在本地，但不接纳、不 settlement、不计数；仅保存恢复使用同一校验器，不再次调用。未知 intent 不因 fixture 可确定性重算而重发。CAS、operation receipt、接纳／settlement 原子性、取消竞态和旧候选存储义务不变。

保持既有 128 task、64 MiB W+U+P、1 MiB 单记录、3 秒 IO、5 秒 fixture 派发与 10 秒 action 上限。编译检查当前 action 的取消／deadline，不另起一份额度。超时／拒绝是验收失败，不能称作规模表示成功。

## 验证与证据边界

新 profile 的验收独立于既有 Campaign 12 例、author-Agent 90 例、原生存储边界和历史百万 scalar 几何 profile。新证据须包括：

- 封闭 wire、身份、调度、闭包、确定 packet／digest 和精确字节边界测试。
- 底层仓库绕过、历史 replay、规划替换／正文替换拒绝、取消、未知 intent、有效／无效仅保存恢复、原子性和 ACK 丢失测试。
- 中英文三章／九任务生产构建原生 IndexedDB 流程，含规划冻结、只读预览、reload／进程重开和过期来源。
- 注入 IO Node 与原生 IndexedDB 各运行中英文紧凑 N=60：123 个真实已提交任务，每章短正文最多 256 scalar，精确 receipt／计数，冷重开身份，W/U/P 和实测读写／时间。只有几何证明不算通过。
- 既有回归、严格 type／lint／build、独立 exact-tree review、必要 exact-head CI 和合并后 main 验证。

本文描述范围和门槛，本身不是测试结果。完成的运行与失败须各自报告精确 source／harness／profile 身份及分母。紧凑 typed-plan profile 不能替代未变的旧版百万 scalar 存储运行，更不能替代最终文学验收。

生成 packet、正文、备份、原始 trace 和可重构请求／响应存储留在本地。只有获准的封闭无来源派生报告可归档；未知报告字段拒绝，原始异常／片段／路径不复制。普通 Writer 备份／恢复仍不包含 Campaign。不新增真实模型、密钥、API 配置、外部工具、Writer 修改、用户材料导入、抽取／审计／修复循环或任何新的披露权限。
