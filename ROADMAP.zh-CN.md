# LLM-Writer 路线图

[English](ROADMAP.md) | [简体中文](ROADMAP.zh-CN.md)

当前实现布局见[目录结构](PROJECT_STRUCTURE.zh-CN.md)，已发布变更见[更新日志](CHANGELOG.md)。

已完成的基础工作：

- PR/main CI 执行零警告 lint、类型检查、生产构建、动态聚合的冒烟测试和使用合成数据／服务的生产构建 Chromium 套件，包括超长篇压力与明确授权的全范围扫描。单独配置的 `ci-memory-support` 门槛和新增 20 场景 `ci-memory-novel-scan` 门槛须分别通过当前修订验收；已配置场景不代表已运行通过。
- main 规则集已强制要求 GitHub Actions 的 `ci-quality`、`ci-browser` 检查通过，并要求分支与 main 保持同步。
- ShortStory 的文章、故事、续写和优化已有独立生成作用域，覆盖取消、重启、清空、关闭对话框和页面卸载。
- BookAnalysis、NovelManagement 和 ToolsLibrary 的生成请求已有独立作用域，覆盖停止、来源变更、关闭对话框和卸载，并移除了工具页的模拟进度定时器。
- undici 补丁已包含在 [v1.0.0](https://github.com/PainAxis/LLM-Writer/releases/tag/v1.0.0) 中；发布产物包含静态 ZIP、校验和及源码/CI 信息。
- 全部视图已使用 TypeScript，`vue/block-lang` 对 `src/views` 统一要求 `lang="ts"`；管理数据、表单引用和历史日期具有明确类型。四个功能的 Workspace 控制器也已完成类型迁移。
- 思维导图支持标题与条目编辑、增删和排序，校验后保留已有正文与元数据、调整关联、拒绝过期快照并等待保存完成；详见[编辑协议](docs/mindmap-editing.md)。
- 助手可跟随全局或使用独立上下文策略，配置、发送、摘要和重试统一选择策略；旧助手继续跟随全局，完整会话和备份兼容保持。详见[策略说明](docs/assistant-context-policy.md)。
- 助手消息列表使用按实际高度测量的虚拟滚动；阅读旧消息时保持位置，完整会话仍用于上下文和备份。
- 语料统一存于每部小说的 `corpusData`；Writer 支持旧版 JSON 导入、独立语料导出，校验后等待原子保存。详见[语料数据说明](docs/corpus.md)。
- 思维导图跟随亮色、暗色和系统主题；切换时保留编辑图与草稿，PNG 导出使用当前背景。
- 两个写作目标入口已统一持久化、备注/历史与本地日历活动连续天数。ShortStory 和 BookAnalysis 已拆为有明确类型的功能组件，编辑器和生成控制器由页面持有；开发依赖补丁也已完成。

最后四项可靠性收尾工作已完成：

- 所有入口统一初始化和迁移提示词，保留用户模板与删除结果；存储数据损坏时明确报错，并保留原数据。
- 提示词、API/配置、题材与助手管理完成存储提交后才提示成功；失败保留原状态或草稿，支持重试。
- 小说与写作目标支持跨标签页提交协调。不同作品的修改独立合并；同一作品的冲突保留本地草稿，需先复制草稿，再刷新页面、重新打开作品并手动合并。并发目标增量保留各自历史。协调范围限定为小说/目标；详见[持久化协议](docs/persistence-coordination.md)。
- 助手摘要记录覆盖到哪条消息，发送时组合已提交摘要与尚未覆盖的原文；压缩失败或仍在进行时保留上次可用的覆盖范围和完整本地历史。

第一批现有功能修复已经完成：短篇精确选段替换、稳定的章节事件关联、可持久化的拆书参考库，以及独立的 API 草稿测试和模型同步。

第二批功能正确性修复已实现：

- AI 上下文、复制、导出、预览与字数统计共用富文本转换，保留可见正文、实体与段落边界；生成正文先转义再写入编辑器。
- 章节管理同步维护两个总字数字段，旧数据导出按实际正文计算；已命名空语料可独立导出再导回。两个目标入口支持章节单位，非字数进度不混入字数统计，编辑后保留历史单位。
- 拆书按整行识别标题，识别到章节后须明确选择分析章节。批量大纲必须结构完整且数量匹配，无效回答保留供重试；大纲请求不再被无关自动保存打断，润色按字面填入最新原文。
- 工具模板使用所选小说/章节身份与当前表单参数；不兼容模板明确拒绝，保留已保存的提示词库。
- 用量记录按统一请求类型、精确模型 ID 和完整本地日历日筛选，趋势及分布图使用真实记录；没有用量依据的失败请求不虚构 Token 消耗。
- 章节排序/批量编辑占位按钮明确禁用，设置页移除仅提示消息的“测试所有连接”。

回归配置现包含动态聚合的冒烟测试和生产构建浏览器套件，另有单独调用的本地／混合记忆压力测试、全范围扫描容量／浏览器验收及必要的 `ci-memory-support`、`ci-memory-novel-scan` 任务。两个专用套件有意不加入旧 `test:browser` 聚合，以免重复执行；支持检查的 600 章／1,388,902 字符 Memory Lab 与三个 Writer 入口场景，不扩大其冻结的 25 个语义用例分母；候选扫描有独立的[冻结语料和资源边界](docs/memory-novel-scan.zh-CN.md#受控证据与限制)。验证状态以审查提交的 CI 结果为准。实现布局继续维护于[目录结构](PROJECT_STRUCTURE.zh-CN.md)和未发布更新日志。

## 新功能路线

第一阶段已实现：助手中授权作品只读工具、接入远程 MCP 和使用写作 Skills。协议、导入、授权与浏览器业务流程纳入 CI；详见[扩展说明](docs/extensions.md)。

第二阶段保持独立且尚未启动：按章增量保存正文、百万字编辑，以及统一章／卷摘要。第三阶段按下方有限完成契约独立推进；四条工作线与共同验收门槛通过后，开始第四阶段受限创作 Agent。本地 stdio MCP、脚本 Skills 和关页后持续任务仍属于可选运行服务，不是这次转入第四阶段的前置条件。

独立的[第三阶段记忆检索原型](docs/memory-prototype.zh-CN.md)已将关键词、人工伏笔召回与可选语义嵌入、重排结合。外部请求及依据展示前均校验章节版本与披露范围；服务凭据仅保留在会话中，服务失败时明确回退本地检索。未变的已验证来源可复用关键词索引，受影响章节及伏笔可增量更新。焦点／存储失效通知保留已完成的 Worker 基线，但检索前必须重新同步最新已提交来源；详见[增量索引及恢复边界](docs/memory-incremental-index.zh-CN.md)。[超长篇压力测试](docs/memory-stress-tests.zh-CN.md)覆盖最高 1,050 万字符，并另有历史真实 Jina 测试。[事实关系图](docs/memory-fact-graph.zh-CN.md)已增加有原文依据的作者关系与可选已选来源模型提议、Cytoscape.js 展示、精确章节／修订／片段依据和作者审阅。每条前提都必须属于当前已披露原文，作者确认也不能保留过期依据。

实际作品的图谱备份恢复与移动端抽屉导航见[第三阶段收尾说明](docs/graph-backup-mobile.zh-CN.md)。[写作检索上下文](docs/writer-memory-context.zh-CN.md)覆盖章节正文生成、续写与润色，要求逐项选择当前且已披露的依据，可选服务仍需单独启用。这些基础不能单独代表完成；完成依据是下方四轨有限验收。

## 第三阶段完成契约

第三阶段已按以下**四条有限工作线完成工程验收**，不表示任意语义或文学质量已获验证。PR #41 最终 head `29c51daabe4cd058d98746a51404ff622ff58853` 经独立审阅无阻塞，并在 [run 39958416191](https://github.com/PainAxis/LLM-Writer/actions/runs/39958416191) 通过全部十一项必要检查。浏览器压力项一次安装超时取消后只在同一 head 重跑，没有拼接旧 head 结果。实际合并为 `dfc316eb2fc8f376c5ac3c77892b251ba29e6902`，tree `66ec72a608b7cdcd8ac5646bc0fe638ab801b6a9`；[main run 39961172049](https://github.com/PainAxis/LLM-Writer/actions/runs/39961172049) 首次 attempt 十一项全过。main 候选套件再次完成 20/20 组、1,501 次扫描及三次 Writer。[精简交接记录](docs/testing/writer-agent-2026-10-23/stage-three-handoff.json)绑定准确交付身份，[早先功能基线记录](docs/testing/memory-novel-scan-2026-10-22/ACCEPTANCE.zh-CN.md)原样保留历史观察与失败。完整备份只留本地；后续候选附件仅含报告与明确的审阅截图。

验收采用固定、带版本的合成语料和受控服务。模拟输出验证工程行为，不证明一般语义或写作质量。真实模型评估单列；完成本范围没有购买服务或新增凭据。

1. **冷索引、新实例恢复与来源加载。** 在 132 万与 1,050 万字符下建立可复现的前后对照，保持来源、检索结果与预算不变。[历史正文加载对照](docs/memory-capacity.zh-CN.md)已测量来源读取事务开销下降；聚焦的[冷索引改动](docs/memory-cold-index.zh-CN.md)替换重复词频扫描，严格保留 Orama 评分，受控本地对照已记录两档冷构建／新实例重建耗时下降，返回结果不变；PR #38 已合并至 `ed83bfef9903e8870ecf8b2b7ff2f47da6d2b5fc`，其 main CI 已通过。本条有限冷索引范围已完成，后续工作线仍须各自通过共同门槛。验收要求目标冷构建／新实例路径有测得的改善，报告 CPU／内存，并保持恢复、取消、保存失败及已提交来源新鲜度行为。新实例仍须重建；持久化快照和消除所有全库成本不是这条有限工作线的必要条件。
2. **明确授权的全范围语义容量。** 单独主动启用的[全范围扫描](docs/memory-full-range-semantics.zh-CN.md)在本条有限范围内已完成。[PR #39](https://github.com/PainAxis/LLM-Writer/pull/39) 已合并至 `73e730a`，其 [main CI 39822084525](https://github.com/PainAxis/LLM-Writer/actions/runs/39822084525) 已完成且成功。专项合成测试、冻结生产适配器资源测量、回归／浏览器 CI 与独立审阅构成本条验收，不代表后续改动已经验收。它替代此前仅处理本地候选的计划：固定采样和路由实验仍漏掉太多已知必要前提，或依赖乐观的表示假设。默认行为不变：不超过 2,000 片段继续普通语义路径，超出后完整保留本地通道且零嵌入请求，除非明确启用全扫描。明确扫描在任意规模都执行累计预算，先生成零请求计划，再由作者点击开始；使用既有 2,000 条／32 MiB 向量缓存流式处理全部合格已披露原文，展示覆盖并暂停等待决定。使用本地结果会丢弃全部部分语义贡献并停止重排，过期来源不能被当作成功回退。验收要求同向量流式等价、精确来源／全部前提覆盖、如实报告冷热成本，以及失败／生命周期／Writer 检查。合成语料 46/46 查询找回只是工程证据，不验证真实模型语义质量或可回答性。
3. **可选、有引用的语义支持检查。** [已验收并在 PR #40 合并](https://github.com/PainAxis/LLM-Writer/pull/40)，合并提交 `7e2ae7d50c96f59894a8c96c9efb5d53aac4bfb9`：独立审阅无阻塞，准确 head 的十项必要 PR CI 全过，包括完整 52 场景生产构建套件和 Writer 压力测试。[保留的验收证据](docs/testing/memory-support-checks-2026-10-22/ACCEPTANCE.zh-CN.md)区分同 head 的一次 Writer 超时重跑与后续 main 验证；此验收不代表第 4 项完成。先做纯本地预览，再明确开始有界聊天请求，与检索授权分开。独立模型面板针对所选当前、已披露原文区分 `supported`、`insufficient` 和 `uncertain`；失败仍为未验证。原有文字／编号标识保持 `answerability: unverified`，数值评分和新意见都不是置信度或证明。检查不选择或批准 Writer 依据，核对答案／解释也不进入写作提示词或正文。冻结语料包含 25 个语义用例及 8 个操作拒绝用例，并检查正例找回和全部拒答变异；52 场景浏览器门槛另加上述长篇场景，不改变该分母。受控响应验证协议／生命周期，不证明真实模型准确率。获准的真实 Go 代码／文档测试首例在 688 毫秒后因传输失败，余下六例未运行，因此既不是质量结果，也不能证明费用为零；独立观察记录及限制见支持检查说明。
4. **作者启动的全书已披露范围候选抽取。** [已在 PR #41 验收](docs/testing/memory-novel-scan-2026-10-22/ACCEPTANCE.zh-CN.md)，最终 head／main 交付已按上文核实。默认关闭的 A 按确定性序列化输入预算处理全部已披露已保存正文窗口，不抽样不截断；B 另行授权，只检查 singleton、相邻二／三 cue、共享逐字 key 远距 pair 和三 cue 桥接等有限路由。正文全覆盖不等于任意关系完整性。有界 campaign 出处索引、B 独立游标和六维累计预算跨审阅批次保留；512 候选池满后逐条保存／忽略，再用新 segment 继续未完 B，不重发不归零，真实容量跳过保留有范围遗漏。有类型的图谱 v2 `plotLinks` 保留全部 setup／recovery／context 前提与 provenance；v1 只读不写，未来版本拒绝且不覆盖，提议不自动进入 Writer。专项合成证据包括 270 A＋807 B 次派发、四批 1,614 候选；冻结 24 例语料必须同时报告**全故事 12/18、已披露 12/17、合同内 12/12**，不能只报 12/12。132 万几何和 1,050 万准备／一次调用预算暂停测量不是大书全量模型运行。准确基线的生产构建运行已通过 **20/20 组场景**，包括长篇完整 A/B、超过 512 候选的续批，以及三个 Writer 入口的批准完成态和持久化边界。[保留证据](docs/testing/memory-novel-scan-2026-10-22/ACCEPTANCE.zh-CN.md)将本次完整执行与两轮历史部分失败分开，记录实际计数和修订身份。受控服务验证工程行为，不证明真实模型质量。

### 共同验收门槛

- 改稿后排除旧事实，核验每条引用的修订、精确范围与原文。检索、可选外部请求、依据展示和 Writer 使用前均执行披露与未来信息隔离。关系的每条前提都必须通过；确认不能绕过过期或未披露前提。
- 保持明确选择与批准依据。拒绝过期、取消、迟到及被新请求取代的结果；保存／请求失败和并发标签页变更后仍安全。不得用编辑器草稿替代已提交来源验证。
- 使用生产构建运行 Memory Lab → Writer 业务验收，分别覆盖章节正文生成、续写与润色，以及各工作线相关的长范围／超预算检索、可选服务模式、候选审阅与生命周期失败；不得从某一写作入口推定另一入口已覆盖。
- 对照前冻结语料版本与预期安全结果，如实报告语料覆盖、来源／依据检查、漏召回及资源成本，不隐瞒退步。工程通过／失败与单独标注的模型质量观察分开。
- 要求代码审阅无阻塞问题、受审修订的必要 CI 全部通过，并同步中英文范围、复现与限制文档。每个聚焦 PR 只关闭其证据实际覆盖的门槛。

十一项必要任务为 `ci-memory-capacity`、`ci-memory-cold-index`、`ci-memory-full-scan`、`ci-memory-support`、`ci-memory-novel-scan`、`ci-memory-stress`、`ci-memory-browser-stress`、`ci-graph-backup-mobile`、`ci-writer-memory`、`ci-quality` 和 `ci-browser`。功能／测试基线与随后交付 head 分别记录验证身份，不用旧 head 结果拼接成新 head 通过。

中文／代码精确召回及确定性低相关性审阅已经实现，见[专项召回修复](docs/memory-mixed-query-recall.zh-CN.md)与[依据审阅规则](docs/memory-evidence-review.zh-CN.md)。它们支撑四条工作线，但不能代替独立的支持检查验收或全披露正文候选扫描的验收。冷索引与全范围扫描均不能单独代表第三阶段完成。

## 第四阶段入口

上述四轨审阅、准确 head CI 及合并后 main 门槛已于 2026-10-23 全部通过。随后首个[受限作者 Agent](docs/writer-author-agent.zh-CN.md)已在 [PR #42](https://github.com/PainAxis/LLM-Writer/pull/42) 验收，合并提交 `266ca856396c46780512f1293725aeefef4a9bfe`（tree `f78cc175da84023cd73ab6e7afb6dfc0be82de69`）。[main run 39998090341](https://github.com/PainAxis/LLM-Writer/actions/runs/39998090341) 首次 attempt 十二项全过，其中 Agent 18/18 组、90/90 浏览器场景通过。有限闭环仍为**本次明确授权 → 一次严格检索工具计划 → 一次私有已披露来源检索 → 作者逐条批准依据 → 一次草稿 → 可选明确追加／保存**，最多两次模型请求、一次本地工具执行；不是自主长篇系统，也不表示第四阶段完成。

[PR #43](https://github.com/PainAxis/LLM-Writer/pull/43) 已验收[评估就绪](docs/writer-agent-evaluation.zh-CN.md)：八个冻结合成故事任务贯穿实际控制器、检索引擎和 SDK，将 gold 辅助固定选据与人工质量判断明确区分。默认零外部调用，保留漏召回、拒答、故意负例与未运行条目。详细评阅包留本地，可分享摘要不含正文。零真实调用可以完成工具就绪，不能证明真实写作质量。独立审阅、107 组原生 smoke 和准确 head 的十二项 CI 已通过；合并后的 [main run 40117724563](https://github.com/PainAxis/LLM-Writer/actions/runs/40117724563) 在 `70b453c6ae4c5b3d19b6fb9637f592510bbd043f` 首次 attempt 全绿。PR CI 曾在断言完成后的清理阶段超时，同 head 单次重跑通过，首轮 job 不算成功。未得到真实模型质量结果或人工评分。

独立 [Campaign 持久基础](docs/writer-campaign-foundation.zh-CN.md)已在 [PR #44](https://github.com/PainAxis/LLM-Writer/pull/44) 验收，合并 `84e704afff08921763d4b83136d881a39946900a`，tree `cc53d33565ff574fd6bbce2f76bdcca9aecda406`。[main run 40154748857](https://github.com/PainAxis/LLM-Writer/actions/runs/40154748857) 十二项全过，含真实 IndexedDB Campaign 12/12 和既有 Agent 90/90。它提供任务／依赖、不可变本地产物、有限预算与可恢复检查点，仅注册离线 QA adapter；未知 intent 不重放，取消不能撤回此前已授权在途调用。原基础几何在中文 200,004／英文 350,007 scalar 停止。下一项聚焦 [v2 存储 allocation／settlement](docs/writer-campaign-storage.zh-CN.md)，只对已接受 artifact 原子释放未用存储 allowance，保留未知义务与 64 MiB 上限，并测读取成本。[PR #45](https://github.com/PainAxis/LLM-Writer/pull/45) 合并前通过了全部 13 项 CI 和中英文原生 IDB 百万字符测试；但同树的[主分支后续运行](https://github.com/PainAxis/LLM-Writer/actions/runs/40163096714)中，Node 中文在 966,686 字符处超时，原生中英文仍完成。本轮因此聚焦[验证 CPU 修正](docs/testing/writer-campaign-cpu-2026-10-25/REPORT.zh-CN.md)，保持原有限制；不能用先前成功替代本次失败门槛。这些是结构测试，不是小说。事实／上下文构造、真实供应商校准、自主编排、全书审计与有界修复仍未完成。

后续 [PR #47](https://github.com/PainAxis/LLM-Writer/pull/47) 的 action-private proof 修正已在 main `dfb94ffdba92da976d3540f8d9c76fd96284c385`、tree `19fbd21e1b6309d269ec07b200ff40c61cad141f` 验收；[main run 40183366291](https://github.com/PainAxis/LLM-Writer/actions/runs/40183366291) 全部 13 项通过。下一有界切片 [Planning Contract v1](docs/writer-campaign-planning.zh-CN.md) 增加四阶段封闭 payload、精确修订上下文和可选的全部规划优先离线 Lab 预览。其新结构／原生／容量门槛独立于已接受的修正与文学验收；不包含真实供应商、已成立正文事实账本或自主小说／审计／修复循环。

下一有界切片 [Body Evidence & Coverage v1](docs/writer-campaign-body-evidence.zh-CN.md) 将精确已接受的正文修订连接到通用本地提案校验与只读 Lab 预览。来源/结构、覆盖、生命周期及独立 Node/原生 N60 门槛不等于语义审查、持久账本或自主抽取；v2 哈希/计数与有限预算保持不变，切片验收证据与最终小说验收分开报告。


[单窗口正文提案生产器](docs/writer-body-proposal-producer.zh-CN.md)已补齐有界离线适配就绪：在 Body Evidence 之后，补齐“任意已接受正文 → 精确且明确调用的生产器输入 → 单次持久记账结果 → 共用编译器校验的只读提案与未解决清单”这一具体缺口。显式采用 Campaign v3，保留 v2 字节与共享预算；手工正文修订有独立身份，不能计入自主创作。默认应用不授权供应商调用，真实 SDK 测试仅连接本地合成端点；原生/UI CI、语义质量及最终小说仍分别验收。

生产器离线就绪切片已在 [PR #50](https://github.com/PainAxis/LLM-Writer/pull/50) 验收，main 为 `e7b6d06cea78e6070fed65ec0b36edbf563d8361`，tree 为 `afd255cde8687ec6a6f5e4c0986b836016387017`；[main run 40344698511](https://github.com/PainAxis/LLM-Writer/actions/runs/40344698511) 全部 16 jobs 通过，18 个证据 archive 已审计。先前本地旧中文规划超时记录仍保留，不因独立 CI 通过而抹去。下一项 [Creative Pilot v4](docs/writer-creative-pilot.zh-CN.md) 正在实现：任意作者简报、一次九任务有界授权、完整六份规划，以及包含全部已接受前章正文的三章创作。这是真实 App／SDK／持久链路，不是仅有 fixture 的包装；离线控制、真实模型文学审查及最终小说分别验收。

### 第四阶段最终验收：两部自主百万字符小说

用户最终标准已明确：从大纲、人设，再到细纲、章纲，**自主创作中文、英文各一部小说，每部正文 100 万字符**，规划文档不计入。两部作品必须在全书范围维持题材、剧情、人设和暗线伏笔不漂移。[长篇验收合同](docs/writer-agent-longform-acceptance.zh-CN.md)规定计数、全文证据、失败／未知、恢复及尚缺架构。

首个作者审阅的 2,000 单位草稿闭环与八个短例都不满足该要求。长篇编排须有独立明确授权的 campaign、持久检查点、有版本的事实与规划、累计资源预算，以及全书独立连续性核验。不能全局关闭已有作者选择、披露、取消和保存保护来冒充自主。任何确认漂移判失败；未审范围、缺失依据和未解决不确定性不能称“零漂移”。本规格本身不批准重型模型运行、密钥传输或开支额度。阶段二按章存储、编辑器重构和共享摘要仍是独立工作，若构成前置依赖，实施前应明确指出。
