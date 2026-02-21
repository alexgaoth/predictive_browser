# Session 2: LLM Engine + User Profile + Background Service Worker

## Your Role
You are building the **brain** of the extension — the background service worker that receives page skeletons from the content script, combines them with the user's intent profile, sends everything to Gemini Flash, and returns surgical transform instructions. You also manage the user profile system (onboarding + browsing history + synthetic seed) and the popup UI.

## Files You Own
```
package.json
tsconfig.json
src/types/interfaces.ts          (shared types — YOU define these for all sessions)
src/background/service-worker.ts (message router)
src/background/llm-engine.ts     (Gemini API calls + prompt engineering)
src/background/profile-manager.ts(user profile CRUD)
src/popup/popup.html             (onboarding UI)
src/popup/popup.ts               (onboarding logic)
src/popup/popup.css              (onboarding styles)
```

**Do NOT create or modify** any files in `src/content/` or `assets/`.

---

## Read First: Shared Interface Contracts

Read `00-SHARED-SETUP.md` for the full architecture. Your key contracts:

- **You define:** ALL shared types in `src/types/interfaces.ts`
- **You receive:** `SkeletonMessage` (containing `PageSkeleton`) from content script
- **You produce:** `TransformMessage` (containing `TransformResponse`) back to content script
- **You manage:** `UserProfile` internally

---

## Task 1: src/types/interfaces.ts — Shared Types

Create the canonical type definitions. Copy **exactly** from the schemas in `00-SHARED-SETUP.md`. All four interface contracts must be defined here:

1. `SkeletonNode` + `PageSkeleton`
2. `TransformInstruction` + `TransformResponse`
3. `UserProfile`
4. `SkeletonMessage` + `TransformMessage` + `ErrorMessage` + `ExtensionMessage`

Export all types. This file is the **single source of truth** for all sessions.

---

## Task 2: src/background/profile-manager.ts — User Profile System

### Three Profile Layers

#### Layer 1: Synthetic Seed (Always Available)
Hardcode a default seed profile that makes the demo work cold:

```typescript
const DEFAULT_SEED = `
The user is a software engineer interested in AI/ML, startups, and technology.
They are actively exploring career opportunities at early-stage companies.
They are interested in developer tools, programming languages, and building products.
`;
```

This gets overridden/augmented once the user completes onboarding or browses enough.

#### Layer 2: Onboarding (Quick Capture)
The popup asks a single question: **"What are you focused on right now?"** — free text input.
Store the response in `chrome.storage.local` under key `"userProfile"`.

#### Layer 3: Browsing History Enrichment
Use `chrome.history.search()` to pull the last 50 URLs visited. Extract domain names and page titles as lightweight interest signals.

```typescript
// profile-manager.ts

export class ProfileManager {
  private profile: UserProfile;

  async initialize(): Promise<void> {
    // 1. Load from storage (onboarding data)
    const stored = await chrome.storage.local.get("userProfile");
    
    // 2. Pull browsing history
    const history = await chrome.history.search({
      text: "",
      maxResults: 50,
      startTime: Date.now() - (7 * 24 * 60 * 60 * 1000) // Last 7 days
    });

    // 3. Merge all layers
    this.profile = {
      currentFocus: stored.userProfile?.currentFocus || "",
      interests: this.extractInterests(history),
      recentUrls: history.map(h => h.url).filter(Boolean) as string[],
      seedContext: DEFAULT_SEED,
      updatedAt: Date.now()
    };
  }

  getProfile(): UserProfile {
    return this.profile;
  }

  async updateFocus(focus: string): Promise<void> {
    this.profile.currentFocus = focus;
    this.profile.updatedAt = Date.now();
    await chrome.storage.local.set({
      userProfile: { currentFocus: focus }
    });
  }

  private extractInterests(history: chrome.history.HistoryItem[]): string[] {
    // Extract unique domains and meaningful title keywords
    // Deduplicate, return top 20 interests
    // Example: ["github.com", "machine learning", "ycombinator.com", "typescript"]
  }
}
```

### Storage Schema
```
chrome.storage.local:
  "userProfile" → { currentFocus: string }
```

Keep it minimal. Don't over-engineer storage.

---

## Task 3: src/background/llm-engine.ts — Gemini Flash Integration

### API Setup

Use Gemini 2.0 Flash via the Google AI Studio REST API (no SDK needed — just fetch).

```typescript
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
```

**API Key handling:** For the hackathon, hardcode the key or store it in `chrome.storage.local`. The popup can have a small "API Key" field, or just hardcode it during development. The key is set via an environment-like constant at the top of the file:

```typescript
const GEMINI_API_KEY = "YOUR_KEY_HERE"; // Replace before demo
```

### The Core Function

```typescript
export async function generateTransforms(
  skeleton: PageSkeleton,
  profile: UserProfile
): Promise<TransformResponse> {
  const prompt = buildPrompt(skeleton, profile);
  const response = await callGemini(prompt);
  return parseResponse(response);
}
```

### Prompt Engineering (This Is Critical)

