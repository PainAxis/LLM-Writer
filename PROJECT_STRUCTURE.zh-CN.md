# LLM-Writer 目录结构

[English](PROJECT_STRUCTURE.md) | [简体中文](PROJECT_STRUCTURE.zh-CN.md)

本文介绍当前源码布局，后续工作见[路线图](ROADMAP.zh-CN.md)。

## 顶层目录

| 路径 | 用途 |
|------|------|
| `src/` | 应用源码 |
| `public/` | 网站图标等静态资源 |
| `scripts/` | 模块冒烟测试、浏览器回归、预览工具、发布校验与部署脚本 |
| `scripts/fixtures/` | 合成导入／压力语料，以及冻结、带版本的支持核对小说／代码固定集 |
| `docs/` | 数据格式、编辑协议、上下文策略与持久化协调说明 |
| `.github/workflows/` | 持续校验、由 CI 结果约束的发布，以及可选的临时浏览器预览 |
| `package.json`、`package-lock.json` | 依赖、锁定版本与 npm 命令 |
| `vite.config.ts`、`tsconfig.json`、`eslint.config.js` | 构建、TypeScript 与 lint 配置 |
| `Dockerfile`、`docker-compose.yml`、`nginx.conf` | 开发与生产部署 |

## 源码目录

| 路径 | 用途 |
|------|------|
| `src/main.ts`、`src/App.vue` | 应用启动、持久化初始化，以及加载和错误状态 |
| `src/style.css` | 共享设计令牌、Element Plus 变量与暗色主题 |
| `src/router/index.ts` | Hash 路由、页面懒加载与兜底页面 |
| `src/views/` | Writer、小说管理、短文创作、拆书分析、助手等功能页面 |
| `src/components/` | 共享 UI 与各功能组件，包括 Writer 的面板、对话框与编辑器 |
| `src/composables/` | 写作、AI 流式生成、提示词选择与主题等响应式流程 |
| `src/services/api.ts`、`src/services/aiProviders.ts`、`src/services/apiConfig.ts` | AI SDK 接口封装、服务商适配、模型发现与共享 API 配置 |
| `src/services/aiRequestLimits.ts` | SDK 解析前的可选请求级时间／响应字节上限，单次传输且不重定向；普通请求保留原有行为 |
| `src/services/novelPersistence.ts`、`src/services/blobStore.ts` | 小说保存队列、分阶段写入且带版本的 IndexedDB 正文分片与启动回填 |
| `src/services/storageCoordination.ts`、`src/utils/novelConcurrency.ts` | 小说/目标的跨标签页提交协调，以及逐部小说的版本检查 |
| `src/services/promptCatalog.ts` | 五个提示词入口共享的初始化、迁移与提交后更新 |
| `src/services/backup.ts`、`src/services/billing.ts` | 备份校验与恢复、本地用量和成本记账 |
| `src/stores/novel.ts`、`src/stores/assistant.ts`、`src/stores/writingGoals.ts` | 写作、助手会话/摘要覆盖范围与写作目标的 Pinia 状态 |
| `src/services/mcp.ts`、`src/services/skills.ts`、`src/services/writingTools.ts`、`src/services/extensionsRuntime.ts` | 按请求管理 MCP、Skills、创作工具与受限模型调用；[扩展说明](docs/extensions.md) |
| `src/stores/extensions.ts`、`src/components/extensions/` | 严格校验的扩展配置、内存令牌与助手授权入口 |
| `src/views/MemoryLab.vue`、`src/services/memory/`、`src/types/memory.ts` | 独立记忆检索、Worker 内的增量索引、可选嵌入／重排服务、有容量上限的向量缓存，以及校验版本和披露范围的依据；[范围](docs/memory-prototype.zh-CN.md)与[增量生命周期](docs/memory-incremental-index.zh-CN.md) |
| `src/services/memory/matchSignals.ts` | 确定性的完整查询／编号信号与所选依据汇总，始终不验证可回答性；[审阅规则](docs/memory-evidence-review.zh-CN.md) |
| `src/services/memory/supportCheck.ts`、`src/types/memorySupport.ts` | 纯本地核对计划、所选来源保护、有界聊天发送、严格结果／引用校验及不持久化的模型辅助意见；[规则与验收](docs/memory-support-checks.zh-CN.md) |
| `src/composables/useMemorySupportCheck.ts`、`src/components/memory/MemorySupportCheck.vue` | Lab／Writer 共用预览、明确启动、取消与过期结果生命周期；不提供置信度认证、不自动批准 Writer、不注入核对答案 |
| `src/services/memory/novelScan.ts`, `src/services/memory/novelScanPlan.ts`, `src/services/memory/novelScanProtocol.ts`, `src/services/memory/novelScanBudget.ts`, `src/types/memoryNovelScan.ts` | 已披露原文切窗、有限 A/B 计划、六维累计预算、跨批 campaign 出处／游标及受保护的候选生命周期；[合同](docs/memory-novel-scan.zh-CN.md) |
| `src/composables/useNovelCandidateScan.ts`, `src/components/memory/NovelCandidateScan.vue` | 分开的本地预览／A／B 授权、逐项候选审阅、分批继续及取消；提议不自动进入 Writer |
| `src/services/memory/identifiers.ts` | 解析完整 ASCII 字母数字代码并检查分块边缘，支撑本地混合查询召回；[语法及验收](docs/memory-mixed-query-recall.zh-CN.md) |
| `src/components/memory/`、`src/services/memory/factGraph.ts`、`src/services/memory/factGraphStore.ts`、`src/services/memory/factExtraction.ts`、`src/types/factGraph.ts` | 有原文依据的事实关系、Cytoscape.js 展示、按作品隔离的独立持久化和有明确范围的可选模型提议；[图谱约定](docs/memory-fact-graph.zh-CN.md) |
| `src/utils/storage.ts`、`src/utils/aiRequestScope.ts` | 统一存储入口，以及可独立取消的 AI 请求作用域 |
| `src/utils/writer/` | Writer 提示词构建与响应解析，包含润色原文的字面替换 |
| `src/utils/writerContent.ts`、`src/utils/novelStats.ts` | 统一可见正文转换、安全生成 HTML、Unicode 字符计数和按章节计算小说总字数 |
| `src/utils/chapterParser.ts` | 只接受结构明确、完整的 AI 章节大纲，无效结构不创建兜底章节 |
| `src/utils/` | 上下文预算与压缩、语料检索、文档导入、章节解析、事件与导图数据处理 |
| `src/types/` | API、Writer、短文、拆书、小说管理和工具的共享类型，以及第三方库声明 |
| `src/config/` | 默认提示词、短文默认配置、带类型的工具定义与公告 |

