"use strict";
// Popup script — runs in the extension popup context.
// No imports needed: Chrome APIs are available globally in the popup.
const focusInput = document.getElementById("focus");
const saveButton = document.getElementById("save");
const statusDiv = document.getElementById("status");
// ---------------------------------------------------------------------------
// On load: restore the saved focus from storage
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
    try {
        const stored = await chrome.storage.local.get("userProfile");
        const savedFocus = stored["userProfile"]?.currentFocus ?? "";
        if (savedFocus) {
            focusInput.value = savedFocus;
        }
    }
    catch (e) {
        console.error("[Predictive Browser Popup] Could not load profile:", e);
    }
});
// ---------------------------------------------------------------------------
// Save: send UPDATE_FOCUS to service worker and show confirmation
// ---------------------------------------------------------------------------
saveButton.addEventListener("click", async () => {
    const focus = focusInput.value.trim();
    saveButton.disabled = true;
    saveButton.textContent = "Saving…";
    hideStatus();
    try {
        await chrome.runtime.sendMessage({
            type: "UPDATE_FOCUS",
            payload: { focus }
        });
        showStatus("✓ Saved! The extension will use this on your next page load.", "success");
    }
    catch (e) {
        console.error("[Predictive Browser Popup] Failed to save:", e);
        showStatus("Error saving. Make sure the extension is active.", "error");
    }
    finally {
        saveButton.disabled = false;
        saveButton.textContent = "Save";
    }
});
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
}
function hideStatus() {
    statusDiv.className = "status hidden";
    statusDiv.textContent = "";
}
