// src/background/profile-manager.ts
var DEFAULT_SEED = `
The user is a software engineer interested in AI/ML, startups, and technology.
They are actively exploring career opportunities at early-stage companies.
They are interested in developer tools, programming languages, and building products.
`;
var STOP_WORDS = /* @__PURE__ */ new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "is",
  "are",
  "was",
  "be",
  "been",
  "has",
  "have",
  "had",
  "it",
  "its",
  "this",
  "that",
  "what",
  "how",
  "why",
  "your",
  "you",
  "we",
  "our",
  "my",
  "me",
  "i",
  "new",
  "get",
  "more",
  "can",
  "will",
  "do",
  "not",
  "no",
  "all",
  "\u2013",
  "-",
  "|",
  ":",
  "&"
]);
var ProfileManager = class {
  async initialize() {
    const stored = await chrome.storage.local.get("userProfile");
    let history = [];
    try {
      history = await chrome.history.search({
        text: "",
        maxResults: 50,
        startTime: Date.now() - 7 * 24 * 60 * 60 * 1e3
      });
    } catch (e) {
      console.warn("[Predictive Browser] Could not read history:", e);
    }
    this.profile = {
      currentFocus: stored["userProfile"]?.currentFocus || "",
      interests: this.extractInterests(history),
      recentUrls: history.map((h) => h.url).filter(Boolean),
      seedContext: DEFAULT_SEED,
      updatedAt: Date.now()
    };
  }
  getProfile() {
    return this.profile;
  }
  async updateFocus(focus) {
    this.profile.currentFocus = focus;
    this.profile.updatedAt = Date.now();
    await chrome.storage.local.set({
      userProfile: { currentFocus: focus }
    });
  }
  /**
   * Extract unique domains + meaningful title keywords from browsing history.
   * Returns the top 20 interest signals as a deduplicated string array.
   * Example output: ["github.com", "machine learning", "ycombinator.com", "typescript"]
   */
  extractInterests(history) {
    const seen = /* @__PURE__ */ new Set();
    const interests = [];
    for (const item of history) {
      if (item.url) {
        try {
          const domain = new URL(item.url).hostname.replace(/^www\./, "");
          if (domain && !seen.has(domain)) {
            seen.add(domain);
            interests.push(domain);
          }
        } catch {
        }
      }
      if (item.title) {
        const words = item.title.toLowerCase().split(/[\s\-–|:&/]+/).map((w) => w.replace(/[^a-z0-9.]/g, "").trim()).filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
        for (const word of words) {
          if (!seen.has(word)) {
            seen.add(word);
            interests.push(word);
          }
        }
      }
      if (interests.length >= 20)
        break;
    }
    return interests.slice(0, 20);
  }
};

// src/background/llm-engine.ts
var GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
var GEMINI_API_KEY = "AIzaSyB6FHumZ7e8TRrKDrQX5DIirvbd3cL7gVY";
async function generateTransforms(skeleton, profile) {
  const prompt = buildPrompt(skeleton, profile);
  const raw = await callGemini(prompt);
  return parseResponse(raw);
}
function buildPrompt(skeleton, profile) {
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
- Use "reorder" sparingly \u2014 only move things to "top" if they're clearly the most important
- Use "annotate" to add helpful context (e.g., "\u2605 Relevant to your job search")
- Use "dim" for low-relevance but not totally irrelevant content
- Be conservative: if unsure, don't transform. A wrong transform is worse than no transform.
- Return 5-15 transforms max. Quality over quantity.
- Only use selectors that exist in the skeleton. Never invent selectors.

Return ONLY valid JSON. No markdown, no backticks, no explanation outside the JSON.`;
}
async function callGemini(prompt) {
  const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        // Low temp for reliable structured output
        maxOutputTokens: 2048,
        responseMimeType: "application/json"
        // Gemini's JSON mode
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
function parseResponse(raw) {
  try {
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.transforms || !Array.isArray(parsed.transforms)) {
      throw new Error("Missing transforms array");
    }
    const validActions = ["highlight", "collapse", "reorder", "annotate", "dim"];
    const validTransforms = parsed.transforms.filter((t) => {
      if (typeof t !== "object" || t === null)
        return false;
      const transform = t;
      return validActions.includes(transform["action"]) && typeof transform["selector"] === "string" && transform["selector"].length > 0 && typeof transform["relevance"] === "number";
    });
    return {
      transforms: validTransforms.slice(0, 15),
      // Cap at 15
      summary: typeof parsed.summary === "string" && parsed.summary.length > 0 ? parsed.summary : "Page optimized based on your interests.",
      inferredIntent: typeof parsed.inferredIntent === "string" && parsed.inferredIntent.length > 0 ? parsed.inferredIntent : "General browsing"
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

// src/background/service-worker.ts
var profileManager = new ProfileManager();
var initialized = false;
async function ensureInitialized() {
  if (!initialized) {
    await profileManager.initialize();
    initialized = true;
  }
}
chrome.runtime.onMessage.addListener(
  (message, _sender, sendResponse) => {
    if (message.type === "SKELETON_READY") {
      handleSkeleton(message, sendResponse);
      return true;
    }
    if (message.type === "UPDATE_FOCUS") {
      const focus = message.payload?.focus ?? "";
      ensureInitialized().then(() => profileManager.updateFocus(focus)).then(() => {
        sendResponse({ type: "FOCUS_UPDATED" });
      }).catch((err) => {
        console.error("[Predictive Browser] Failed to update focus:", err);
        sendResponse({ type: "FOCUS_UPDATED", error: String(err) });
      });
      return true;
    }
    return false;
  }
);
async function handleSkeleton(message, sendResponse) {
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