The prompt has three parts: system context, user profile, and the page skeleton.

```typescript
function buildPrompt(skeleton: PageSkeleton, profile: UserProfile): string {
  const profileContext = [
    profile.currentFocus && `Current focus: ${profile.currentFocus}`,
    profile.interests.length > 0 && `Interests: ${profile.interests.join(", ")}`,
    profile.seedContext
  ].filter(Boolean).join("\n");

  return `You are an intelligent web page optimizer. Given a user's intent profile and a semantic skeleton of a web page, your job is to return surgical DOM transform instructions that reshape the page to surface what's most relevant to the user.

USER PROFILE:
${profileContext}

PAGE: ${skeleton.title} (${skeleton.url})
${skeleton.metaDescription ? `Description: ${skeleton.metaDescription}` : ""}

PAGE SKELETON:
${JSON.stringify(skeleton.nodes, null, 0)}

INSTRUCTIONS:
Analyze the page structure and the user's intent. Return a JSON object with:
1. "transforms": an array of transform instructions. Each has:
   - "action": one of "highlight", "collapse", "reorder", "annotate", "dim"
   - "selector": the CSS selector from the skeleton (copy exactly)
   - "reason": brief explanation (5-10 words)
   - "relevance": 0-100 score
   - "position": (only for reorder) "top" or "above:{selector}"
   - "annotation": (only for annotate) short text badge
2. "summary": one sentence describing what you changed
3. "inferredIntent": one sentence describing what you think the user wants

RULES:
- Use "highlight" for elements directly relevant to the user's intent
- Use "collapse" for sections that are noise (e.g., unrelated news, ads, promotional content)
- Use "reorder" sparingly — only move things to "top" if they're clearly the most important
- Use "annotate" to add helpful context (e.g., "★ Relevant to your job search")
- Use "dim" for low-relevance but not totally irrelevant content
- Be conservative: if unsure, don't transform. A wrong transform is worse than no transform.
- Return 5-15 transforms max. Quality over quantity.
- Only use selectors that exist in the skeleton. Never invent selectors.

Return ONLY valid JSON. No markdown, no backticks, no explanation outside the JSON.`;
}
```

### Calling Gemini

```typescript
async function callGemini(prompt: string): Promise<string> {
  const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,      // Low temp for reliable structured output
        maxOutputTokens: 2048,
        responseMimeType: "application/json"  // Gemini's JSON mode
      }
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${error}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}
```

### Response Parsing (Defensive)

```typescript
function parseResponse(raw: string): TransformResponse {
  try {
    // Strip markdown code fences if present (Gemini sometimes adds them despite JSON mode)
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);

    // Validate structure
    if (!parsed.transforms || !Array.isArray(parsed.transforms)) {
      throw new Error("Missing transforms array");
    }

    // Validate each transform
    const validActions = ["highlight", "collapse", "reorder", "annotate", "dim"];
    const validTransforms = parsed.transforms.filter((t: any) => {
      return (
        validActions.includes(t.action) &&
        typeof t.selector === "string" &&
        typeof t.relevance === "number"
      );
    });

    return {
      transforms: validTransforms.slice(0, 15), // Cap at 15
      summary: parsed.summary || "Page optimized based on your interests.",
      inferredIntent: parsed.inferredIntent || "General browsing"
    };
  } catch (e) {
    console.error("[Predictive Browser] Failed to parse LLM response:", e, raw);
    return {
      transforms: [],
      summary: "Could not optimize this page.",
      inferredIntent: "Unknown"
    };
  }
}
```

### Important: Never Crash
If Gemini returns garbage, `parseResponse` returns an empty transforms array. The page stays normal. **This is by design** — a graceful degradation.

---

## Task 4: src/background/service-worker.ts — Message Router

```typescript
import { ProfileManager } from './profile-manager.js';
import { generateTransforms } from './llm-engine.js';
import type { ExtensionMessage, SkeletonMessage } from '../types/interfaces.js';

const profileManager = new ProfileManager();
let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await profileManager.initialize();
    initialized = true;
  }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (message.type === "SKELETON_READY") {
    handleSkeleton(message as SkeletonMessage, sendResponse);
    return true; // Required for async sendResponse
  }
  
  if (message.type === "UPDATE_FOCUS") {
    // From popup
    const focus = (message as any).payload?.focus || "";
    profileManager.updateFocus(focus).then(() => {
      sendResponse({ type: "FOCUS_UPDATED" });
    });
    return true;
  }
});

async function handleSkeleton(
  message: SkeletonMessage,
  sendResponse: (response: ExtensionMessage) => void
) {
  try {
    await ensureInitialized();
    const profile = profileManager.getProfile();
    
    console.log("[Predictive Browser] Processing skeleton for:", message.payload.url);
    console.log("[Predictive Browser] User profile:", profile.currentFocus || "(seed only)");
    
    const transforms = await generateTransforms(message.payload, profile);
    
    console.log("[Predictive Browser] Generated", transforms.transforms.length, "transforms");
    
    sendResponse({
      type: "TRANSFORMS_READY",
      payload: transforms
    });
  } catch (error) {
    console.error("[Predictive Browser] Error:", error);
    sendResponse({
      type: "TRANSFORM_ERROR",
      payload: { message: error instanceof Error ? error.message : "Unknown error" }
    });
  }
}
```

