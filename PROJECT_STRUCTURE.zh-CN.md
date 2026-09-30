# LLM-Writer 目录结构

[English](PROJECT_STRUCTURE.md) | [简体中文](PROJECT_STRUCTURE.zh-CN.md)

本文介绍当前源码布局，后续工作见[路线图](ROADMAP.zh-CN.md)。

## 顶层目录

| 路径 | 用途 |
|------|------|
| `src/` | 应用源码 |
| `public/` | 网站图标等静态资源 |
| `scripts/` | 模块冒烟测试、浏览器回归、预览工具、发布校验与部署脚本 |
| `scripts/fixtures/` | 文档导入使用的合成测试文件 |
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
| `src/services/novelPersistence.ts`、`src/services/blobStore.ts` | 小说保存队列、带版本的 IndexedDB 正文分片与启动回填 |
| `src/services/backup.ts`、`src/services/billing.ts` | 备份校验与恢复、本地用量和成本记账 |
| `src/stores/novel.ts`、`src/stores/assistant.ts` | 写作与助手会话的 Pinia 状态 |
| `src/utils/storage.ts`、`src/utils/aiRequestScope.ts` | 统一存储入口，以及可独立取消的 AI 请求作用域 |
| `src/utils/writer/` | Writer 提示词构建与响应解析 |
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
| `src/composables/useChapterContentWorkspace.ts` | 章节正文对话框状态、素材选择与生成上下文 |
| `src/composables/` | Writer 的增删改查、续写、润色、生成与提示词编排控制器 |
| `src/utils/writer/`、`src/types/writer.ts` | 提示词与解析辅助函数，以及 Writer 共享类型约定 |

## 其他功能的拆分边界

| 功能 | 模块与职责 |
|------|------------|
| AI 助手 | `stores/assistant.ts` 选择全局/独立策略并隔离会话及摘要归属；`utils/contextPolicy.ts` 归一化并选择策略；[策略说明](docs/assistant-context-policy.md) |
| ShortStory | `useShortStoryWorkspace.ts`； `components/short-story/ShortStoryPromptSelector.vue`；`useShortStoryConfig.ts` 管理独立默认值和异步保存；`useShortStoryGeneration.ts` 管理独立可取消请求；`utils/shortStoryPrompts.ts` 构建提示词 |
| BookAnalysis | `useBookAnalysisWorkspace.ts`； `components/book-analysis/BookFileImportPanel.vue`；`useBookAnalysisFile.ts` 管理最新导入请求和编码；`utils/bookAnalysisContext.ts` 处理分章、选择范围与提示词 |
| NovelManagement | `useNovelManagementWorkspace.ts`； `components/novel-management/NovelMetadataForm.vue` 复用创建/编辑表单；`utils/novelList.ts` 处理筛选和不修改原集合的排序 |
| ToolsLibrary | `useToolsLibraryWorkspace.ts`； `components/tools/ToolCatalog.vue`；`config/tools.ts` 统一工具定义；`utils/toolForms.ts` 校验必填项；`utils/toolPrompts.ts` 处理模板及所选小说/章节上下文 |
| 思维导图 | `useMindMapDraft.ts` 检查来源冲突并等待保存；`utils/mindmapEditing.ts` 生成编辑快照、校验并保留实体字段；[编辑协议](docs/mindmap-editing.md) |
| 编辑器销毁 | `utils/destroyEditor.ts` 在销毁 wangEditor 前取消待执行的选区节流回调 |

表中路径相对于 `src/`；`use*.ts` 控制器位于 `src/composables/`。四个父页面使用 `lang="ts"` 组装界面，各自的 Workspace 控制器负责响应式状态、生成与持久化编排；`useGenerationTask.ts` 统一请求归属和取消。

## 校验与发布

- [浏览器测试](scripts/browser-testing.md)：CI 检查、本地 Chromium 回归与可选预览。
- [发布说明](scripts/releasing.md)：通过校验的静态构建、校验和及源码/CI 信息。
- [更新日志](CHANGELOG.md)：已发布变更和未发布工作。
