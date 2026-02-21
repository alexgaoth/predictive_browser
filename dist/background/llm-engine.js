// ---------------------------------------------------------------------------
// Gemini Flash API setup
// Replace GEMINI_API_KEY with your actual key before the demo.
// ---------------------------------------------------------------------------
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
const GEMINI_API_KEY = "AIzaSyBN1gakGsAJfmzpMRnxWJkLVOJTHXGCLbE"; // Replace before demo
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function generateTransforms(skeleton, profile) {
    const prompt = buildPrompt(skeleton, profile);
    const raw = await callGemini(prompt);
    return parseResponse(raw);
}
// ---------------------------------------------------------------------------
// Prompt Engineering
// ---------------------------------------------------------------------------
function isEnhancedProfile(p) {
    return 'topicModel' in p;
}
function buildPrompt(skeleton, profile) {
    const sections = [];
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
            if (queries)
                sessionCtx += `\nSearch queries this session: ${queries}`;
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
    }
    else {
        // Fallback for base UserProfile
        if (profile.interests.length > 0) {
            sections.push(`Interests: ${profile.interests.join(", ")}`);
        }
        if (profile.seedContext) {
            sections.push(profile.seedContext);
        }
    }
    const profileContext = sections.join('\n\n');
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
async function callGemini(prompt) {
    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.2, // Low temp for reliable structured output
                maxOutputTokens: 2048,
                responseMimeType: "application/json" // Gemini's JSON mode
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
function parseResponse(raw) {
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
        const validTransforms = parsed.transforms.filter((t) => {
            if (typeof t !== "object" || t === null)
                return false;
            const transform = t;
            return (validActions.includes(transform["action"]) &&
                typeof transform["selector"] === "string" &&
                transform["selector"].length > 0 &&
                typeof transform["relevance"] === "number");
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
    }
    catch (e) {
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
export async function testEngine() {
    const mockSkeleton = {
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
    const mockProfile = {
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
        console.assert(["highlight", "collapse", "reorder", "annotate", "dim"].includes(t.action), `Transform ${i}: invalid action ${t.action}`);
        console.assert(typeof t.selector === "string" && t.selector.length > 0, `Transform ${i}: missing selector`);
    });
    console.log("[Predictive Browser] LLM engine test passed!");
}