---

## Task 5: Popup UI (Onboarding)

### src/popup/popup.html
Simple, clean popup with:
1. A text input: "What are you focused on right now?"
2. A save button
3. A small status indicator showing current focus

### src/popup/popup.ts
- On load: read `chrome.storage.local` and display current focus
- On save: send `UPDATE_FOCUS` message to background worker
- Show confirmation when saved

### src/popup/popup.css
Minimal styling. Width ~320px. Clean, modern look. Dark background with light text (matches a "developer tool" aesthetic).

### Popup Design Spec

```html
<!-- popup.html -->
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="container">
    <h1>🔮 Predictive Browser</h1>
    <p class="subtitle">Tell me what you're focused on and I'll reshape the web for you.</p>
    
    <div class="input-group">
      <label for="focus">Current focus</label>
      <textarea id="focus" placeholder="e.g., Looking for ML engineering roles at early-stage startups..." rows="3"></textarea>
    </div>
    
    <button id="save">Save</button>
    
    <div id="status" class="status hidden"></div>
    
    <div class="footer">
      <p>Active on all pages • Powered by Gemini Flash</p>
    </div>
  </div>
  <script src="popup.js"></script>
</body>
</html>
```

Keep the popup fast and simple. No frameworks, vanilla JS/TS.

---

## Task 6: Self-Test Function

```typescript
// In llm-engine.ts
export async function testEngine(): Promise<void> {
  const mockSkeleton: PageSkeleton = {
    url: "https://www.ycombinator.com/",
    title: "Y Combinator",
    metaDescription: "Y Combinator: The leading startup accelerator",
    extractedAt: Date.now(),
    nodes: [
      {
        id: "node-0", selector: "nav", type: "nav", tag: "nav",
        textPreview: "About What We Do Blog People Companies...", children: []
      },
      {
        id: "node-1", selector: "#hero", type: "section", tag: "section",
        textPreview: "Y Combinator created a new model for...", children: []
      },
      {
        id: "node-2", selector: "a[href='/jobs']", type: "link", tag: "a",
        textPreview: "Work at a Startup", href: "/jobs", children: []
      },
      {
        id: "node-3", selector: "#latest-news", type: "section", tag: "section",
        textPreview: "Latest News: YC announces new batch...", children: []
      },
      {
        id: "node-4", selector: "#apply", type: "section", tag: "section",
        textPreview: "Apply to Y Combinator", children: []
      }
    ]
  };

  const mockProfile: UserProfile = {
    currentFocus: "Looking for ML engineering jobs at startups",
    interests: ["machine learning", "python", "startups"],
    recentUrls: ["https://github.com", "https://arxiv.org", "https://linkedin.com/jobs"],
    seedContext: "Software engineer interested in AI/ML and startups.",
    updatedAt: Date.now()
  };

  console.log("[Predictive Browser] Running LLM engine test...");
  const result = await generateTransforms(mockSkeleton, mockProfile);
  console.log("[Predictive Browser] Test result:", JSON.stringify(result, null, 2));
  
  // Validate
  console.assert(result.transforms.length > 0, "Should produce at least 1 transform");
  console.assert(result.summary.length > 0, "Should produce a summary");
  result.transforms.forEach((t, i) => {
    console.assert(["highlight", "collapse", "reorder", "annotate", "dim"].includes(t.action),
      `Transform ${i}: invalid action ${t.action}`);
    console.assert(typeof t.selector === "string" && t.selector.length > 0,
      `Transform ${i}: missing selector`);
  });
  
  console.log("[Predictive Browser] LLM engine test passed!");
}
```

---

## Definition of Done

- [ ] `interfaces.ts` contains all shared types matching `00-SHARED-SETUP.md` exactly
- [ ] `package.json` and `tsconfig.json` match the shared setup spec
- [ ] `ProfileManager` loads seed + onboarding + browsing history
- [ ] `generateTransforms()` calls Gemini Flash and returns valid `TransformResponse`
- [ ] Response parsing is defensive — never crashes, returns empty transforms on bad input
- [ ] Service worker routes messages correctly between content script and LLM engine
- [ ] Popup UI allows setting current focus and persists it to storage
- [ ] Self-test function validates the LLM pipeline with mock data
- [ ] API key is stored as a replaceable constant (easy to swap before demo)
- [ ] No files outside your ownership were created or modified

## Estimated Time: 2-3 hours

## Notes on API Key for Demo
During the hackathon demo, you'll want the API key pre-loaded. Options:
1. Hardcode it (simplest, fine for a hackathon)
2. Add a field in the popup to paste it in
3. Use `chrome.storage.local` so it persists across reloads

Option 1 is recommended for speed. Just remember to remove it before pushing to GitHub.
