import type { PageSkeleton, UserProfile, TransformResponse, TransformInstruction, EnhancedUserProfile, SkeletonNode, LinkPreview, ExtensionSettings } from '../types/interfaces.js';
import { DEFAULT_SETTINGS } from '../types/interfaces.js';

// ---------------------------------------------------------------------------
// Settings — loaded from chrome.storage.local, cached in memory
// ---------------------------------------------------------------------------
let cachedSettings: ExtensionSettings | null = null;

async function getSettings(): Promise<ExtensionSettings> {
  if (cachedSettings) return cachedSettings;
  try {
    const stored = await chrome.storage.local.get("extensionSettings");
    const merged: ExtensionSettings = { ...DEFAULT_SETTINGS, ...stored["extensionSettings"] };
    if (stored["extensionSettings"]?.enabledActions) {
      merged.enabledActions = { ...DEFAULT_SETTINGS.enabledActions, ...stored["extensionSettings"].enabledActions };
    }
    cachedSettings = merged;
  } catch {
    cachedSettings = { ...DEFAULT_SETTINGS };
  }
  return cachedSettings!;
}

/** Called by service worker when settings change */
export function invalidateSettingsCache(): void {
  cachedSettings = null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateTransforms(
  skeleton: PageSkeleton,
  profile: UserProfile | EnhancedUserProfile
): Promise<TransformResponse> {
  const prompt = await buildPrompt(skeleton, profile);
  const raw = await callGemini(prompt);
  return await parseResponse(raw);
}

// ---------------------------------------------------------------------------
// Prompt Engineering
// ---------------------------------------------------------------------------

function isEnhancedProfile(p: UserProfile | EnhancedUserProfile): p is EnhancedUserProfile {
  return 'topicModel' in p;
}

async function buildPrompt(skeleton: PageSkeleton, profile: UserProfile | EnhancedUserProfile): Promise<string> {
  const sections: string[] = [];

  // 1. Current focus (always included if set)
  if (profile.currentFocus) {
    sections.push(`CURRENT FOCUS:\n${profile.currentFocus}`);
  }

  if (isEnhancedProfile(profile)) {
    // 2. Topic model — top 10 weighted topics (replaces flat interests)
    if (profile.topicModel.length > 0) {
      const topicLines = profile.topicModel
        .map(t => `- ${t.topic} (weight: ${t.score.toFixed(1)})`)
        .join('\n');
      sections.push(`INTEREST MODEL (learned from browsing behavior):\n${topicLines}`);
    }

    // 3. Session context — recent URLs + search queries
    if (profile.currentSession) {
      const recentUrls = profile.currentSession.urls.slice(-5).join(', ');
      const queries = profile.currentSession.searchQueries.join(', ');
      let sessionCtx = `CURRENT SESSION:\nRecent pages: ${recentUrls}`;
      if (queries) sessionCtx += `\nSearch queries this session: ${queries}`;
      sections.push(sessionCtx);
    }

    // 4. Inbound search query
    if (profile.inboundSearchQuery) {
      sections.push(`INBOUND SEARCH QUERY: "${profile.inboundSearchQuery}"\nPrioritize content matching this query.`);
    }

    // 5. Temporal context
    if (profile.temporalBucket) {
      const bucket = profile.temporalBucket;
      const typicalTopics = bucket.topics.slice(0, 5).join(', ');
      sections.push(`TEMPORAL CONTEXT: ${bucket.key.replace('_', ' ')} (${bucket.visitCount} past visits)\nTypical topics at this time: ${typicalTopics || 'not enough data yet'}`);
    }

    // 6. Open tab titles
    if (profile.openTabTitles.length > 0) {
      sections.push(`OTHER OPEN TABS:\n${profile.openTabTitles.map(t => `- ${t}`).join('\n')}`);
    }

    // 7. Transform feedback — engagement rates
    if (profile.transformFeedback.length > 0) {
      const feedbackLines = profile.transformFeedback
        .filter(f => f.appliedCount > 0)
        .map(f => {
          const rate = f.appliedCount > 0
            ? ((f.engagedCount / f.appliedCount) * 100).toFixed(0)
            : '0';
          return `- ${f.action}: ${rate}% engagement (${f.engagedCount}/${f.appliedCount})`;
        })
        .join('\n');
      if (feedbackLines) {
        sections.push(`TRANSFORM EFFECTIVENESS:\n${feedbackLines}\nFavor actions with higher engagement rates.`);
      }
    }

    // 8. Seed context — only for cold start
    if (profile.topicModel.length < 5 && profile.seedContext) {
      sections.push(`SEED CONTEXT (cold start):\n${profile.seedContext}`);
    }
  } else {
    // Fallback for base UserProfile
    if (profile.interests.length > 0) {
      sections.push(`Interests: ${profile.interests.join(", ")}`);
    }
    if (profile.seedContext) {
      sections.push(profile.seedContext);
    }
  }

  const profileContext = sections.join('\n\n');

  // Build intensity and enabled actions guidance from settings
  const settings = await getSettings();
  const allActions = ["highlight", "collapse", "reorder", "annotate", "dim"] as const;
  const enabledActions = allActions.filter(a => settings.enabledActions[a]);
  const actionsStr = enabledActions.map(a => `"${a}"`).join(", ");

  let intensityRule: string;
  switch (settings.intensity) {
    case "conservative":
      intensityRule = "Be very selective. Only transform elements you're highly confident about. Prefer fewer, higher-quality transforms (3-5 max).";
      break;
    case "aggressive":
      intensityRule = "Transform aggressively. Reshape the page significantly. Use 10-15 transforms.";
      break;
    default:
      intensityRule = "Be conservative: if unsure, don't transform. A wrong transform is worse than no transform. Return 5-15 transforms max. Quality over quantity.";
  }

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
   - "action": one of ${actionsStr}
   - "selector": the CSS selector from the skeleton (copy exactly)
   - "reason": brief explanation (5-10 words)
   - "relevance": 0-100 score
   - "position": (only for reorder) "top" or "above:{selector}"
   - "annotation": (only for annotate) short text badge
2. "summary": one sentence describing what you changed
3. "inferredIntent": one sentence describing what you think the user wants

RULES:
- ONLY use these actions: ${actionsStr}. Do NOT use any other action types.
- Use "highlight" for elements directly relevant to the user's intent
- Use "collapse" for sections that are noise (e.g., unrelated news, ads, promotional content)
- Use "reorder" sparingly — only move things to "top" if they're clearly the most important
- Use "annotate" to add helpful context (e.g., "★ Relevant to your job search")
- Use "dim" for low-relevance but not totally irrelevant content
- ${intensityRule}
- Only use selectors that exist in the skeleton. Never invent selectors.

Return ONLY valid JSON. No markdown, no backticks, no explanation outside the JSON.`;
}

// ---------------------------------------------------------------------------
// Gemini API call
// ---------------------------------------------------------------------------

async function callGemini(prompt: string): Promise<string> {
  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new Error("Please set your Gemini API key in the extension settings (click the extension icon).");
  }

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${settings.model}:generateContent`;

  const response = await fetch(`${apiUrl}?key=${settings.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,       // Low temp for reliable structured output
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

// ---------------------------------------------------------------------------
// Response Parsing — defensive, never crashes
// ---------------------------------------------------------------------------

async function parseResponse(raw: string): Promise<TransformResponse> {
  try {
    // Strip markdown code fences if present (Gemini sometimes adds them despite JSON mode)
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);

    // Validate structure
    if (!parsed.transforms || !Array.isArray(parsed.transforms)) {
      throw new Error("Missing transforms array");
    }

    // Filter by enabled actions from settings
    const settings = await getSettings();
    const enabledActions = (["highlight", "collapse", "reorder", "annotate", "dim"] as const)
      .filter(a => settings.enabledActions[a]);

    // Validate each transform — drop malformed entries rather than crashing
    const validTransforms: TransformInstruction[] = parsed.transforms.filter((t: unknown) => {
      if (typeof t !== "object" || t === null) return false;
      const transform = t as Record<string, unknown>;
      return (
        enabledActions.includes(transform["action"] as typeof enabledActions[number]) &&
        typeof transform["selector"] === "string" &&
        (transform["selector"] as string).length > 0 &&
        typeof transform["relevance"] === "number"
      );
    });

    return {
      transforms: validTransforms.slice(0, 25), // Cap at 25
      summary: typeof parsed.summary === "string" && parsed.summary.length > 0
        ? parsed.summary
        : "Page reshaped based on your interests.",
      inferredIntent: typeof parsed.inferredIntent === "string" && parsed.inferredIntent.length > 0
        ? parsed.inferredIntent
        : "General browsing",
      digest: typeof parsed.digest === "string" && parsed.digest.length > 0
        ? parsed.digest
        : undefined
    };
  } catch (e) {
    console.error("[Predictive Browser] Failed to parse LLM response:", e, raw);
    // Graceful degradation — page stays unmodified
    return {
      transforms: [],
      summary: "Could not optimize this page.",
      inferredIntent: "Unknown"
    };
  }
}

// ---------------------------------------------------------------------------
// Link Preview — Second Pass Pipeline
// ---------------------------------------------------------------------------

/**
 * Collect all link nodes from the skeleton, filter invalid ones, dedupe, cap at 20.
 * Ask Gemini to pick the top 5 most relevant for this user.
 */
async function evaluateLinks(
  skeleton: PageSkeleton,
  profile: UserProfile | EnhancedUserProfile
): Promise<{ href: string; selector: string }[]> {
  const links: { href: string; selector: string }[] = [];
  const seen = new Set<string>();

  function walk(nodes: SkeletonNode[]): void {
    for (const node of nodes) {
      if (
        node.type === "link" &&
        node.href &&
        !node.href.startsWith("#") &&
        !node.href.startsWith("javascript:") &&
        !seen.has(node.href)
      ) {
        seen.add(node.href);
        links.push({ href: node.href, selector: node.selector });
      }
      if (node.children.length > 0) walk(node.children);
    }
  }
  walk(skeleton.nodes);

  if (links.length === 0) return [];

  const capped = links.slice(0, 20);

  const profileContext = [
    profile.currentFocus && `Current focus: ${profile.currentFocus}`,
    profile.interests.length > 0 && `Interests: ${profile.interests.join(", ")}`,
    profile.seedContext
  ].filter(Boolean).join("\n");

  const prompt = `You are a link relevance evaluator. Given a user profile and a list of links from a web page, pick up to 5 links that are MOST relevant and interesting for this user.

USER PROFILE:
${profileContext}

PAGE: ${skeleton.title} (${skeleton.url})

LINKS:
${JSON.stringify(capped.map(l => ({ href: l.href, selector: l.selector })), null, 0)}

Return a JSON object with:
- "selected": array of objects with "href" and "selector" fields (up to 5, copied exactly from the input)

Only pick links that would genuinely help or interest this user. If none are relevant, return an empty array.
Return ONLY valid JSON. No markdown, no backticks.`;

  const raw = await callGemini(prompt);
  try {
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed.selected)) return [];
    return parsed.selected
      .filter((s: unknown) => {
        if (typeof s !== "object" || s === null) return false;
        const item = s as Record<string, unknown>;
        return typeof item.href === "string" && typeof item.selector === "string";
      })
      .slice(0, 5) as { href: string; selector: string }[];
  } catch {
    console.error("[Predictive Browser] Failed to parse link evaluation response");
    return [];
  }
}

/**
 * Fetch up to 5 URLs in parallel (5s timeout each), extract title + first ~2000 chars,
 * then send ALL to Gemini in a single batched call for summaries.
 */
async function fetchAndSummarize(
  urls: string[]
): Promise<{ href: string; title: string; summary: string }[]> {
  const fetched = await Promise.all(
    urls.map(async (url) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        const html = await resp.text();

        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim().slice(0, 200) : url;

        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 2000);

        return { href: url, title, text };
      } catch {
        console.warn("[Predictive Browser] Failed to fetch:", url);
        return null;
      }
    })
  );

  const successful = fetched.filter((f): f is NonNullable<typeof f> => f !== null);
  if (successful.length === 0) return [];

  const prompt = `Summarize each of the following web pages in 1-2 sentences. Focus on what the page is about and why someone might find it useful.

PAGES:
${successful.map((p, i) => `[${i + 1}] URL: ${p.href}\nTitle: ${p.title}\nContent: ${p.text}`).join("\n\n")}

Return a JSON object with:
- "summaries": array of objects with "href" and "summary" fields, in the same order as the input

Return ONLY valid JSON. No markdown, no backticks.`;

  const raw = await callGemini(prompt);
  try {
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed.summaries)) return [];
    return parsed.summaries
      .filter((s: unknown) => {
        if (typeof s !== "object" || s === null) return false;
        const item = s as Record<string, unknown>;
        return typeof item.href === "string" && typeof item.summary === "string";
      })
      .map((s: { href: string; summary: string }) => ({
        href: s.href,
        title: successful.find(p => p.href === s.href)?.title || s.href,
        summary: s.summary
      }));
  } catch {
    console.error("[Predictive Browser] Failed to parse summary response");
    return [];
  }
}

/**
 * Orchestrator: evaluateLinks -> fetchAndSummarize -> build LinkPreview[] + TransformInstruction[].
 */
export async function generateLinkPreviews(
  skeleton: PageSkeleton,
  profile: UserProfile | EnhancedUserProfile
): Promise<{ previews: LinkPreview[]; transforms: TransformInstruction[] }> {
  console.log("[Predictive Browser] Starting link preview second pass...");

  const topLinks = await evaluateLinks(skeleton, profile);
  if (topLinks.length === 0) {
    console.log("[Predictive Browser] No relevant links found for preview.");
    return { previews: [], transforms: [] };
  }
  console.log("[Predictive Browser] Gemini selected", topLinks.length, "links for preview");

  // Resolve relative URLs against the page URL
  const resolvedLinks = topLinks.map(l => ({
    ...l,
    href: new URL(l.href, skeleton.url).href
  }));

  const summaries = await fetchAndSummarize(resolvedLinks.map(l => l.href));
  console.log("[Predictive Browser] Fetched and summarized", summaries.length, "pages");

  const previews: LinkPreview[] = [];
  const transforms: TransformInstruction[] = [];

  for (const link of resolvedLinks) {
    const summary = summaries.find(s => s.href === link.href);
    if (!summary) continue;

    const relevance = 80 - previews.length * 5;

    previews.push({
      href: link.href,
      selector: link.selector,
      title: summary.title,
      summary: summary.summary,
      relevance
    });

    transforms.push({
      action: "annotate",
      selector: link.selector,
      reason: "Link preview from second pass",
      annotation: `${summary.title}: ${summary.summary}`,
      relevance,
      badgeClass: "pb-link-preview-badge"
    } as TransformInstruction & { badgeClass: string });
  }

  console.log("[Predictive Browser] Link preview second pass complete:", previews.length, "previews");
  return { previews, transforms };
}

// ---------------------------------------------------------------------------
// Self-Test — validates the full LLM pipeline with mock data
// ---------------------------------------------------------------------------

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
    console.assert(
      ["highlight", "collapse", "reorder", "annotate", "dim"].includes(t.action),
      `Transform ${i}: invalid action ${t.action}`
    );
    console.assert(
      typeof t.selector === "string" && t.selector.length > 0,
      `Transform ${i}: missing selector`
    );
  });

  console.log("[Predictive Browser] LLM engine test passed!");
}
