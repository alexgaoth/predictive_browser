# Session 1: Skeleton Extractor + Content Script Shell

## Your Role
You are building the **front door** of the extension — the content script that runs on every page, extracts a semantic skeleton of the DOM, and orchestrates the full pipeline by calling the extractor, sending the skeleton to the background worker, receiving transforms back, and handing them to the transformer.

## Files You Own
```
manifest.json
assets/icon.png              (placeholder 128x128)
src/content/extractor.ts     (core DOM extraction logic)
src/content/index.ts         (orchestrator — wires extractor to messaging to transformer)
```

**Do NOT create or modify** any files in `src/background/`, `src/popup/`, `src/types/`, `package.json`, or `tsconfig.json`.

---

## Read First: Shared Interface Contracts

Before writing any code, read `00-SHARED-SETUP.md` for the full type definitions. Your key contracts:

- **You produce:** `PageSkeleton` (containing `SkeletonNode[]`)
- **You send:** `SkeletonMessage` via `chrome.runtime.sendMessage`
- **You receive:** `TransformMessage` or `ErrorMessage` back
- **You call:** the transformer (Session 3's code) with `TransformResponse`

---

## Task 1: manifest.json

Create a Manifest V3 Chrome extension config:

```json
{
  "manifest_version": 3,
  "name": "Predictive Browser",
  "version": "0.1.0",
  "description": "AI-powered web lens that reshapes any page based on your intent",
  "permissions": [
    "activeTab",
    "storage",
    "history"
  ],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background/service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content/index.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": "assets/icon.png"
  },
  "icons": {
    "128": "assets/icon.png"
  }
}
```

---

## Task 2: src/content/extractor.ts — The Core Logic

### What It Does
Walks the live DOM and produces a compressed semantic skeleton (`PageSkeleton`). The goal is to capture the **meaningful structure** of any arbitrary page in under 4,000 tokens so it fits efficiently in an LLM context window.

### Extraction Algorithm

```
1. Start at document.body
2. Walk the DOM tree recursively
3. For each element, decide: is this semantically meaningful?
4. If yes → create a SkeletonNode with a unique CSS selector
5. If no → skip it but continue into children
6. Enforce depth limit (max 6 levels) and node limit (max 150 nodes)
7. Return the skeleton
```

### Detailed Requirements

#### Element Classification
Map DOM elements to semantic types:

| DOM Element(s) | SkeletonNode.type |
|---|---|
| `h1`-`h6` | `"heading"` (set `headingLevel`) |
| `nav`, `[role="navigation"]` | `"nav"` |
| `section`, `article`, `main`, `aside`, `[role="main"]`, `[role="region"]` | `"section"` |
| `a[href]` | `"link"` (set `href`) |
| `img`, `picture`, `svg`, `[role="img"]` | `"image"` (set `alt`) |
| `ul`, `ol`, `[role="list"]` | `"list"` |
| `form`, `[role="form"]` | `"form"` |
| `p`, `span`, `div` (with significant text) | `"text"` |
| Everything else with visible content | `"unknown"` |

#### Skip Rules — Do NOT create nodes for:
- Elements with `display: none` or `visibility: hidden` (check `getComputedStyle`)
- Elements with zero `offsetWidth` AND zero `offsetHeight`
- Script, style, noscript, template, svg (inline decorative), iframe elements
- Elements whose `textPreview` would be empty AND have no meaningful children
- Cookie banners, ad containers (heuristic: elements with common ad-related class names like `ad-`, `adsbygoogle`, `cookie-banner`, `consent`)

#### CSS Selector Generation
For each kept node, generate a **stable, unique CSS selector**. Priority order:
1. `#id` if the element has a unique ID
2. `[data-testid="value"]` or `[aria-label="value"]` if available
3. Positional: `body > div:nth-child(2) > section:nth-child(1) > h2:nth-child(3)`

The selector MUST work with `document.querySelector()` to return exactly that element. Test this during extraction — if `querySelector(selector)` doesn't return the original element, fall back to a more specific path.

#### Text Preview Extraction
- Get `element.textContent`, trim whitespace, collapse multiple spaces
- Truncate to 80 characters, add "..." if truncated
- For links: use `element.textContent` (the link text), not the href
- For images: use `alt` attribute, fallback to `""` if no alt

#### Token Budget Control
The skeleton must stay compact. Enforce these limits:
- **Max 150 nodes** total — stop adding nodes after this
- **Max depth 6** — don't recurse deeper than 6 levels
- **Max 30 children per node** — if a parent has 50 list items, keep the first 20 and last 10, add a synthetic node `{ type: "text", textPreview: "... (20 more items)" }`
- **Deduplication** — if multiple sibling nodes have the same type and very similar `textPreview` (e.g., repeated card components), collapse them into one with `textPreview: "× repeated 12x: [first preview]"`

#### The `extractSkeleton()` Function

```typescript
// src/content/extractor.ts

export function extractSkeleton(): PageSkeleton {
  // Implementation here
  // Returns a PageSkeleton conforming to the interface in interfaces.ts
}
```

Export this as a named export. It takes no arguments (reads from the live DOM). Returns a `PageSkeleton`.

### Edge Cases to Handle
- **SPAs with lazy loading**: The page might not be fully rendered at `document_idle`. In `index.ts`, add a 500ms delay before extraction, or use a MutationObserver for 2 seconds to wait for dynamic content to settle.
- **Iframes**: Skip them. Don't try to reach into iframe DOMs (cross-origin will block you anyway).
- **Shadow DOM**: If `element.shadowRoot` exists and is open, recurse into it. If closed, skip.
- **Empty pages**: If the skeleton has 0 nodes, don't send a message. Just return early.

### Self-Test Function

```typescript
export function testExtractor(): void {
  const skeleton = extractSkeleton();
  console.log("[Predictive Browser] Skeleton extracted:", {
    url: skeleton.url,
    title: skeleton.title,
    nodeCount: countNodes(skeleton.nodes),
    topLevelNodes: skeleton.nodes.length,
    estimatedTokens: JSON.stringify(skeleton).length / 4 // rough estimate
  });
  console.log("[Predictive Browser] Full skeleton:", JSON.stringify(skeleton, null, 2));
  
  // Validate all selectors resolve
  let brokenSelectors = 0;
  walkNodes(skeleton.nodes, (node) => {
    if (!document.querySelector(node.selector)) {
      console.warn(`[Predictive Browser] Broken selector: ${node.selector}`);
      brokenSelectors++;
    }
  });
  console.log(`[Predictive Browser] Selector validation: ${brokenSelectors} broken`);
}
```

---

## Task 3: src/content/index.ts — The Orchestrator

This is the entry point that the content script loads. It wires everything together.

### Flow

```typescript
// src/content/index.ts

import { extractSkeleton } from './extractor.js';
// Transformer will be imported from Session 3's file:
// import { applyTransforms } from './transformer.js';

async function main() {
  // 1. Wait for page to settle (handle SPAs)
  await waitForDomStable();

  // 2. Extract skeleton
  const skeleton = extractSkeleton();
  
  // 3. Validate skeleton has content
  if (skeleton.nodes.length === 0) {
    console.log("[Predictive Browser] Empty page, skipping.");
    return;
  }

  // 4. Send skeleton to background service worker
  const response = await chrome.runtime.sendMessage({
    type: "SKELETON_READY",
    payload: skeleton
  } as SkeletonMessage);

  // 5. Handle response
  if (response?.type === "TRANSFORMS_READY") {
    // 6. Hand transforms to the transformer (Session 3)
    // applyTransforms(response.payload);
    console.log("[Predictive Browser] Transforms received:", response.payload);
    // TODO: Uncomment applyTransforms when Session 3's code is merged
  } else if (response?.type === "TRANSFORM_ERROR") {
    console.error("[Predictive Browser] Transform error:", response.payload.message);
  }
}

function waitForDomStable(): Promise<void> {
  return new Promise((resolve) => {
    let timeout: number;
    const observer = new MutationObserver(() => {
      clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 500); // 500ms of no mutations = stable
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    // Fallback: resolve after 3 seconds no matter what
    setTimeout(() => {
      observer.disconnect();
      resolve();
    }, 3000);

    // Also trigger the initial timeout in case DOM is already stable
    timeout = window.setTimeout(() => {
      observer.disconnect();
      resolve();
    }, 500);
  });
}

// Run
main().catch(console.error);
```

### Important Notes for index.ts
- The import of `applyTransforms` from `transformer.js` should be **commented out** with a TODO. Session 3 will uncomment it during merge.
- Use `chrome.runtime.sendMessage` with `await` — the background service worker will use `sendResponse` to reply.
- The types (`SkeletonMessage`, etc.) will be defined in `src/types/interfaces.ts` by Session 2. For now, use inline type assertions or `as any` with a comment referencing the interface name.

---

## Task 4: assets/icon.png

Create a simple 128x128 placeholder icon. Can be generated programmatically — a colored square with "PB" text, or download a generic icon. This is just for the extension to load without errors.

---

## Definition of Done

- [ ] `manifest.json` is valid Manifest V3
- [ ] `extractSkeleton()` runs on any page and returns a valid `PageSkeleton`
- [ ] All CSS selectors in the skeleton resolve via `querySelector`
- [ ] Skeleton is under 4,000 tokens (rough check: `JSON.stringify(skeleton).length < 16000`)
- [ ] `index.ts` orchestrates the full flow with proper error handling
- [ ] `waitForDomStable()` handles SPAs gracefully
- [ ] Self-test function works when called from the browser console
- [ ] No files outside your ownership were created or modified

## Estimated Time: 2-3 hours
