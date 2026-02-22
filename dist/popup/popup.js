"use strict";
(() => {
  // src/popup/popup.ts
  var DEFAULT_SETTINGS = {
    apiKey: "",
    enabled: true,
    model: "gemini-2.0-flash",
    intensity: "balanced",
    enabledActions: {
      highlight: true,
      collapse: true,
      dim: true,
      annotate: true,
      reorder: true
    },
    removeGrayedSections: true
  };
  var focusInput = document.getElementById("focus");
  var saveFocusBtn = document.getElementById("save-focus");
  var enabledToggle = document.getElementById("enabled");
  var apiKeyInput = document.getElementById("api-key");
  var toggleKeyBtn = document.getElementById("toggle-key");
  var eyeIcon = document.getElementById("eye-icon");
  var keyWarning = document.getElementById("key-warning");
  var modelSelect = document.getElementById("model");
  var saveSettingsBtn = document.getElementById("save-settings");
  var statusDiv = document.getElementById("status");
  var removeGrayedToggle = document.getElementById("remove-grayed");
  var actionCheckboxes = {
    highlight: document.getElementById("action-highlight"),
    collapse: document.getElementById("action-collapse"),
    dim: document.getElementById("action-dim"),
    annotate: document.getElementById("action-annotate"),
    reorder: document.getElementById("action-reorder")
  };
  document.addEventListener("DOMContentLoaded", async () => {
    try {
      const stored = await chrome.storage.local.get(["userProfile", "extensionSettings"]);
      const savedFocus = stored["userProfile"]?.currentFocus ?? "";
      if (savedFocus) {
        focusInput.value = savedFocus;
      }
      const settings = { ...DEFAULT_SETTINGS, ...stored["extensionSettings"] };
      if (stored["extensionSettings"]?.enabledActions) {
        settings.enabledActions = { ...DEFAULT_SETTINGS.enabledActions, ...stored["extensionSettings"].enabledActions };
      }
      enabledToggle.checked = settings.enabled;
      apiKeyInput.value = settings.apiKey;
      modelSelect.value = settings.model;
      const intensityRadio = document.querySelector(`input[name="intensity"][value="${settings.intensity}"]`);
      if (intensityRadio)
        intensityRadio.checked = true;
      for (const [action, checkbox] of Object.entries(actionCheckboxes)) {
        checkbox.checked = settings.enabledActions[action] ?? true;
      }
      removeGrayedToggle.checked = settings.removeGrayedSections ?? true;
    } catch (e) {
      console.error("[Predictive Browser Popup] Could not load settings:", e);
    }
  });
  saveFocusBtn.addEventListener("click", async () => {
    const focus = focusInput.value.trim();
    saveFocusBtn.disabled = true;
    saveFocusBtn.textContent = "Saving...";
    hideStatus();
    try {
      await chrome.runtime.sendMessage({
        type: "UPDATE_FOCUS",
        payload: { focus }
      });
      showStatus("Focus saved! Takes effect on next page load.", "success");
    } catch (e) {
      console.error("[Predictive Browser Popup] Failed to save focus:", e);
      showStatus("Error saving focus.", "error");
    } finally {
      saveFocusBtn.disabled = false;
      saveFocusBtn.textContent = "Save Focus";
    }
  });
  toggleKeyBtn.addEventListener("click", () => {
    const isPassword = apiKeyInput.type === "password";
    apiKeyInput.type = isPassword ? "text" : "password";
    eyeIcon.textContent = isPassword ? "Hide" : "Show";
  });
  saveSettingsBtn.addEventListener("click", async () => {
    saveSettingsBtn.disabled = true;
    saveSettingsBtn.textContent = "Saving...";
    hideStatus();
    const intensityRadio = document.querySelector('input[name="intensity"]:checked');
    const settings = {
      apiKey: apiKeyInput.value.trim(),
      enabled: enabledToggle.checked,
      model: modelSelect.value,
      intensity: intensityRadio?.value ?? "balanced",
      enabledActions: {
        highlight: actionCheckboxes.highlight.checked,
        collapse: actionCheckboxes.collapse.checked,
        dim: actionCheckboxes.dim.checked,
        annotate: actionCheckboxes.annotate.checked,
        reorder: actionCheckboxes.reorder.checked
      },
      removeGrayedSections: removeGrayedToggle.checked
    };
    keyWarning.classList.add("hidden");
    if (settings.apiKey && (!settings.apiKey.startsWith("AIza") || settings.apiKey.length < 30)) {
      keyWarning.textContent = "Key doesn't look like a valid Gemini API key. Saving anyway.";
      keyWarning.classList.remove("hidden");
    }
    try {
      await chrome.storage.local.set({ extensionSettings: settings });
      await chrome.runtime.sendMessage({
        type: "SETTINGS_UPDATED",
        payload: settings
      });
      showStatus("Settings saved!", "success");
    } catch (e) {
      console.error("[Predictive Browser Popup] Failed to save settings:", e);
      showStatus("Error saving settings.", "error");
    } finally {
      saveSettingsBtn.disabled = false;
      saveSettingsBtn.textContent = "Save Settings";
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
