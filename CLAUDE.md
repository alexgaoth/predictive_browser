# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Predictive Browser** — a Chrome Extension (Manifest V3) that uses Google Gemini Flash to intelligently reshape web pages based on user intent and interests. Written in TypeScript, compiled to ES2020.

## Build Commands

```bash
npm run build    # Compile TypeScript → dist/, copy assets & manifest
npm run watch    # Watch mode for development
```

After building, load `dist/` as an unpacked Chrome extension via `chrome://extensions`.

## Architecture

Three-layer pipeline connected via Chrome message passing (`chrome.runtime.sendMessage`):

**Content Script** (`src/content/`) — runs in the web page context:
- `extractor.ts` — walks the DOM, produces a `PageSkeleton` (semantic tree of up to 150 nodes, max depth 6). Generates stable CSS selectors (priority: #id → [data-testid] → [aria-label] → positional path).
- `transformer.ts` — applies visual transforms (highlight, collapse, reorder, annotate, dim) with FLIP animations and staggered timing. Shows a toast summary.
- `index.ts` — orchestrator. Waits for DOM stability via MutationObserver (500ms debounce, 3s max), then runs extract → send → receive → transform.

**Background Service Worker** (`src/background/`) — runs in the extension process:
- `service-worker.ts` — message router, dispatches "SKELETON_READY" messages.
- `llm-engine.ts` — calls Gemini Flash 2.0 API with the page skeleton + user profile. Returns up to 15 `TransformInstruction`s. Uses JSON mode, low temperature (0.2), defensive parsing.
- `profile-manager.ts` — 3-layer user profile: hardcoded seed → onboarding text from popup → browsing history (last 50 URLs, 7-day window).

**Popup UI** (`src/popup/`) — onboarding interface where users set their focus/interests. Stores to `chrome.storage.local`.

## Shared Contracts

All interfaces live in `src/types/interfaces.ts`. The key contracts:
- **PageSkeleton** (extractor → LLM engine): hierarchical `SkeletonNode[]` tree with semantic types
- **TransformResponse** (LLM engine → transformer): array of `TransformInstruction` with actions, CSS selectors, relevance scores
- **UserProfile** (internal to background): currentFocus, interests, recentUrls, seedContext
- **Message types**: `SKELETON_READY`, `TRANSFORMS_READY`, `TRANSFORM_ERROR`, `UPDATE_FOCUS`

## Session Design Docs

The `0x-SESSION-*.md` files are the authoritative specs for each component. `00-SHARED-SETUP.md` is the source of truth for interface contracts and project structure.
