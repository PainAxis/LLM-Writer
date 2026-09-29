# LLM-Writer 目录结构

[English](PROJECT_STRUCTURE.md) | [简体中文](PROJECT_STRUCTURE.zh-CN.md)

本文介绍当前源码布局，后续工作见[路线图](ROADMAP.zh-CN.md)。

## 顶层目录

| 路径 | 用途 |
|------|------|
| `src/` | 应用源码 |
| `public/` | 网站图标等静态资源 |
| `scripts/` | 模块冒烟测试、浏览器回归与预览工具、部署脚本 |
| `scripts/fixtures/` | 文档导入使用的合成测试文件 |
| `.github/workflows/` | GitHub Actions 工作流，包括临时浏览器预览 |
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
| `src/components/` | 共享 UI 组件，以及 Writer 的面板、对话框与编辑器 |
| `src/composables/` | 写作、AI 流式生成、提示词选择与主题等响应式流程 |
| `src/services/api.ts`、`src/services/aiProviders.ts`、`src/services/apiConfig.ts` | AI SDK 接口封装、服务商适配、模型发现与共享 API 配置 |
| `src/services/novelPersistence.ts`、`src/services/blobStore.ts` | 小说保存队列、带版本的 IndexedDB 正文分片与启动回填 |
| `src/services/backup.ts`、`src/services/billing.ts` | 备份校验与恢复、本地用量和成本记账 |
| `src/stores/novel.ts`、`src/stores/assistant.ts` | 写作与助手会话的 Pinia 状态 |
| `src/utils/storage.ts`、`src/utils/aiRequestScope.ts` | 统一存储入口，以及可独立取消的 AI 请求作用域 |
| `src/utils/writer/` | Writer 提示词构建与响应解析 |
| `src/utils/` | 上下文预算与压缩、语料检索、文档导入、章节解析、事件与导图数据处理 |
| `src/types/` | API、Writer 共享类型与第三方库声明 |
| `src/config/` | 默认提示词库与公告 |

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
