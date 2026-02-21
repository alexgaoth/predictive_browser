# Predictive Browser — Shared Setup & Interface Contracts

## READ THIS FIRST — ALL THREE SESSIONS

This document defines the shared project structure, types, and interface contracts. Each session must create only the files assigned to them. The interface contracts below are the **source of truth** — do not deviate from these schemas.

---

## Project Structure

```
predictive-browser/
├── manifest.json                    # SESSION 1 owns this
├── package.json                     # SESSION 2 owns this
├── tsconfig.json                    # SESSION 2 owns this
├── src/
│   ├── types/
│   │   └── interfaces.ts            # SESSION 2 owns this (shared types)
│   ├── content/
│   │   ├── extractor.ts             # SESSION 1 ONLY
│   │   ├── transformer.ts           # SESSION 3 ONLY
│   │   └── index.ts                 # SESSION 1 owns, imports from extractor + transformer
│   ├── background/
│   │   ├── service-worker.ts        # SESSION 2 ONLY
│   │   ├── llm-engine.ts            # SESSION 2 ONLY
│   │   └── profile-manager.ts       # SESSION 2 ONLY
│   └── popup/
│       ├── popup.html               # SESSION 2 ONLY
│       ├── popup.ts                 # SESSION 2 ONLY
│       └── popup.css                # SESSION 2 ONLY
├── assets/
│   └── icon.png                     # SESSION 1 provides a placeholder
└── dist/                            # Build output
```

### FILE OWNERSHIP RULES
- **Never create or edit a file owned by another session**
- If you need something from another session's file, import it via the shared types in `src/types/interfaces.ts`
- Session 2 owns `interfaces.ts` but all three sessions must conform to the schemas defined below

---

## Interface Contract 1: PageSkeleton

**Producer:** Session 1 (Extractor)
**Consumer:** Session 2 (LLM Engine)

```typescript
interface SkeletonNode {
  /** Unique ID assigned during extraction (e.g., "node-0", "node-1") */
  id: string;
  /** CSS selector that uniquely identifies this element */
  selector: string;
  /** Semantic tag: "heading", "nav", "section", "link", "image", "text", "list", "form", "unknown" */
  type: "heading" | "nav" | "section" | "link" | "image" | "text" | "list" | "form" | "unknown";
  /** First ~80 chars of visible text content */
  textPreview: string;
  /** Tag name (e.g., "div", "h1", "a") */
  tag: string;
  /** Heading level if applicable (1-6) */
  headingLevel?: number;
  /** href if it's a link */
  href?: string;
  /** alt text if it's an image */
  alt?: string;
  /** Child nodes */
  children: SkeletonNode[];
}

interface PageSkeleton {
  /** The URL of the page */
  url: string;
  /** Page title from <title> tag */
  title: string;
  /** Meta description if available */
  metaDescription: string;
  /** The skeleton tree */
  nodes: SkeletonNode[];
  /** Timestamp of extraction */
  extractedAt: number;
}
```

---

## Interface Contract 2: TransformInstruction

**Producer:** Session 2 (LLM Engine)
**Consumer:** Session 3 (Transform Executor)

```typescript
type TransformAction = "highlight" | "collapse" | "reorder" | "annotate" | "dim";

interface TransformInstruction {
  /** Which action to perform */
  action: TransformAction;
  /** CSS selector targeting the element (from SkeletonNode.selector) */
  selector: string;
  /** Human-readable reason for this transform (shown in debug/tooltip) */
  reason: string;
  /** For "reorder": target position — "top" of parent or "above:{selector}" */
  position?: "top" | string;
  /** For "annotate": text to display as a small badge/tooltip */
  annotation?: string;
  /** Relevance score 0-100, used for animation priority ordering */
  relevance: number;
}

interface TransformResponse {
  /** Array of transforms to apply, ordered by relevance (highest first) */
  transforms: TransformInstruction[];
  /** One-line summary of what was changed and why (for optional UI toast) */
  summary: string;
  /** Inferred user intent used for this transformation */
  inferredIntent: string;
}
```

---

## Interface Contract 3: UserProfile

