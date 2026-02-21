import { ProfileManager } from './profile-manager.js';
import { generateTransforms } from './llm-engine.js';
import { initializeAggregator, processPageSignal, processEngagementEvent, buildEnhancedProfile, } from './signal-aggregator.js';
// ---------------------------------------------------------------------------
// Module-level singletons — service workers are event-driven, not persistent,
// so we re-initialize lazily on each activation.
// ---------------------------------------------------------------------------
const profileManager = new ProfileManager();
let initialized = false;
async function ensureInitialized() {
    if (!initialized) {
        await profileManager.initialize();
        await initializeAggregator();
        initialized = true;
    }
}
// ---------------------------------------------------------------------------
// Tab Title Collection
// ---------------------------------------------------------------------------
async function getOpenTabTitles() {
    try {
        const tabs = await chrome.tabs.query({});
        return tabs
            .map(t => t.title ?? '')
            .filter(t => t.length > 0)
            .slice(0, 5);
    }
    catch {
        return [];
    }
}
// ---------------------------------------------------------------------------
// Message Router
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "SKELETON_READY") {
        handleSkeleton(message, sendResponse);
        return true; // Required to keep the message channel open for async response
    }
    if (message.type === "PAGE_SIGNALS") {
        handlePageSignals(message);
        return false;
    }
    if (message.type === "ENGAGEMENT_EVENT") {
        handleEngagementEvent(message);
        return false;
    }
    if (message.type === "UPDATE_FOCUS") {
        const focus = message.payload?.focus ?? "";
        profileManager.updateFocus(focus).then(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sendResponse({ type: "FOCUS_UPDATED" });
        }).catch(err => {
            console.error("[Predictive Browser] Failed to update focus:", err);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sendResponse({ type: "FOCUS_UPDATED", error: String(err) });
        });
        return true;
    }
    return false;
});
// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
async function handleSkeleton(message, sendResponse) {
    try {
        await ensureInitialized();
        const baseProfile = profileManager.getProfile();
        // Collect open tab titles for context
        const openTabTitles = await getOpenTabTitles();
        // Extract inbound search query from the page URL
        const searchQuery = extractSearchQueryFromUrl(message.payload.url);
        // Build enhanced profile with all signals
        const enhancedProfile = buildEnhancedProfile(baseProfile, openTabTitles, searchQuery);
        console.log("[Predictive Browser] Processing skeleton for:", message.payload.url);
        console.log("[Predictive Browser] Enhanced profile — topics:", enhancedProfile.topicModel.length, "session URLs:", enhancedProfile.currentSession?.urls.length ?? 0);
        const transforms = await generateTransforms(message.payload, enhancedProfile);
        console.log("[Predictive Browser] Generated", transforms.transforms.length, "transforms");
        sendResponse({
            type: "TRANSFORMS_READY",
            payload: transforms
        });
    }
    catch (error) {
        console.error("[Predictive Browser] Error:", error);
        sendResponse({
            type: "TRANSFORM_ERROR",
            payload: { message: error instanceof Error ? error.message : "Unknown error" }
        });
    }
}
function handlePageSignals(message) {
    ensureInitialized().then(() => {
        processPageSignal(message.payload);
        console.log("[Predictive Browser] Processed page signals for:", message.payload.url);
    }).catch(err => {
        console.error("[Predictive Browser] Failed to process page signals:", err);
    });
}
function handleEngagementEvent(message) {
    ensureInitialized().then(() => {
        processEngagementEvent(message.payload);
        console.log("[Predictive Browser] Engagement:", message.payload.engagementType, "on", message.payload.selector);
    }).catch(err => {
        console.error("[Predictive Browser] Failed to process engagement:", err);
    });
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const SEARCH_PARAMS = ['q', 'query', 'search_query', 'p'];
function extractSearchQueryFromUrl(url) {
    try {
        const parsed = new URL(url);
        for (const param of SEARCH_PARAMS) {
            const value = parsed.searchParams.get(param);
            if (value)
                return value;
        }
    }
    catch { /* malformed URL */ }
    return '';
}