## Writer 工作台

| 路径 | 职责 |
|------|------|
| `src/views/Writer.vue` | 组装工作台界面并连接各业务控制器 |
| `src/components/writer/WriterEditor.vue` | 富文本编辑器封装与生命周期管理 |
| `src/components/writer/panels/` | 章节、角色、世界观、语料与事件面板 |
| `src/components/writer/dialogs/` | 生成、编辑与提示词选择对话框 |
| `src/composables/useWriterProject.ts` | 项目加载、章节切换、自动保存与持久化重试 |
| `src/composables/useWriterGenerationArbiter.ts` | 协调 AI 操作的归属与持久化等待边界 |
| `src/services/writerAgent.ts`、`src/services/writerAgentProtocol.ts`、`src/types/writerAgent.ts` | 两请求／单本地工具的有限作者 Agent、严格协议、私有依据能力及无原文审计；[合同](docs/writer-author-agent.zh-CN.md) |
| `src/composables/useWriterAgent.ts`、`src/components/writer/panels/WriterAgentPanel.vue` | 每轮明确授权、逐条原文批准、只读草稿及仅一次追加／保存恢复 |
| `src/composables/writerPersistenceGate.ts`、`src/services/novelPersistence.ts` | Agent 专属应用／保存屏障与实际提交点的纯元数据回执；普通非 Agent 保存保留逐快照结果 |
| `src/composables/useWriterMemoryContext.ts`、`src/composables/writerMemoryStream.ts`、`src/components/writer/WriterMemoryContext.vue`、`src/services/memory/writerContext.ts` | 主动启用的写作依据预览／核对、发送与应用保护，以及受预算限制的原文上下文；[约定与测试](docs/writer-memory-context.zh-CN.md) |
| `src/composables/useChapterContentWorkspace.ts` | 章节正文对话框状态、素材选择与生成上下文 |
| `src/composables/` | Writer 的增删改查、续写、润色、生成与提示词编排控制器 |
| `src/utils/writer/`、`src/types/writer.ts` | 提示词与解析辅助函数，以及 Writer 共享类型约定 |