**Producer:** Session 2 (Profile Manager)
**Consumer:** Session 2 (LLM Engine) — internal to Session 2, but documented for clarity

```typescript
interface UserProfile {
  /** Free-text from onboarding: "What are you focused on right now?" */
  currentFocus: string;
  /** Extracted topics/interests from browsing history */
  interests: string[];
  /** Recent URLs visited (last 50) */
  recentUrls: string[];
  /** Seed profile for cold start */
  seedContext: string;
  /** Last updated timestamp */
  updatedAt: number;
}
```

---

## Interface Contract 4: Message Passing (Chrome Runtime)

Communication between content script and background service worker uses Chrome message passing.

```typescript
// Content script → Background: "Here's a skeleton, give me transforms"
interface SkeletonMessage {
  type: "SKELETON_READY";
  payload: PageSkeleton;
}

// Background → Content script: "Here are your transforms"
interface TransformMessage {
  type: "TRANSFORMS_READY";
  payload: TransformResponse;
}

// Background → Content script: "Something went wrong"
interface ErrorMessage {
  type: "TRANSFORM_ERROR";
  payload: { message: string };
}

type ExtensionMessage = SkeletonMessage | TransformMessage | ErrorMessage;
```

---

## Build Setup

Session 2 owns `package.json` and `tsconfig.json`. Use these exact configs:

### package.json
```json
{
  "name": "predictive-browser",
  "version": "0.1.0",
  "scripts": {
    "build": "tsc && cp src/popup/popup.html dist/popup/ && cp src/popup/popup.css dist/popup/ && cp manifest.json dist/ && cp -r assets dist/",
    "watch": "tsc --watch"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@anthropic-ai/sdk": "^0.39.0"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

---

## How the Three Components Connect

```
┌─────────────────────────────────────────────────────┐
│                   CONTENT SCRIPT                     │
│  ┌──────────────┐              ┌──────────────────┐ │
│  │  EXTRACTOR    │              │   TRANSFORMER    │ │
│  │  (Session 1)  │              │   (Session 3)    │ │
│  │              │              │                  │ │
│  │  DOM → Skel. │              │  Instructions →  │ │
│  │  PageSkeleton│──────┐ ┌────│  DOM mutations   │ │
│  └──────────────┘      │ │    └──────────────────┘ │
│                        │ │                          │
│        index.ts (Session 1) orchestrates:           │
│        1. Calls extractor                           │
│        2. Sends skeleton via chrome.runtime         │
│        3. Receives transforms                       │
│        4. Calls transformer                         │
└────────────────────────│─│──────────────────────────┘
                         │ │
          chrome.runtime │ │ chrome.runtime
          .sendMessage   │ │ .sendMessage
                         │ │
┌────────────────────────│─│──────────────────────────┐
│               BACKGROUND SERVICE WORKER              │
│                    (Session 2)                        │
│                        │ │                           │
│  ┌─────────────┐  ┌───▼─▼────────┐  ┌───────────┐ │
│  │   PROFILE    │  │  SERVICE      │  │   LLM     │ │
│  │   MANAGER    │──│  WORKER       │──│  ENGINE   │ │
│  │              │  │  (router)     │  │  (Gemini) │ │
│  └─────────────┘  └──────────────┘  └───────────┘ │
└─────────────────────────────────────────────────────┘
```

## Testing Strategy

Each session should export a test function that validates their component in isolation:

- **Session 1:** `testExtractor()` — run on a sample HTML string, verify PageSkeleton output matches schema
- **Session 2:** `testEngine()` — feed a mock PageSkeleton + UserProfile, verify TransformResponse output
- **Session 3:** `testTransformer()` — inject sample HTML into DOM, apply mock TransformInstructions, verify DOM state

---

## IMPORTANT: Merge Order

When combining:
1. Session 2's package.json, tsconfig.json, interfaces.ts go in first (foundation)
2. Session 1's files go in next (extractor + manifest + index.ts)
3. Session 3's files go in last (transformer)
4. Run `npm install && npm run build`
5. Load `dist/` as unpacked extension in Chrome
