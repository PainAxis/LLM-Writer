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

- **Fact relationship graph**: Cytoscape.js displays people, events, objects and places, with clickable chapter/revision/quote evidence. Create and review source-anchored relationships, distinguish explicit statements, model inference and author confirmation, and optionally request model proposals from selected disclosed excerpts. Old revisions and future evidence are excluded from the visible graph. See [graph scope and walkthrough](docs/memory-fact-graph.md).
- **Writer memory evidence**: Opt in for chapter-body generation, continuation or polishing, select a disclosure cutoff, then preview and approve exact excerpts before generation. Sources are rechecked before transport, completion and application. Embeddings and reranking require separate explicit enablement with route-session credentials. See [Writer retrieval context](docs/writer-memory-context.md).
- **Memory retrieval prototype**: Orama keyword and author-marked clue retrieval, optional semantic embeddings and reranking, chapter revision checks, disclosure cutoffs before external requests, and source evidence. Changed chapters update incrementally; returning from a Writer tab can reuse compatible cached vectors after fresh source validation. External services are off by default; their settings and keys stay in the page session. Open **记忆检索 · 原型** in the sidebar; see [scope and walkthrough](docs/memory-prototype.md).

### Writing Workbench
- **Novel management**: template-based project creation, metadata, three-state chapters (draft / done / published), covers, import & export; chapter edits keep visible-text totals consistent with previews and exports
- **AI writing assistant**: smart continuation (200-5000 chars), content polishing (grammar / style / emotion / logic), all-material generation, streaming output, interrupt anytime
- **Corpus library**: per-novel data with legacy JSON import and portable export, including named empty drafts; category management, title/content search, **context-aware material recommendation with one-click injection** (character bigram relevance scoring)
- **Event line**: chapter association, multi-select participating characters, list / timeline views
- **Writing tools library**: 10 generators — outline / characters / ideas / titles / genre / worldbuilding / golden finger / golden opening / synopsis / conflict; compatible templates honor the selected novel, reference chapters and form parameters
- **Mind map**: mind map generated from novel data (chapters / events / characters / worldbuilding / corpus), with editable titles/entities, validated save/cancel and theme-aware PNG export

### AI & Utilities
- **AI assistant system**: multi-persona assistants, per-assistant isolated chat history, measured virtual scrolling, streaming chat and global/custom context policies
- **Writing extensions**: opt-in project read/search tools, remote MCP tool authorization and imported writing Skills with on-demand references, cancellation and execution records. See [extensions](docs/extensions.md).
- **Context budget management**: dual-dimension budget (tokens / entries), sliding-window truncation vs incremental summary as explicit alternatives, failure handling via dialogs (no silent degradation)
- **Model list sync**: one-click pull of server-side model lists with caching; built-in common models as fallback
- **Prompt library**: category management, variable system, import & export, usage statistics
- **Book analysis**: UTF-8/GBK TXT decoding and browser-side DOCX text extraction; whole-line chapter-heading detection, explicit chapter selection for analysis and optional length-based splitting; 5-dimension AI analysis, a persistent reference library, and report backup/restore
- **Short fiction**: multi-template short-form writing
- **Writing goals**: daily / weekly / monthly, chapter-count and custom targets; shared progress/history across both entry points, with word statistics restricted to word units
- **Generation budgets**: persisted output ceilings and model-aware thinking controls (effort, on/off or token budget), with provider defaults and local validation. See [generation budgets](docs/generation-budgets.md).
- **Token billing**: local usage statistics and cost ledger (no real charges), usage-source labels, exact model/type/date filters and 7/30/90-day charts from recorded usage

### Engineering
- **Tiered local storage**: localStorage + IndexedDB auto-tiering with versioned content shards; old shards are cleaned up only after metadata commits. Save status follows actual completion and supports retry. Failed content loading blocks project access while preserving stored data
- **System backups**: v2 JSON provides selectable novels, prompts, genres, goals, assistants, the book-analysis reference library and settings, including imported Skills and MCP tool authorization. Imports validate data before restoring and attempt rollback on write failure. Selected API settings include API keys; MCP session tokens are excluded. Actual-novel fact graphs are included with the novels category, preserving review states and exact source anchors; the private memory demo is excluded. See [graph backup and mobile acceptance](docs/graph-backup-mobile.md)
- **Workbench modules**: `useWriterProject` handles project loading, chapter switching and autosave; `WriterEditor` encapsulates the rich-text editor. Navigation waits for saving and preserves the editing context on failure
- **Dark mode**: light / dark / system themes, follows system preference automatically
- **On-demand loading**: route-level lazy loading; the home page has no static dependency on the AI SDK, editor or mind-map libraries. The writing editor loads when a chapter is opened, and the DOCX parser loads during import

## 🛠️ Tech Stack