## 其他功能的拆分边界

| 功能 | 模块与职责 |
|------|------------|
| AI 助手 | `stores/assistant.ts` 选择全局/独立策略、隔离会话，并通过 `coveredThroughEntryId` 记录摘要覆盖范围；只有已提交且符合当前策略的摘要才替代已覆盖原文；`useVirtualMessages.ts` 测量可见消息、保持滚动锚点并跟随新回复；`utils/contextPolicy.ts` 归一化并选择策略；[策略说明](docs/assistant-context-policy.md) |
| ShortStory | `useShortStoryWorkspace.ts`； `components/short-story/ShortStoryPromptSelector.vue`；`useShortStoryConfig.ts` 管理独立默认值和异步保存；`useShortStoryGeneration.ts` 管理独立可取消请求；`utils/shortStoryPrompts.ts` 构建提示词 |
| BookAnalysis | `useBookAnalysisWorkspace.ts`； `components/book-analysis/BookFileImportPanel.vue`；`useBookAnalysisFile.ts` 管理最新导入请求和编码；`utils/bookAnalysisContext.ts` 按整行识别章节标题，校验明确选择的范围并构建提示词 |
| NovelManagement | `useNovelManagementWorkspace.ts`； `components/novel-management/NovelMetadataForm.vue` 复用创建/编辑表单；`utils/novelList.ts` 处理筛选和不修改原集合的排序；`utils/novelStats.ts` 统一旧数据兼容的展示与导出统计 |
| ToolsLibrary | `useToolsLibraryWorkspace.ts`； `components/tools/ToolCatalog.vue`；`config/tools.ts` 统一工具定义；`utils/toolForms.ts` 校验必填项；`utils/toolPrompts.ts` 筛选兼容模板，按所选小说/章节身份和当前表单参数构建请求 |
| Writer 语料 | 每部小说的 `corpusData` 为唯一来源；`useWriterMaterialCrud.ts` 执行原子导入，`utils/corpusTransfer.ts` 校验旧版和独立语料文件，兼容已命名的空内容草稿；[格式](docs/corpus.md) |
| 思维导图 | `useMindMapDraft.ts` 检查来源冲突并等待保存；`utils/mindmapEditing.ts` 生成编辑快照、校验并保留实体字段；[编辑协议](docs/mindmap-editing.md) |
| 编辑器销毁 | `utils/destroyEditor.ts` 在销毁 wangEditor 前取消待执行的选区节流回调 |

表中路径相对于 `src/`；`use*.ts` 控制器位于 `src/composables/`。全部父页面使用 `lang="ts"`，由统一视图语言规则强制检查；四个功能的 Workspace 控制器负责响应式状态、生成与持久化编排；`useGenerationTask.ts` 统一请求归属和取消。

## 校验与发布

