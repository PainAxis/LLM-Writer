# 📚 LLM-Writer - AI-Powered Novel Writing Tool

> A pure front-end AI novel writing platform built with Vue 3 + TypeScript + Element Plus.

[English](README.md) | [简体中文](README.zh-CN.md)

[![Vue](https://img.shields.io/badge/Vue-3.5-4FC08D?style=flat-square&logo=vue.js)](https://vuejs.org/)
[![Element Plus](https://img.shields.io/badge/Element%20Plus-2.14-409EFF?style=flat-square&logo=element)](https://element-plus.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite)](https://vite.dev/)
[![TypeScript](https://img.shields.io/badge/TS-5.9-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![License: GPL v3](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

## ✨ Product Statement
- Pure front-end project: all data is stored locally in your browser, no cloud sync service
- LLM APIs are fully user-configured: built-in presets for OpenAI / Anthropic / Gemini / DeepSeek / Groq / xAI / Kimi / Qwen / Zhipu GLM, plus any **OpenAI-compatible endpoint** (including locally deployed ollama, lmstudio, etc.)
- No official hosted API service; API keys are never sent to any server of this project
- Optional proxy prefix (self-hosted reverse proxy / CORS forwarding) and custom request headers
- Built-in prompts are presets for demonstration; configure your own prompt library

## 🚀 Features

### Writing Workbench
- **Novel management**: template-based project creation, metadata, three-state chapters (draft / done / published), covers, import & export
- **AI writing assistant**: smart continuation (200-5000 chars), content polishing (grammar / style / emotion / logic), all-material generation, streaming output, interrupt anytime
- **Corpus library**: category management, title/content search, **context-aware material recommendation with one-click injection** (character bigram relevance scoring)
- **Event line**: chapter association, multi-select participating characters, list / timeline views
- **Writing tools library**: 10 generators — outline / characters / ideas / titles / genre / worldbuilding / golden finger / golden opening / synopsis / conflict
- **Mind map**: read-only mind map generated from novel data (chapters / events / characters / worldbuilding / corpus), with PNG export

### AI & Utilities
- **AI assistant system**: multi-persona assistants, per-assistant isolated chat history, streaming chat
- **Context budget management**: dual-dimension budget (tokens / entries), sliding-window truncation vs incremental summary as explicit alternatives, failure handling via dialogs (no silent degradation)
- **Model list sync**: one-click pull of server-side model lists with caching; built-in common models as fallback
- **Prompt library**: category management, variable system, import & export, usage statistics
- **Book analysis**: TXT/DOCX import, 5-dimension AI analysis, result management
- **Short fiction**: multi-template short-form writing
- **Writing goals**: daily / weekly / monthly targets, progress tracking, achievement incentives
- **Token billing**: local usage statistics and cost ledger (simulated)

### Engineering
- **Tiered local storage**: localStorage + IndexedDB auto-tiering, long-form content sharding, quota protection and fallback
- **Dark mode**: light / dark / system themes, follows system preference automatically
- **On-demand loading**: route-level lazy loading; the AI SDK, editor and mind map are separate async chunks with zero first-screen cost

## 🛠️ Tech Stack

| Category | Choice |
|----------|--------|
| Framework | Vue 3.5 (Composition API + `<script setup>`) |
| State management | Pinia 4 |
| Router | Vue Router 5 (hash mode, route-level lazy loading) |
| UI | Element Plus 2.14 + @element-plus/icons-vue |
| Editor | WangEditor 5.1 |
| Mind map | mind-elixir 4.3 |
| Build | Vite 8 (Rolldown) + unplugin-auto-import/components |
| Language / quality | TypeScript 5.9 + ESLint 10 (flat config) + Prettier 3 |
| AI integration | Vercel AI SDK 5 (unified multi-provider abstraction) |
| Local storage | localStorage + IndexedDB (auto-tiering) |

## 📦 Quick Start

```bash
# Requirements: Node.js >= 20.19 (22+ recommended)
npm install

# Start dev server (http://localhost:7520)
npm run dev

# Production build (with type checking)
npm run build

# Type check only / Lint / Format
npm run typecheck
npm run lint
npm run format
```

### Smoke Tests

Browser-independent end-to-end verification scripts (local Mock SSE server + in-memory fake IDB):

```bash
npm run smoke:ai           # AI SDK: streaming / billing / probing / abort / model fetch / proxy (10 tests)
npm run smoke:compactor    # Context compaction: budget / sliding window / incremental summary (6 tests)
npm run smoke:persistence  # Storage tiering: direct write / sharding / hydration / rollback (5 tests)
npm run smoke:corpus       # Corpus retrieval: keywords / scoring / injection budget (4 tests)
npm run smoke:mindmap      # Mind map data: branches / mounting / truncation fallback (4 tests)
npm run smoke:eventline    # Event line: chapter-number migration / compatibility (3 tests)
```

### First Use
1. Click "API Config" at the top right, choose a provider and fill in the API base URL and key (optional: sync model list, configure proxy prefix)
2. Create a novel project or go straight to "Writer"
3. Start creating with AI generation, continuation and polishing

## 🐳 Docker Deployment

See [DOCKER_DEPLOY.md](DOCKER_DEPLOY.md) (Chinese) for details; for the refactoring notes see [REFACTORING.md](REFACTORING.md) (Chinese).

```bash
# Development environment (port 3000)
docker compose --profile dev up

# Production environment (nginx, port 80)
docker compose --profile prod up
```

## 📄 License

This project is released under the **GNU GPL v3** (GPL-3.0-or-later), see [LICENSE](LICENSE).

- When redistributing this project (or modified versions) under GPL v3, you must license it under GPL v3 as well and provide the complete source code