| Category | Choice |
|----------|--------|
| Framework | Vue 3.5 (Composition API + `<script setup>`) |
| State management | Pinia 4 |
| Router | Vue Router 5 (hash mode, route-level lazy loading) |
| UI | Element Plus 2.14 + @element-plus/icons-vue |
| Editor | WangEditor 5.1 |
| Mind map | mind-elixir 4.3 |
| Fact graph | Cytoscape.js 3.34.3 |
| Build | Vite 8 (Rolldown) + unplugin-auto-import/components |
| Language / quality | TypeScript 5.9 + ESLint 10 (flat config) + Prettier 3 |
| AI integration | Vercel AI SDK 7 (unified multi-provider abstraction) |
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

These browser-independent module and integration regressions use a local Mock SSE server, in-memory fake IDB and document fixtures; no real API keys are required. After changes, run `npm run typecheck`, `npm run lint` and the relevant smoke scripts. Use `npm run build` for the production build.

```bash
npm run smoke:all                     # Run all module smoke suites sequentially
npm run smoke:ai                      # AI SDK: streaming, probing, abort, model fetch and proxy
npm run smoke:ai-scope                # Request isolation, cancellation and stale callbacks
npm run smoke:compactor               # Context budgets, sliding window and incremental summaries
npm run smoke:persistence             # Shard commits, failure recovery, queues and hydration
npm run smoke:persistence-retry       # Global retry keeps current edits and rollback state consistent
npm run smoke:writer-stream           # Chapter switching, dialog lifecycle and late stream results
npm run smoke:writer-init             # Project loading, material isolation and save/switch races
npm run smoke:writer-actions          # Failed edits/deletes, retry and async chapter selection
npm run smoke:management-persistence  # Management pages wait for durable saves before UI changes
npm run smoke:writer-content          # Safe rich-text conversion, paragraph boundaries and visible-text counts
npm run smoke:management-correctness  # Consistent chapter totals, legacy exports and safe previews
npm run smoke:billing-correctness     # Usage evidence, exact filters and local-calendar trends
npm run smoke:tools-workspace         # Actual tool handlers, selected IDs and template contracts
npm run smoke:book-import             # TXT/DOCX parsing, encodings and local chapter splitting
npm run smoke:backup                  # v2/legacy backups, validation, restore and rollback
npm run smoke:graph-backup            # Graph round-trip, disclosure and conditional restore failures
npm run smoke:writer-memory          # Source, budget and optional-provider boundaries
npm run smoke:memory-remote-guard     # Per-request Worker freshness handshake
npm run smoke:writer-memory-lifecycle # Preparation, cancellation and application
npm run test:browser-writer-memory   # Three Writer paths and narrow-screen requests
npm run test:writer-memory-stress    # 1.44M/10.5M-character context workloads
npm run smoke:bundle                  # In-memory production build: home and feature dependency graphs
npm run smoke:corpus                  # Keyword retrieval, scoring and injection budgets
npm run smoke:corpus-transfer         # Legacy/portable files, validation and collision preservation
npm run smoke:virtual-messages        # Long-history windows and measured row boundaries
npm run smoke:mindmap                 # Mind-map branches, mounting and truncation fallback
npm run smoke:eventline               # Chapter-number migration and compatibility
npm run smoke:prompts                 # Default prompts and merge rules
npm run smoke:memory                  # Local memory, revisions, disclosure and capacity
npm run smoke:memory-incremental      # Changed chapters, index reuse and recovery
npm run smoke:memory-client           # Worker invalidation and cache lifecycle
npm run smoke:memory-providers        # Embedding/reranking wire formats and response validation
npm run smoke:memory-hybrid           # Hybrid retrieval, cache, fallback and stale results
npm run smoke:memory-fact-graph       # Source-anchored graph, revisions, disclosure and long-novel fixtures
npm run smoke:memory-fact-store       # Graph storage, failed writes and concurrent tabs
npm run smoke:memory-fact-extraction  # Bounded model proposals, source-only requests and invalid output
```

CI is configured to run strict lint, the production build, 72 smoke suites and 88 Chromium scenarios (79 shorter scenarios plus nine long-novel stress scenarios) on pull requests and main updates. A separate memory-stress job also runs local capacity and controlled-provider workloads. These counts describe the configured coverage; check the current revision’s CI results for validation status. See [incremental indexing and cache lifecycle](docs/memory-incremental-index.md), [long-novel stress tests and results](docs/memory-stress-tests.md) and [local browser setup](scripts/browser-testing.md).

### First Use
1. Click "API Config" at the top right, choose a provider and fill in the API base URL and key (optional: sync model list, configure proxy prefix)
2. Create a novel project or go straight to "Writer"
3. Start creating with AI generation, continuation and polishing

## 📖 Project Documentation

- [Project Structure](PROJECT_STRUCTURE.md)
- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md) · [Download releases](https://github.com/PainAxis/LLM-Writer/releases) · [Release process](scripts/releasing.md)

## 🐳 Docker Deployment

See [DOCKER_DEPLOY.md](DOCKER_DEPLOY.md) for details.

```bash
# Development environment (port 3000)
docker compose --profile dev up

# Production environment (nginx, port 80)
docker compose --profile prod up
```

## 📄 License

This project is released under the **GNU GPL v3** (GPL-3.0-or-later), see [LICENSE](LICENSE).

- When redistributing this project (or modified versions) under GPL v3, you must license it under GPL v3 as well and provide the complete source code
