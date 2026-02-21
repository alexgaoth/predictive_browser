"use strict";
(() => {
  // src/popup/popup.ts
  var focusInput = document.getElementById("focus");
  var saveButton = document.getElementById("save");
  var statusDiv = document.getElementById("status");
  document.addEventListener("DOMContentLoaded", async () => {
    try {
      const stored = await chrome.storage.local.get("userProfile");
      const savedFocus = stored["userProfile"]?.currentFocus ?? "";
      if (savedFocus) {
        focusInput.value = savedFocus;
      }
    } catch (e) {
      console.error("[Predictive Browser Popup] Could not load profile:", e);
    }
  });
  saveButton.addEventListener("click", async () => {
    const focus = focusInput.value.trim();
    saveButton.disabled = true;
    saveButton.textContent = "Saving\u2026";
    hideStatus();
    try {
      await chrome.runtime.sendMessage({
        type: "UPDATE_FOCUS",
        payload: { focus }
      });
      showStatus("\u2713 Saved! The extension will use this on your next page load.", "success");
    } catch (e) {
      console.error("[Predictive Browser Popup] Failed to save:", e);
      showStatus("Error saving. Make sure the extension is active.", "error");
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = "Save";
    }
  });
  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
  }
  function hideStatus() {
    statusDiv.className = "status hidden";
    statusDiv.textContent = "";
  }
})();
