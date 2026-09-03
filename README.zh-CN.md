# 📚 LLM-Writer - AI智能小说创作工具

> 基于 Vue 3 + TypeScript + Element Plus 的纯前端 AI 小说创作平台。

[English](README.md) | [简体中文](README.zh-CN.md)

[![Vue](https://img.shields.io/badge/Vue-3.5-4FC08D?style=flat-square&logo=vue.js)](https://vuejs.org/)
[![Element Plus](https://img.shields.io/badge/Element%20Plus-2.14-409EFF?style=flat-square&logo=element)](https://element-plus.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite)](https://vite.dev/)
[![TypeScript](https://img.shields.io/badge/TS-5.9-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![License: GPL v3](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

## ✨ 产品声明
- 纯前端项目，所有数据保存在本地浏览器中，不提供云同步服务
- 大模型 API 全部由用户自行配置：内置 OpenAI / Anthropic / Gemini / DeepSeek / Groq / xAI / Kimi / 通义千问 / 智谱 GLM 预设，以及任意 **OpenAI 兼容接口**（包括 ollama、lmstudio 等本地部署方案）
- 不提供任何官方托管 API 服务，API 密钥不会发送到本项目的任何服务器
- 支持可选的代理前缀（自建反代/CORS 转发）与自定义请求头
- 内置提示词均为预设演示，可配置自己的提示词库

## 🚀 主要功能

### 创作工作台
- **小说管理**：多类型模板创建项目、元数据管理、章节三状态（草稿/完成/发表）、封面、导入导出
- **AI 写作助手**：智能续写（200-5000字）、内容润色（语法/文风/情感/逻辑）、全素材生成、流式输出、随时中断
- **语料库**：分类管理、标题/内容检索、**按上下文智能推荐素材一键注入**（字符 bigram 重合度评分）
- **事件线**：章节关联、参与角色多选、列表/时间线双视图
- **写作工具库**：细纲/角色/脑洞/书名/题材/世界观/金手指/黄金开篇/简介/冲突 10 大生成器
- **思维导图**：基于小说数据（章节/事件/人物/世界观/语料）自动生成只读导图，支持导出 PNG

### AI 与辅助
- **AI 助手系统**：多助手人设管理、按助手隔离的会话持久化、流式对话
- **上下文容量管理**：Token/条数双量纲预算、截断滑窗与增量摘要两种策略、失败显式弹窗处理（无静默降级）
- **模型列表同步**：一键拉取服务商端模型列表并缓存；内置常用模型兜底
- **提示词库**：分类管理、变量系统、导入导出、使用统计
- **拆书分析**：TXT/DOCX 导入、5 维 AI 分析、结果管理
- **短文创作**：多模板短文/短篇写作
- **写作目标**：日/周/月目标、进度跟踪、成就激励
- **Token 计费**：本地用量统计与成本台账（模拟）

### 工程特性
- **本地存储分层**：localStorage + IndexedDB 自动分层，长篇正文分片存储，配额超限防护与降级
- **暗色模式**：light / dark / system 三态主题，跟随系统自动切换
- **按需加载**：路由级懒加载，AI SDK、编辑器、思维导图均为独立异步 chunk，首屏零负担

## 🛠️ 技术栈

| 类别 | 选型 |
|------|------|
| 框架 | Vue 3.5 (Composition API + `<script setup>`) |
| 状态管理 | Pinia 4 |
| 路由 | Vue Router 5（hash 模式，路由级懒加载） |
| UI | Element Plus 2.14 + @element-plus/icons-vue |
| 编辑器 | WangEditor 5.1 |
| 思维导图 | mind-elixir 4.3 |
| 构建 | Vite 8（Rolldown）+ unplugin-auto-import/components |
| 语言/质量 | TypeScript 5.9 + ESLint 10 (flat config) + Prettier 3 |
| AI 接入 | Vercel AI SDK 5（多服务商统一抽象） |
| 本地存储 | localStorage + IndexedDB（自动分层） |

## 📦 快速开始

```bash
# 环境要求：Node.js >= 20.19（推荐 22+）
npm install

# 启动开发服务器（http://localhost:7520）
npm run dev

# 构建生产版本（含类型检查）
npm run build

# 仅类型检查 / Lint / 格式化
npm run typecheck
npm run lint
npm run format
```

### 冒烟测试

无浏览器依赖的端到端验证脚本（本地 Mock SSE 服务器 + 内存 fake-IDB）：

```bash
npm run smoke:ai           # AI SDK：流式/计费/探活/中断/模型拉取/代理（10 项）
npm run smoke:compactor    # 上下文压缩：预算/滑窗/增量摘要（6 项）
npm run smoke:persistence  # 存储分层：直写/分片/回填/回滚（5 项）
npm run smoke:corpus       # 语料检索：关键词/评分/注入预算（4 项）
npm run smoke:mindmap      # 导图数据：分支/挂载/截断兜底（4 项）
npm run smoke:eventline    # 事件线：章号迁移/兼容（3 项）
```

### 首次使用
1. 点击右上角「API配置」，选择服务商并填入 API 地址与密钥（可选：同步模型列表、配置代理前缀）
2. 创建小说项目或直接进入「写作」
3. 使用 AI 生成、续写、润色开始创作

## 🐳 Docker 部署

详见 [DOCKER_DEPLOY.md](DOCKER_DEPLOY.md)，重构说明见 [REFACTORING.md](REFACTORING.md)。

```bash
# 开发环境（端口 3000）
docker compose --profile dev up

# 生产环境（nginx，端口 80）
docker compose --profile prod up
```

## 📄 开源协议

本项目以 **GNU GPL v3**（GPL-3.0-or-later）发布，详见 [LICENSE](LICENSE)。

- 依 GPL v3 再分发本项目（或其修改版）时，须同样以 GPL v3 授权并提供完整源代码
