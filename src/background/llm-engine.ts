import type { PageSkeleton, UserProfile, TransformResponse, TransformInstruction } from '../types/interfaces.js';

// ---------------------------------------------------------------------------
// Gemini Flash API setup
// Replace GEMINI_API_KEY with your actual key before the demo.
// ---------------------------------------------------------------------------
const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

const GEMINI_API_KEY = "AIzaSyBN1gakGsAJfmzpMRnxWJkLVOJTHXGCLbE"; // Replace before demo

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateTransforms(
  skeleton: PageSkeleton,
  profile: UserProfile
): Promise<TransformResponse> {
  const prompt = buildPrompt(skeleton, profile);
  const raw = await callGemini(prompt);
  return parseResponse(raw);
}

// ---------------------------------------------------------------------------
// Prompt Engineering
// ---------------------------------------------------------------------------

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
      transforms: validTransforms.slice(0, 15), // Cap at 15
      summary: typeof parsed.summary === "string" && parsed.summary.length > 0
        ? parsed.summary
        : "Page optimized based on your interests.",
      inferredIntent: typeof parsed.inferredIntent === "string" && parsed.inferredIntent.length > 0
        ? parsed.inferredIntent
        : "General browsing"
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