- CI 通过 `smoke:all` 动态纳入全部已注册冒烟测试，另有独立的合成数据生产构建 Chromium 套件。带日期的数量属于其原修订。52 场景 `ci-memory-support` 和 20 场景 `ci-memory-novel-scan` 分别是旧 `test:browser` 聚合之外的必要门槛；[支持核对](docs/testing/memory-support-checks-2026-10-22/ACCEPTANCE.zh-CN.md)与[候选扫描](docs/testing/memory-novel-scan-2026-10-22/ACCEPTANCE.zh-CN.md)保留实际 CI 基线结果。没有本地浏览器执行，最终 head 仍须通过自身全部必要检查。
- [超长篇记忆压力测试](docs/memory-stress-tests.zh-CN.md)：`ci-memory-stress` 检验本地容量与受控 HTTP 服务，`ci-memory-browser-stress` 单独检验浏览器持久化改稿；付费 Jina 为可选测试。复用语料位于 `scripts/fixtures/`，经审查的报告位于 `docs/testing/`。
- 记忆增量回归：`smoke:memory-incremental` 与 `smoke:memory-client`；连续改稿／返回焦点检查扩展已有压力脚本。
- 事实图谱回归：`smoke:memory-fact-graph`、`smoke:memory-fact-store`、`smoke:memory-fact-extraction` 与 `test:browser-memory-fact-graph`；[来源约定与容量](docs/memory-fact-graph.zh-CN.md)。
- 图谱备份与移动回归：`smoke:graph-backup`、`test:browser-graph-backup` 与 `test:browser-mobile`；[可移植原文依据与窄屏行为](docs/graph-backup-mobile.zh-CN.md)。
- 混合查询回归：`smoke:memory-mixed-query`；Writer 压力测试保留原有 68 次准备工作负载，每档另加 24 次关闭图谱的完整查询断言。详见[对照及剩余限制](docs/memory-mixed-query-recall.zh-CN.md)。
- 容量核算：`scripts/benchmark-memory-capacity.ts` 区分冷启动／恢复与语义缓存成本；`benchmark-memory-source.mjs` 执行真实已提交读取与 Writer 新鲜度校验。`ci-memory-capacity` 按 ABBA 比较固定的历史基线／正文加载修订，`smoke:source-hydration` 保护完整正文读取及存储竞争；见[测量与剩余限制](docs/memory-capacity.zh-CN.md)。
- 全范围扫描回归：四组 `smoke:*full-scan*` 套件及 `ci-memory-full-scan` 生产适配器容量／浏览器检查；[范围与已完成的第 2 条工作线验收](docs/memory-full-range-semantics.zh-CN.md)，合并状态见[路线图](ROADMAP.zh-CN.md#第三阶段完成契约)。
- 可选支持核对回归：`smoke:memory-support`、`smoke:memory-support-transport`、`smoke:memory-support-ui`、`smoke:writer-memory-support` 与完全 mock 的 `smoke:memory-support-code`；`test:browser-memory-support` 覆盖冻结的 25 个语义用例，另有 600 章／1,388,902 字符的 Memory Lab 与三个 Writer 入口场景。长篇场景不改变语义分母；[当前验收限制](docs/memory-support-checks.zh-CN.md)。
- 候选扫描回归：`smoke:memory-novel-scan-engine`、`smoke:memory-novel-scan-fixture`、`smoke:memory-novel-scan-transport`、`smoke:memory-novel-scan-ui`、`smoke:memory-novel-scan-capacity` 与 `smoke:memory-plot-links`。`ci-memory-novel-scan` 独立调用 `test:browser-memory-novel-scan` 的 20 组生产构建场景；[验收证据](docs/testing/memory-novel-scan-2026-10-22/ACCEPTANCE.zh-CN.md)区分完整执行与两轮历史部分结果。Writer 安全桥保留原文安全 predicate、明确选择及完成态批准；图谱作者确认本身不是 Writer 批准。
- CI 附件：`prepare-ci-evidence.mjs` 按 `ci-evidence-files.mjs` 的十三组精确白名单归档；`smoke:ci-evidence` 检验请求／诊断投影及文件系统失败关闭。[有界归档规则](docs/ci-evidence.zh-CN.md)区分派生摘要、runner 本地原报告和历史上传。
- 作者 Agent 回归：`smoke:writer-agent`、`smoke:writer-agent-ui`、`smoke:writer-agent-transport`、`smoke:writer-save-ownership` 与 `smoke:ordinary-save-receipts` 进入动态聚合，覆盖运行时、Vue／SSR、实际 SDK 本地 HTTP 与持久化边界。冻结合同有 18 个运行时组和 18 个浏览器组，变体数不是额外语义样本。`ci-writer-agent` 独立调用 `test:browser-writer-agent`，不属于旧 `test:browser` 聚合；[当前范围与验收状态](docs/writer-author-agent.zh-CN.md)。
- 依据审阅回归：`smoke:memory-match-signals`、`smoke:writer-memory-selection`，并在 Writer／浏览器压力测试加入明确选择及已知未解答问题；[规则与测量](docs/memory-evidence-review.zh-CN.md)。
- 写作记忆回归：`smoke:writer-memory`、`smoke:memory-remote-guard`、`smoke:writer-memory-lifecycle`；`ci-writer-memory` 执行 21 个浏览器流程及 144万／1050万字符压力场景。
- 其他测试集：`smoke:generation-budget`、`smoke:writer-content`、`smoke:management-correctness`、`smoke:billing-correctness`、`smoke:tools-workspace`。
- [浏览器测试](scripts/browser-testing.md)：CI 检查、本地 Chromium 回归与可选预览。
- [发布说明](scripts/releasing.md)：通过校验的静态构建、校验和及源码/CI 信息。
- [更新日志](CHANGELOG.md)：已发布变更和未发布工作。

## 功能组件的归属

- ShortStory 的短文/小说工作区，以及文风、续写、优化和配置对话框位于 `src/components/short-story/`。`short-storyContext.ts` 共享页面拥有的类型化工作区；编辑器引用与过期写入保护位于 `useShortStoryEditors.ts`；`useShortStorySelection.ts` 为优化捕获并校验精确编辑器选区。
- BookAnalysis 的控制区、结果区及章节/提示词对话框位于 `src/components/book-analysis/`。`book-analysisContext.ts` 共享页面拥有的工作区；`useBookChapterViewer.ts` 负责章节选择、阅读与导出。`useBookAnalysisLibraryWorkspace.ts` 管理报告对话框和身份；`services/bookAnalysisLibrary.ts` 校验并持久化报告，也接入系统备份。
- 共享样式仅作用于功能页面根节点和其浮层类。生成请求与取消仍由页面生命周期管理。
- `stores/writingGoals.ts` 统一两个目标入口和首页状态，串行保存、保留编辑前的元数据并记录进度历史。`utils/writingGoals.ts` 归一化旧数据，按本地日历计算实际写作活动，字数统计仅纳入“字”单位。明确的章节目标使用“章”；更换单位会重置当前进度，并为历史记录保留原单位。

## 持久化与上下文边界

- `promptCatalog.ts` 为 Writer、PromptsLibrary、ShortStory、BookAnalysis 和 ToolsLibrary 按需初始化或迁移提示词库。当前版本中用户已删除的模板及用户元数据会保留；损坏的存储数据会报错，并保留供恢复。
- 提示词、API/配置、题材与助手管理完成存储写入后，才更新已保存状态并提示成功。保存失败保留可重试草稿或上次提交状态。
- 小说保存先准备正文分片，再协调提交，并比较编辑器实际读取的版本。不同作品的修改可以合并；同一作品发生冲突时保留本地草稿，拒绝覆盖较新的已保存版本。需先复制草稿，再刷新页面、重新打开作品并手动合并。
- 事实关系按作品存入独立 IndexedDB 记录，保存时原子比较版本；并发保存冲突会报错，不覆盖较新的图谱。修改来源后隐藏过期关系，不会悄悄重绑定或删除已存注释。实际作品的图谱记录随小说分类进入系统备份，批量恢复时检查并发版本并分配新的存储版本，原文锚点保持不变；详见[图谱持久化说明](docs/memory-fact-graph.zh-CN.md#持久化与容量)。
- 图谱 v2 的 `plotLinks` 保留全部 setup／recovery／context 前提和出处，普通关系与伏笔保存互相保留。v1 读取只在内存归一化，不隐式写盘；未知未来版本在读／存／导入／备份／恢复时拒绝且不覆盖现有数据。每条前提继续受来源修订、披露和 CAS 保护；[范围](docs/memory-novel-scan.zh-CN.md)。
- 目标增量在同一跨标签页提交边界中读取最新记录，保留并发的增量和各自历史。这一机制保护小说与写作目标，其他存储键不会因此获得跨标签页保护。详见[持久化协调说明](docs/persistence-coordination.md)。
- 助手摘要将正文和覆盖游标一起保存，发送时使用摘要与尚未覆盖的原始消息；压缩失败或仍在进行时不会推进覆盖范围。完整本地历史与旧版摘要备份保持可用。
- `utils/eventLine.ts` 按稳定的章节身份重映射事件关联，供章节管理、Writer 删除及思维导图编辑共同使用。章节管理在同一次保存中提交重新计算的章节字数和小说的两个总字数字段。
- `services/billing.ts` 标记服务商返回、估算及无法取得的用量，统一请求类型并计算精确筛选和本地日历趋势；`TokenBilling.vue` 展示实际趋势/分布数据，并在用量变化后刷新。
- 批量大纲控制器保留无效原始回答，数量符合要求后才保存；来源校验忽略无关自动保存元数据，实际来源变化仍会拒绝迟到结果。
- API 连接测试和模型同步使用可取消的表单快照；模型缓存按服务商端点和代理隔离，仅显式保存配置才修改当前生效设置。
