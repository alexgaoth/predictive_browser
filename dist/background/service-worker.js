import { ProfileManager } from './profile-manager.js';
import { generateTransforms } from './llm-engine.js';
// ---------------------------------------------------------------------------
// Module-level singletons — service workers are event-driven, not persistent,
// so we re-initialize lazily on each activation.
// ---------------------------------------------------------------------------
const profileManager = new ProfileManager();
let initialized = false;
async function ensureInitialized() {
    if (!initialized) {
        await profileManager.initialize();
        initialized = true;
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
    }
    catch (error) {
        console.error("[Predictive Browser] Error:", error);
        sendResponse({
            type: "TRANSFORM_ERROR",
            payload: { message: error instanceof Error ? error.message : "Unknown error" }
        });
    }
}
