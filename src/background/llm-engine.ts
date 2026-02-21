import type { PageSkeleton, UserProfile, TransformResponse, TransformInstruction, EnhancedUserProfile } from '../types/interfaces.js';

// ---------------------------------------------------------------------------
// Gemini Flash API setup
// Replace GEMINI_API_KEY with your actual key before the demo.
// ---------------------------------------------------------------------------
const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

const GEMINI_API_KEY = ""; // Replace before demo

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateTransforms(
  skeleton: PageSkeleton,
  profile: UserProfile | EnhancedUserProfile
): Promise<TransformResponse> {
  const prompt = buildPrompt(skeleton, profile);
  const raw = await callGemini(prompt);
  return parseResponse(raw);
}

// ---------------------------------------------------------------------------
// Prompt Engineering
// ---------------------------------------------------------------------------

function isEnhancedProfile(p: UserProfile | EnhancedUserProfile): p is EnhancedUserProfile {
  return 'topicModel' in p;
}

function buildPrompt(skeleton: PageSkeleton, profile: UserProfile | EnhancedUserProfile): string {
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

  return `You are an aggressive web page optimizer. Your goal is to reshape a page into a compact, focused digest that fits in a SINGLE VIEWPORT — showing only what is directly relevant to the user's intent, collapsing everything else.

USER PROFILE:
${profileContext}

PAGE: ${skeleton.title} (${skeleton.url})
${skeleton.metaDescription ? `Description: ${skeleton.metaDescription}` : ""}

PAGE SKELETON:
${JSON.stringify(skeleton.nodes, null, 0)}

INSTRUCTIONS:
Return a JSON object with these fields:
1. "transforms": array of transform instructions. Each has:
   - "action": one of "highlight", "collapse", "reorder", "annotate", "dim"
   - "selector": CSS selector from the skeleton (copy exactly, never invent)
   - "reason": 5-8 words
   - "relevance": 0-100
   - "position": (reorder only) "top" or "above:{selector}"
   - "annotation": (annotate only) max 4 words, e.g. "★ Relevant to AI"
2. "summary": one sentence — what you reshaped and why
3. "inferredIntent": one sentence — what the user is trying to accomplish
4. "digest": 2-3 sentences summarising ONLY the most relevant content on this page for this user. Write naturally, as if briefing them. Max 60 words.

TRANSFORMATION RULES — be aggressive:
- COLLAPSE: hide every section not directly serving the user's intent. Expect 60-80% of the page to be collapsed. When in doubt, collapse it. Collapsed content is still accessible by scrolling.
- REORDER: move the 2-4 most relevant sections to "top" so the user sees them immediately without scrolling.
- HIGHLIGHT: mark the 2-3 most directly relevant individual elements with a subtle accent.
- ANNOTATE: label key elements with why they're relevant (max 4 of these).
- DIM: for tangentially related content you kept but deprioritised.
- Return 10-25 transforms. A sparse set will not produce a compact view — cover the whole page.
- Only use selectors that appear in the skeleton above. Never invent selectors.

Return ONLY valid JSON. No markdown, no backticks, no explanation outside the JSON.`;
}

// ---------------------------------------------------------------------------
// Gemini API call
// ---------------------------------------------------------------------------

async function callGemini(prompt: string): Promise<string> {
  const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
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

function parseResponse(raw: string): TransformResponse {
  try {
    // Strip markdown code fences if present (Gemini sometimes adds them despite JSON mode)
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);

    // Validate structure
    if (!parsed.transforms || !Array.isArray(parsed.transforms)) {
      throw new Error("Missing transforms array");
    }

    // Validate each transform — drop malformed entries rather than crashing
    const validActions = ["highlight", "collapse", "reorder", "annotate", "dim"];
    const validTransforms: TransformInstruction[] = parsed.transforms.filter((t: unknown) => {
      if (typeof t !== "object" || t === null) return false;
      const transform = t as Record<string, unknown>;
      return (
        validActions.includes(transform["action"] as string) &&
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
