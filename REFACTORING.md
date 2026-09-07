# LLM-Writer Refactoring Report

[English](REFACTORING.md) | [简体中文](REFACTORING.zh-CN.md)

> Original reference project: [91Writing](https://github.com/ponysb/91Writing) v0.7.0 (a pristine local copy is retained without changes and is not distributed with this repository)
> Refactored product: `LLM-Writer` (this directory). The project implementation is inspired by 91Writing and has no affiliation beyond that; all original project branding elements (official APIs, community groups, etc.) have been removed.

## I. Refactoring Overview

| Dimension | Before Refactor | After Refactor |
|-----------|-----------------|----------------|
| Language | Pure JavaScript | Core layer TypeScript (services/stores/router/composables/utils/config), view layer progressively migrated |
| Build Tool | Vite 4.5 (Rollup) | Vite 8.2 (Rolldown) |
| Framework | Vue 3.3 / Pinia 2 / Router 4 | Vue 3.5 / Pinia 4 / Router 5 |
| UI Library | Element Plus 2.4 | Element Plus 2.14 |
| ESLint | 8.x, missing config file, lint script unusable | ESLint 10 flat config + Prettier 3 + vue/ts rules, 0 errors |
| First-load JS | 2,427 KB (single chunk) | 38.7 KB (chunk splitting + lazy loading) |
| API Config Implementation | 4 independent / isolated implementations | 1 unified implementation (`services/apiConfig.ts`) |
| localStorage Access | 15 files, 100+ direct reads/writes across 20+ magic keys | Unified `utils/storage.ts` single entry point (all ~70 bare calls across 11 files closed off, explicit throws on quota exceeded) |
| Streaming "Stop" Button | Only reset UI state, network request continued | `AbortController` genuinely cancels request |

## II. Completed Work

### Phase 1: Cleanup
- Deleted ~12,300 lines of dead code: root old `Writer.vue`/`api.js`, unrouted `Home.vue` and its 7 orphan components, obsolete `Writer_refactored.vue` + `components/writer/`, `api-test.js` with hardcoded API keys, empty files `prompt.txt`/`docker-deploy.md`, unrelated `modern-website.html`, dual lockfiles
- Fixed `.gitignore` (dist/env/logs), added missing favicon (`public/favicon.svg`)
- Dependency trimming: removed unused axios / file-saver / highlight.js / @vueuse/core

### Phase 2: Toolchain
- TypeScript 5.9 + vue-tsc, all green on `npm run build` / `npm run typecheck`
- ESLint 10 flat config (`eslint.config.js`) + Prettier (`.prettierrc.json`)
- Vite 8 (Rolldown core) + `manualChunks` manual code splitting

### Phase 3: Architecture
- `src/utils/storage.ts`: centralized registration of all localStorage keys (`StorageKeys`), type-safe read/write, JSON exception guards
- `src/services/apiConfig.ts`: **Single source of truth for API config** (subsequent rebranding: removed official API concept, consolidated into single configuration; `views/ApiConfig.vue` rewritten into a single form)
  - Eliminated 4 redundant implementations (embedded in store / embedded in `api.js` / `views/ApiConfig.vue` orphan key `aiApiConfigs` / Dashboard polling localStorage)
  - Official baseURL enforcement centralized in one place; legacy `apiConfig` key automatically migrated
  - Reactive sharing: removed Dashboard's 1-second polling + `forceUpdate` hack + storage event listeners entirely
- `src/services/api.ts`: TS rewrite, preserved original behavior for SSE parsing, billing hooks, and error handling; added abort support; fixed bug where `analyzeArticle` used the wrong model field
- `src/services/billing.ts`: TS rewrite (local simulated bookkeeping)
- `src/stores/novel.ts`: TS rewrite, delegated configuration to apiConfig module, fixed 3 duplicated `generateUniqueId` calls
- `views/ApiConfig.vue`: 1,170-line isolated page → 40-line thin wrapper reusing unified `components/ApiConfig.vue`

### Phase 4: Common Modules
- `src/composables/useAIStream.ts`: unified state machine for streaming generation (status / delta / abort / error prompts), replacing 24 isomorphic boilerplate instances in Writer
- `src/utils/chapterParser.ts`: 5-level parsing strategy for AI chapter responses (originally 270 lines inside Writer)
- `src/config/defaultPrompts.ts`: single source of truth for default prompt library (previously maintained separately across Writer/PromptsLibrary/ShortStory); fixed duplicate default prompt ID (two id=22)
- Writer.vue integrated with above modules (net deletion of ~550 lines)

### Phase 6: Performance
- Route-level lazy loading: all 13 subroutes converted to `() => import(...)`, added 404 page (`views/NotFound.vue`)
- `main.js` → `main.ts`
- Docker: node:18+pnpm → node:22+npm ci, aligned dev port (3000), removed pointless `depends_on`

## II.V. LLM API Configuration Refactoring (Vercel AI SDK Integration)

- **Dependencies**: ai@7 + @ai-sdk/openai-compatible@3 + @ai-sdk/anthropic@4 + @ai-sdk/google@4 (aligned to @ai-sdk/provider@4 spec)
- **Provider Preset Table** (`services/aiProviders.ts`): OpenAI / Anthropic / Google Gemini / DeepSeek / Groq / xAI / Moonshot Kimi / Alibaba Qwen / Zhipu GLM / custom OpenAI-compatible endpoints (ollama, lmstudio, etc.)
  - Anthropic and Gemini use official native provider packages (previously did not support their native API formats)
  - All others use openai-compatible layer; required declaration headers for Anthropic direct browser connection are automatically attached by presets
- **api.ts rewrite**: replaced handcrafted fetch + SSE parser (~300 lines) with streamText/generateText; facade interface (`generateTextStream`, etc.) signatures preserved with zero caller modifications
  - Free benefits: SDK built-in retries (maxRetries: 2), structured errors, real usage extraction
  - Preserved abort / timeout semantics: 5-minute timeout + return partial content upon abort
  - Services layer no longer calls ElMessage directly (decoupled from UI)
- **Configuration model**: ApiConfig adds provider, customHeaders (CORS escape hatch, visual editing in config UI); legacy configuration automatically migrated (provider falls back to custom)
- **Bundle control**: ai core and provider packages dynamically imported into independent async chunks (~400KB), loaded only when AI features are invoked for the first time, not affecting first screen
- **Unsupported (architectural limitations)**: Bedrock / Vertex AI require server-side signature credentials, cannot be connected securely in pure front-end apps
- **Model list synchronization**: `fetchProviderModels()` pulls from provider `/models` endpoints (OpenAI-compatible / Anthropic `{data:[{id}]}`, Google `{models:[{name}]}` filtered by generateContent), cached and persisted per provider (`providerModels`); one-click "fetch / sync model list" on config page, model dropdown in both config page and Dashboard shows "🛰️ Server Model List" group, built-in common models act only as fallback when unsynced
- **Runtime verification**: `npm run smoke:ai` — local Mock SSE server end-to-end test (streaming parse / real usage billing / key probing / abort partial recovery / config persistence)

## II.VI. Frontend Visual System Refactoring ("Ink & Paper" Theme)

- **Design token centralization**: `src/style.css` rewritten as site-wide design system — brand color (indigo `#4f46e5`), cool slate-blue neutral scales (ink series), semantic colors, border radius / shadow specs, mapped to Element Plus CSS variables (`--el-color-primary`, etc.), automatically restyling EP components across all 15 views
- **Legacy color cleanup**: 441 hardcoded legacy colors across 14 files (`#409eff`/`#304156`/`#f5f5f5`, etc., 2017 admin style) mechanically mapped to semantic CSS variables; future theme adjustments only require editing style.css in one place
- **Dashboard shell reshaping**: 2017-style dark blue sidebar → light paper-textured sidebar + capsule menu interactions + gradient serif logo watermark; frosted glass header effect; page-fade transition animations on route change
- **Common component texture unification** (global layer): large card border-radii + soft elevation shadows, capsule tags, rounded dialogs/message boxes, layered button shadows, table header styling, slim floating scrollbars, `::selection` brand color
- **Dark mode**: light / dark / system tri-state theme (composables/useTheme.ts), syncs with system `prefers-color-scheme` in real time; Element Plus dark variables + custom ink/brand scales semantically inverted under html.dark; initTheme() executes prior to app mounting to prevent first-frame flash; cyclic toggle button provided in Dashboard header
- **Modern font stack**: system font stack (SF Pro / PingFang SC / HarmonyOS Sans SC / MiSans), serif fonts used for logo and favicon to reflect "writing tool" identity; zero webfont dependencies

## II.VII. Creative Feature Completion (2026-09-02)

### Storage Tiering (localStorage + IndexedDB)
- **storage consolidation**: all ~70 bare `localStorage.*` calls across 11 files migrated to `storageGet/storageSet/storageRemove/storageClear` (+ Raw version bypassing JSON serialization); corrupted JSON changed from throwing exceptions to warn + fallback
- **Quota protection**: on `storageSet` QuotaExceeded → clear renewable cache (server model lists) and retry once → if still exceeded, throw synchronously to restore view-layer "save failed" prompt semantics
- **IndexedDB tiering**: `services/blobStore.ts` (lightweight single kv store wrapper with automatic fallback on failure) + `services/novelPersistence.ts` (novels key backend): overall content ≤ 1.5M characters writes directly to LS fast path; chapter bodies exceeding threshold (> 2K characters) sharded into IDB, LS keeps metadata + pointers, IDB-before-LS write order + stale shard cleanup; `initNovelPersistence()` hydration gate on startup; lazy migration (first write naturally triggers splitting)
- **chunked key registration**: `registerChunkedKey(key, backend)`, storageGet/Set/Remove/Clear delegates entire keys to backend for registered keys, zero changes to view layer

### AI Assistant System + Context Budget Management
- **API extensions**: `GenerateOptions` adds `system?`/`messages?` (messages take precedence); `model` truly wired up for the first time (billing based on actual model); `chatWithAI` third argument customizes persona and converges onto streaming path
- **Assistant CRUD**: `stores/assistant.ts` (Pinia setup-style) — persona/default model management, per-assistant isolated session persistence, streaming placeholder items, cleanup on abort/failure; `views/AssistantManagement.vue` (TS)
- **Context policy** (`utils/contextCompactor.ts` pure function): dual-dimension budget of max tokens / max messages; **truncation sliding window vs summary incremental summary as explicit binary choice, no silent degradation**; summary failure yields immediate toast + "⚠️ Pending Compaction" badge + dialog on next send (retry / skip one-off / cancel); summary != delete, local persistence retains complete original text
- Settings adds "Context Management" card; token indicator bar and collapse badge in chat area

### Corpus Classification + Retrieval Recommendation
- `utils/corpusRetrieval.ts` (pure function): **character bigram overlap** scoring (robust for Chinese without word segmentation), `extractKeywords`, `recommendCorpus` (minScore filter + top-K), `buildCorpusInjection` (prioritizes full entries, only truncates if first entry exceeds budget)
- Corpus categories (customizable) + category filtering + title/content search; all-material generation dialog has "Recommend by Context" top-5 one-click merge and injection
- `generatePersonalizedContent` updated to overlap score top-8 + 4000 character budget injection (signature preserved), eliminating the risk of large corpus blowing up context/billing

### Mind Map (Read-Only MVP)
- `utils/mindmapData.ts` (pure function): novel → mind-elixir node tree (chapter outlines + event attachments, characters, worldbuilding, corpus grouped by category, orphan events grouped, unified truncation, empty data fallback)
- `views/MindMap.vue` (TS): dynamic import (mind-elixir@4.3.1 isolated chunk ~89KB), `editable:false` + `disableEdit` dual lock read-only, fit to canvas, export PNG (@mind-elixir/export-mindmap)

### Event Line Enhancement + Proxy Configuration
- **Bug fix**: event `chapter` field previously stored chapter title instead of chapter number, `parseInt` evaluated to NaN causing events never to enter generation context; dialog rebound to chapter number + `migrateEventChapters()` (extracted as `utils/eventLine.ts` pure function) one-time migration for legacy data
- Character association multi-select (`characterIds[]`, carried in generation context and mind map); list/timeline dual view (el-timeline, sorted by chapter number → timestamp → creation time)
- **Proxy prefix**: `ApiConfig.proxyUrl?` optional prefix, uniformly applied in `aiProviders.applyProxyPrefix()` for model resolution and probing; smoke tests verify requests genuinely route through proxy

### Quality Assurance
- **Smoke test suite**: `scripts/smoke-*.ts` six scripts with 32 assertions (no browser dependency, Mock SSE + in-memory fake-IDB, CI-ready)
- **Two rounds of code reviews fixed 9 accumulated issues**, including two real bugs: summary strategy off-by-one boundary gap (lost 1 message of history per send), IME Enter inadvertent send (`isComposing`/keyCode 229 check)

## III. Verification Results

```
npm run build              # vue-tsc --noEmit && vite build → Pass
npm run typecheck          # 0 errors
npm run lint               # 0 errors, 83 warnings (historical JS views unused-vars, baseline unchanged)
npm run preview            # HTTP 200, entry chunk normal
npm run smoke:ai           # 10 checks
npm run smoke:compactor    # 6 checks
npm run smoke:persistence  # 5 checks
npm run smoke:corpus       # 4 checks
npm run smoke:mindmap      # 4 checks
npm run smoke:eventline    # 3 checks   —— all 32 assertions across six scripts passed
```

Build output (gzipped):
- First-load: index 21.2 KB + vendor-vue 11.7 KB; Element Plus isolated chunk 327.7 KB (resident UI)
- On-demand async chunks: Writer 44.7 KB, vendor-editor 299.1 KB (editor page only), AI SDK isolated chunk (loaded upon first AI feature invocation), MindElixir 30.6 KB (mind map page only)

## IV. Subsequent Roadmap (Suggested Order)

1. **Further splitting of Writer.vue** (currently ~10,550 lines): `useAIStream` and parsers ready; decompose by functional cluster:
   - `writer/ChapterPanel` (chapter CRUD + batch generation)
   - `writer/CharacterPanel` (character CRUD + batch generation, ~1,100 lines)
   - `writer/WorldviewPanel` (worldbuilding, ~800 lines)
   - `writer/CorpusPanel` / `writer/EventPanel`
   - `writer/dialogs/ContinueDialog`, `writer/dialogs/OptimizeDialog`, `writer/dialogs/PromptSelector`
   - Consolidate persistence into single `saveNovelData` entry point
2. **Migrate remaining streaming call sites to `useAIStream`** (module ready, partially integrated; `chatWithAI` converged to streaming path)
3. **Editable Mind Map**: requires designing store write-back protocol (read-only MVP already launched)
4. **Per-assistant contextPolicy override** (`AssistantInfo.contextPolicy` field already reserved)
5. **Progressive TypeScript migration for view layer**: migrate file by file with `lang="ts"` (the `vue/block-lang` rule is temporarily disabled, to be re-enabled after migration)
6. **Zero lint warnings**: clean up unused variables from historical code
7. Phase 2 candidates: virtualized message lists, merge store legacy corpus with Writer corpusData, adjust mind map canvas background color in dark mode
8. Engineering items: Git repository initialization (currently untracked)

## V. Directory Structure

```
src/
├── main.ts                     # Startup chain: initNovelPersistence gate + initTheme
├── App.vue
├── style.css                   # "Ink & Paper" design tokens + EP variable mapping + dark mode inversion
├── router/index.ts             # 15 lazy-loaded feature routes + 404
├── types/api.ts                # Shared types (including AssistantInfo/ContextPolicy)
├── config/
│   ├── defaultPrompts.ts       # Default prompt library (single source of truth)
│   └── announcements.js
├── services/
│   ├── aiProviders.ts          # 10 provider presets + model list fetching + proxy prefix
│   ├── apiConfig.ts            # Single source of truth for API config
│   ├── api.ts                  # Vercel AI SDK wrapper (streaming/abort/billing hooks/system·messages)
│   ├── billing.ts              # Local simulated billing (token estimation delegated to tokenBudget)
│   ├── blobStore.ts            # IndexedDB single kv store thin wrapper
│   └── novelPersistence.ts     # novels key LS+IDB tiered backend (fast path/sharding/hydrate)
├── stores/
│   ├── novel.ts                # Core Pinia store
│   └── assistant.ts            # Assistant CRUD + session persistence + context compactor state machine
├── composables/
│   ├── useAIStream.ts          # Unified streaming generation state machine
│   └── useTheme.ts             # light/dark/system tri-state theme
├── utils/
│   ├── storage.ts              # localStorage single entry point + chunked key registration
│   ├── tokenBudget.ts          # token estimation + truncation budget registry
│   ├── contextCompactor.ts     # Context compaction pure functions (evaluation/sliding window/incremental summary)
│   ├── corpusRetrieval.ts      # Corpus bigram retrieval & recommendation pure functions
│   ├── mindmapData.ts          # novel → mind-elixir node tree
│   ├── eventLine.ts            # Event chapter number migration pure function
│   ├── chapterParser.ts        # AI chapter response 5-level parser
│   └── id.ts
├── components/                 # ApiConfig, AnnouncementDialog, etc.
└── views/                      # 17 pages (core layer TS, view layer progressively typed)
    ├── Writer.vue              # Writing workbench (~10,550 lines, to be split)
    ├── AssistantManagement.vue # AI Assistant (TS)
    ├── MindMap.vue             # Mind Map (TS)
    └── ...
```
