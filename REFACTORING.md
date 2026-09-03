# LLM-Writer 重构报告

> 原始参考项目：[91Writing](https://github.com/ponysb/91Writing) v0.7.0（本地留有原版副本，未改动，保持原状，不随本仓库分发）
> 重构产物：`LLM-Writer`（本目录）。项目实现灵感来自 91Writing，除此之外与原项目无关联；原项目品牌元素（官方 API、交流群组等）均已移除。

## 一、重构概览

| 维度 | 重构前 | 重构后 |
|------|--------|--------|
| 语言 | 全 JavaScript | 核心层 TypeScript（services/stores/router/composables/utils/config），视图层渐进迁移 |
| 构建工具 | Vite 4.5 (Rollup) | Vite 8.2 (Rolldown) |
| 框架 | Vue 3.3 / Pinia 2 / Router 4 | Vue 3.5 / Pinia 4 / Router 5 |
| UI 库 | Element Plus 2.4 | Element Plus 2.14 |
| ESLint | 8.x，配置文件缺失，lint 脚本不可用 | ESLint 10 flat config + Prettier 3 + vue/ts 规则，0 errors |
| 首屏 JS | 2,427 KB（单 chunk） | 38.7 KB（分包+懒加载） |
| API 配置实现 | 4 套互相独立/孤立的实现 | 1 套（`services/apiConfig.ts`） |
| localStorage 访问 | 15 个文件 100+ 处直接读写 20+ 魔法键 | 统一 `utils/storage.ts` 唯一入口（11 文件 ~70 处裸调用全部收口，配额超限显式抛出） |
| 流式"停止"按钮 | 仅重置 UI 状态，网络请求继续 | `AbortController` 真正取消请求 |

## 二、已完成工作

### Phase 1 清理
- 删除约 12,300 行死代码：根目录旧版 `Writer.vue`/`api.js`、无路由引用的 `Home.vue` 及其 7 个孤儿组件、废弃的 `Writer_refactored.vue` + `components/writer/`、含硬编码 API Key 的 `api-test.js`、空文件 `prompt.txt`/`docker-deploy.md`、无关的 `modern-website.html`、双锁文件
- 修复 `.gitignore`（dist/env/logs）、补齐缺失的 favicon（`public/favicon.svg`）
- 依赖瘦身：移除从未使用的 axios / file-saver / highlight.js / @vueuse/core

### Phase 2 工具链
- TypeScript 5.9 + vue-tsc，`npm run build` / `npm run typecheck` 全绿
- ESLint 10 flat config（`eslint.config.js`）+ Prettier（`.prettierrc.json`）
- Vite 8（Rolldown 内核）+ `manualChunks` 手动分包

### Phase 3 架构
- `src/utils/storage.ts`：集中登记全部 localStorage 键（`StorageKeys`）、类型安全读写、防 JSON 异常
- `src/services/apiConfig.ts`：**API 配置唯一事实来源**（后续品牌化改造：移除官方 API 概念，收敛为单一配置；`views/ApiConfig.vue` 重写为单表单）
  - 消除了 4 套重复实现（store 内嵌 / `api.js` 内嵌 / `views/ApiConfig.vue` 孤儿键 `aiApiConfigs` / Dashboard 轮询 localStorage）
  - 官方 baseURL 强制约束集中一处；旧 `apiConfig` 键自动迁移
  - 响应式共享：Dashboard 的 1 秒轮询 + `forceUpdate` hack + storage 事件监听全部删除
- `src/services/api.ts`：TS 重写，SSE 解析、计费挂钩、错误处理保持原行为；新增中断支持；修复 `analyzeArticle` 使用错误模型字段的 bug
- `src/services/billing.ts`：TS 重写（本地模拟记账）
- `src/stores/novel.ts`：TS 重写，配置委托给 apiConfig 模块，修复 3 处重复的 `generateUniqueId`
- `views/ApiConfig.vue`：1,170 行孤立页面 → 复用统一 `components/ApiConfig.vue` 的 40 行薄壳

### Phase 4 公共模块
- `src/composables/useAIStream.ts`：流式生成统一状态机（状态/增量/中断/错误提示），替代 Writer 内 24 处同构样板
- `src/utils/chapterParser.ts`：AI 章节响应的 5 级解析策略（原 Writer 内 270 行）
- `src/config/defaultPrompts.ts`：默认提示词库单一来源（原 Writer/PromptsLibrary/ShortStory 各自维护）；修复默认提示词重复 id（两个 id=22）
- Writer.vue 已接入上述模块（净删 ~550 行）

### Phase 6 性能
- 路由级懒加载：13 个子路由全部 `() => import(...)`，新增 404 页面（`views/NotFound.vue`）
- `main.js` → `main.ts`
- Docker：node:18+pnpm → node:22+npm ci，dev 端口对齐（3000），移除无意义的 `depends_on`


## 二·五、LLM API 配置重构（Vercel AI SDK 集成）

- **依赖**：ai@5 + @ai-sdk/openai-compatible@1 + @ai-sdk/anthropic@2 + @ai-sdk/google@2（统一对齐 @ai-sdk/provider@2 spec）
- **服务商预设表**（`services/aiProviders.ts`）：OpenAI / Anthropic / Google Gemini / DeepSeek / Groq / xAI / Moonshot Kimi / 通义千问 / 智谱 GLM / 自定义 OpenAI 兼容地址（ollama、lmstudio 等）
  - Anthropic、Gemini 使用官方原生 provider 包（此前根本不支持其原生 API 格式）
  - 其余全部走 openai-compatible 兼容层；Anthropic 浏览器直连所需声明头由预设自动附加
- **api.ts 重写**：手写 fetch+SSE 解析（~300 行）替换为 streamText/generateText；门面接口（generateTextStream 等）签名不变，上层零改动
  - 免费获得：SDK 内置重试（maxRetries: 2）、结构化错误、真实 usage 提取
  - 中断/超时语义保持：5 分钟超时 + abort 后返回部分内容
  - services 层不再直接弹 ElMessage（UI 耦合解除）
- **配置模型**：ApiConfig 新增 provider、customHeaders（CORS 逃生舱，配置界面可视化编辑）；旧配置自动迁移（provider 回落 custom）
- **Bundle 控制**：ai 内核与 provider 包经动态 import 独立为异步 chunk（~400KB），首次调用 AI 功能时才加载，不影响首屏
- **不支持（架构限制）**：Bedrock / Vertex AI 需要服务端凭证签名，纯前端应用无法安全直连
- **模型列表同步**：`fetchProviderModels()` 从服务商 `/models` 端点拉取（OpenAI 兼容/Anthropic `{data:[{id}]}`、Google `{models:[{name}]}` 过滤 generateContent），按服务商缓存并持久化（`providerModels`）；配置页一键"获取/同步模型列表"，配置页与 Dashboard 的模型下拉均显示"🛰️ 服务端模型列表"分组，内置常用模型仅作未同步时的兜底
- **运行时验证**：`npm run smoke:ai` —— 本地 Mock SSE 服务器端到端测试（流式解析/真实 usage 计费/密钥探活/中断恢复部分内容/配置持久化）

## 二·六、前端视觉系统重构（"墨纸"主题）

- **设计令牌集中化**：`src/style.css` 重写为全站设计系统——品牌色（靛青 `#4f46e5`）、冷灰蓝中性色阶（ink 系列）、语义色、圆角/阴影规格，并整体映射到 Element Plus CSS 变量（`--el-color-primary` 等），全部 15 个视图的 EP 组件自动换肤
- **旧配色清除**：14 个文件 441 处硬编码旧配色（`#409eff`/`#304156`/`#f5f5f5` 等 2017 admin 风格）机械映射为语义 CSS 变量，后续调主题只需改 style.css 一处
- **Dashboard 外壳重塑**：2017 风深蓝侧栏 → 浅色纸面质感侧栏 + 胶囊菜单交互 + 渐变衬线 Logo 印记；头部毛玻璃效果；路由切换加入 page-fade 过渡动画
- **公共组件质感统一**（全局层）：卡片大圆角+柔和悬浮阴影、胶囊形 Tag、对话框/消息框圆角、按钮层次阴影、表格头样式、纤细悬浮滚动条、`::selection` 品牌色
- **夜间模式**：light / dark / system 三态主题（composables/useTheme.ts），跟随系统 prefers-color-scheme 实时切换；Element Plus 暗色变量 + 自定义 ink/brand 色阶在 html.dark 下语义反转；initTheme() 在应用挂载前执行避免首帧闪烁；Dashboard 头部提供循环切换按钮
- **字体栈现代化**：系统字体栈（SF Pro / PingFang SC / HarmonyOS Sans SC / MiSans），Logo 与 favicon 使用衬线字体现"写作工具"身份；零 webfont 依赖

## 二·七、创作侧功能补齐（2026-09-02）

### 存储分层（localStorage + IndexedDB）
- **storage 收口**：11 个文件 ~70 处裸 `localStorage.*` 全部迁入 `storageGet/storageSet/storageRemove/storageClear`（+ Raw 版本绕过 JSON 化）；损坏 JSON 由抛异常改为 warn+fallback
- **配额防护**：`storageSet` 遇 QuotaExceeded → 清可再生缓存（服务端模型列表）重试一次 → 仍超限同步抛出，恢复视图层"保存失败"提示语义
- **IndexedDB 分层**：`services/blobStore.ts`（单 kv store 薄封装，失败自动降级）+ `services/novelPersistence.ts`（novels 键后端）：整体 ≤1.5M 字符直写 LS 快路径；超阈值章节正文（>2K 字符）分片入 IDB，LS 留元数据+指针，先 IDB 后 LS 写序 + stale 分片清理；启动 `initNovelPersistence()` hydration 门闩；惰性迁移（首个写入自然触发拆分）
- **chunked 键注册**：`registerChunkedKey(key, backend)`，storageGet/Set/Remove/Clear 对已注册键整键转交后端，视图层零改动

### AI 助手系统 + 上下文容量管理
- **API 扩展**：`GenerateOptions` 增 `system?`/`messages?`（messages 优先）；`model` 首次真正接通（计费按实际模型）；`chatWithAI` 第三参数自定义人设并收敛走流式路径
- **助手 CRUD**：`stores/assistant.ts`（Pinia setup 式）——人设/默认模型管理、按助手隔离的会话持久化、流式占位条目、中断/失败清理；`views/AssistantManagement.vue`（TS）
- **上下文策略**（`utils/contextCompactor.ts` 纯函数）：最大 Token 数/最大条数双量纲预算；**truncation 滑窗与 summary 增量摘要显式二选一，无静默降级**；摘要失败即时 toast + 「⚠️ 待压缩」徽标 + 下次发送时弹窗（重试/放弃单次豁免/取消）；摘要 ≠ 删除，本地持久化全量原文
- Settings 新增「上下文管理」卡片；对话区 token 指示条与折叠徽标

### 语料库分类 + 检索推荐
- `utils/corpusRetrieval.ts`（纯函数）：**字符 bigram 重合度**评分（中文无分词场景稳健）、`extractKeywords`、`recommendCorpus`（minScore 过滤 + top-K）、`buildCorpusInjection`（整条优先，仅首条超预算才截断）
- 语料分类（可自定义）+ 分类筛选 + 标题/内容搜索；全素材生成对话框「按上下文推荐」top-5 一键合并注入
- `generatePersonalizedContent` 改为重合度 top-8 + 4000 字符预算注入（签名不变），消除大语料库撑爆上下文/账单的隐患

### 思维导图（只读 MVP）
- `utils/mindmapData.ts`（纯函数）：novel → mind-elixir 节点树（章节大纲+事件挂载、人物、世界观、语料分类分组、孤儿事件归组、统一截断、空数据兜底）
- `views/MindMap.vue`（TS）：动态 import（mind-elixir@4.3.1 独立 chunk ~89KB）、`editable:false`+`disableEdit` 双保险只读、适应画布、导出 PNG（@mind-elixir/export-mindmap）

### 事件线增强 + 代理配置
- **修复存量 bug**：事件 `chapter` 字段存的是章节标题而非章号，`parseInt` 为 NaN 导致事件从未进入生成上下文；对话框改绑章号 + `migrateEventChapters()`（抽为 `utils/eventLine.ts` 纯函数）一次性迁移旧数据
- 关联角色多选（`characterIds[]`，生成上下文与导图同步携带）；列表/时间线双视图（el-timeline，章节号→时间→创建时间排序）
- **代理前缀**：`ApiConfig.proxyUrl?` 可选前缀，`aiProviders.applyProxyPrefix()` 在模型解析与探活统一应用；smoke 实证请求真实经代理命中

### 质量保障
- **smoke 测试套件**：`scripts/smoke-*.ts` 六脚本共 32 项断言（无浏览器依赖，Mock SSE + 内存 fake-IDB，可进 CI）
- **两轮代码审查累计修复 9 个问题**，含两个真实 bug：summary 策略 off-by-one 边界缺口（每次发送丢 1 条历史）、中文输入法 Enter 误发送（`isComposing`/keyCode 229 判定）

## 三、验证结果

```
npm run build              # vue-tsc --noEmit && vite build → 通过
npm run typecheck          # 0 errors
npm run lint               # 0 errors, 83 warnings（历史 JS 视图 unused-vars，基线持平）
npm run preview            # HTTP 200，入口 chunk 正常
npm run smoke:ai           # 10 项
npm run smoke:compactor    # 6 项
npm run smoke:persistence  # 5 项
npm run smoke:corpus       # 4 项
npm run smoke:mindmap      # 4 项
npm run smoke:eventline    # 3 项   —— 六脚本共 32 项断言全部通过
```

构建产物（gzip 后）：
- 首屏：index 21.2 KB + vendor-vue 11.7 KB；Element Plus 独立分包 327.7 KB（UI 常驻）
- 按需异步 chunk：Writer 44.7 KB、vendor-editor 299.1 KB（仅编辑器页面）、AI SDK 独立 chunk（首次调用 AI 功能时加载）、MindElixir 30.6 KB（仅导图页面）

## 四、后续路线图（建议顺序）

1. **Writer.vue 继续拆分**（当前 ~10,550 行）：`useAIStream` 与解析器已就绪，按功能簇拆出：
   - `writer/ChapterPanel`（章节 CRUD + 批量生成）
   - `writer/CharacterPanel`（人物 CRUD + 批量生成，~1,100 行）
   - `writer/WorldviewPanel`（世界观，~800 行）
   - `writer/CorpusPanel` / `writer/EventPanel`
   - `writer/dialogs/ContinueDialog`、`writer/dialogs/OptimizeDialog`、`writer/dialogs/PromptSelector`
   - 持久化收口到 `saveNovelData` 单一入口
2. **其余流式调用点迁移至 `useAIStream`**（模块就绪，部分已接入；chatWithAI 已收敛流式路径）
3. **思维导图可编辑版**：需先设计 store 回写协议（只读 MVP 已上线）
4. **按助手覆盖 contextPolicy**（`AssistantInfo.contextPolicy` 字段已预留）
5. **视图层 TS 化**：按 `lang="ts"` 逐文件迁移（当前 `vue/block-lang` 规则已临时关闭，迁移完成后恢复）
6. **lint warnings 清零**：历史代码的 unused vars 清理
7. 二期候选：消息列表虚拟滚动、store 遗留 corpus 与 Writer corpusData 合并、暗色模式下导图画布底色校准
8. 工程项：git 初始化建仓（当前无版本控制）

## 五、目录结构

```
src/
├── main.ts                     # 启动链：initNovelPersistence 门闩 + initTheme
├── App.vue
├── style.css                   # "墨纸"设计令牌 + EP 变量映射 + 暗色语义反转
├── router/index.ts             # 15 个功能路由懒加载 + 404
├── types/api.ts                # 共享类型（含 AssistantInfo/ContextPolicy）
├── config/
│   ├── defaultPrompts.ts       # 默认提示词库（唯一来源）
│   └── announcements.js
├── services/
│   ├── aiProviders.ts          # 10 服务商预设 + 模型列表拉取 + 代理前缀
│   ├── apiConfig.ts            # API 配置唯一事实来源
│   ├── api.ts                  # Vercel AI SDK 封装（流式/中断/计费挂钩/system·messages）
│   ├── billing.ts              # 本地模拟计费（token 估算委托 tokenBudget）
│   ├── blobStore.ts            # IndexedDB 单 kv store 薄封装
│   └── novelPersistence.ts     # novels 键 LS+IDB 分层后端（快路径/分片/hydrate）
├── stores/
│   ├── novel.ts                # 核心 Pinia store
│   └── assistant.ts            # 助手 CRUD + 会话持久化 + 上下文压缩状态机
├── composables/
│   ├── useAIStream.ts          # 流式生成统一状态机
│   └── useTheme.ts             # light/dark/system 三态主题
├── utils/
│   ├── storage.ts              # localStorage 唯一入口 + chunked 键注册
│   ├── tokenBudget.ts          # token 估算 + 截断预算登记表
│   ├── contextCompactor.ts     # 上下文压缩纯函数（评估/滑窗/增量摘要）
│   ├── corpusRetrieval.ts      # 语料 bigram 检索推荐纯函数
│   ├── mindmapData.ts          # novel → mind-elixir 节点树
│   ├── eventLine.ts            # 事件章号迁移纯函数
│   ├── chapterParser.ts        # AI 章节响应 5 级解析
│   └── id.ts
├── components/                 # ApiConfig、AnnouncementDialog 等
└── views/                      # 17 个页面（核心层 TS，视图层渐进 TS 化）
    ├── Writer.vue              # 写作工作台（~10,550 行，待拆分）
    ├── AssistantManagement.vue # AI 助手（TS）
    ├── MindMap.vue             # 思维导图（TS）
    └── ...
```
