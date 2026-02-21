// ---------------------------------------------------------------------------
// Layer 1: Synthetic Seed — makes the demo work cold, before any onboarding
// ---------------------------------------------------------------------------
const DEFAULT_SEED = `
The user is a software engineer interested in AI/ML, startups, and technology.
They are actively exploring career opportunities at early-stage companies.
They are interested in developer tools, programming languages, and building products.
`;
// Common stop-words to skip when extracting interest keywords from page titles
const STOP_WORDS = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "are", "was", "be", "been", "has",
    "have", "had", "it", "its", "this", "that", "what", "how", "why",
    "your", "you", "we", "our", "my", "me", "i", "new", "get", "more",
    "can", "will", "do", "not", "no", "all", "–", "-", "|", ":", "&"
]);
export class ProfileManager {
    async initialize() {
        // Layer 2: Load onboarding data from storage
        const stored = await chrome.storage.local.get("userProfile");
        // Layer 3: Pull browsing history (last 7 days, up to 50 items)
        let history = [];
        try {
            history = await chrome.history.search({
                text: "",
                maxResults: 50,
                startTime: Date.now() - (7 * 24 * 60 * 60 * 1000)
            });
        }
        catch (e) {
            // history permission may not be granted yet — degrade gracefully
            console.warn("[Predictive Browser] Could not read history:", e);
        }
        // Merge all three layers
        this.profile = {
            currentFocus: stored["userProfile"]?.currentFocus || "",
            interests: this.extractInterests(history),
            recentUrls: history.map(h => h.url).filter(Boolean),
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
        const seen = new Set();
        const interests = [];
        for (const item of history) {
            // --- Domain extraction ---
            if (item.url) {
                try {
                    const domain = new URL(item.url).hostname.replace(/^www\./, "");
                    if (domain && !seen.has(domain)) {
                        seen.add(domain);
                        interests.push(domain);
                    }
                }
                catch {
                    // Malformed URL — skip
                }
            }
            // --- Title keyword extraction ---
            if (item.title) {
                const words = item.title
                    .toLowerCase()
                    // Split on whitespace and common separators
                    .split(/[\s\-–|:&/]+/)
                    .map(w => w.replace(/[^a-z0-9.]/g, "").trim())
                    .filter(w => w.length >= 4 && !STOP_WORDS.has(w));
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
}
