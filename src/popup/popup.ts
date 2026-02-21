// Popup script — runs in the extension popup context.
// No imports needed: Chrome APIs are available globally in the popup.
// Types are inlined here since popup is bundled separately by esbuild.

interface ExtensionSettings {
  apiKey: string;
  enabled: boolean;
  model: string;
  intensity: string;
  enabledActions: {
    highlight: boolean;
    collapse: boolean;
    dim: boolean;
    annotate: boolean;
    reorder: boolean;
  };
}

const DEFAULT_SETTINGS: ExtensionSettings = {
  apiKey: "",
  enabled: true,
  model: "gemini-2.0-flash",
  intensity: "balanced",
  enabledActions: {
    highlight: true,
    collapse: true,
    dim: true,
    annotate: true,
    reorder: true,
  },
};

// ---------------------------------------------------------------------------
// DOM Elements
// ---------------------------------------------------------------------------
const focusInput = document.getElementById("focus") as HTMLTextAreaElement;
const saveFocusBtn = document.getElementById("save-focus") as HTMLButtonElement;
const enabledToggle = document.getElementById("enabled") as HTMLInputElement;
const apiKeyInput = document.getElementById("api-key") as HTMLInputElement;
const toggleKeyBtn = document.getElementById("toggle-key") as HTMLButtonElement;
const eyeIcon = document.getElementById("eye-icon") as HTMLSpanElement;
const keyWarning = document.getElementById("key-warning") as HTMLDivElement;
const modelSelect = document.getElementById("model") as HTMLSelectElement;
const saveSettingsBtn = document.getElementById("save-settings") as HTMLButtonElement;
const statusDiv = document.getElementById("status") as HTMLDivElement;

// Action checkboxes
const actionCheckboxes: Record<string, HTMLInputElement> = {
  highlight: document.getElementById("action-highlight") as HTMLInputElement,
  collapse: document.getElementById("action-collapse") as HTMLInputElement,
  dim: document.getElementById("action-dim") as HTMLInputElement,
  annotate: document.getElementById("action-annotate") as HTMLInputElement,
  reorder: document.getElementById("action-reorder") as HTMLInputElement,
};

// ---------------------------------------------------------------------------
// On load: restore saved state from storage
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const stored = await chrome.storage.local.get(["userProfile", "extensionSettings"]);

    // Restore focus
    const savedFocus: string = stored["userProfile"]?.currentFocus ?? "";
    if (savedFocus) {
      focusInput.value = savedFocus;
    }

    // Restore settings
    const settings: ExtensionSettings = { ...DEFAULT_SETTINGS, ...stored["extensionSettings"] };
    if (stored["extensionSettings"]?.enabledActions) {
      settings.enabledActions = { ...DEFAULT_SETTINGS.enabledActions, ...stored["extensionSettings"].enabledActions };
    }

    enabledToggle.checked = settings.enabled;
    apiKeyInput.value = settings.apiKey;
    modelSelect.value = settings.model;

    // Set intensity radio
    const intensityRadio = document.querySelector(`input[name="intensity"][value="${settings.intensity}"]`) as HTMLInputElement | null;
    if (intensityRadio) intensityRadio.checked = true;

    // Set action checkboxes
    for (const [action, checkbox] of Object.entries(actionCheckboxes)) {
      checkbox.checked = settings.enabledActions[action as keyof typeof settings.enabledActions] ?? true;
    }
  } catch (e) {
    console.error("[Predictive Browser Popup] Could not load settings:", e);
  }
});

// ---------------------------------------------------------------------------
// Save Focus
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// API Key visibility toggle
// ---------------------------------------------------------------------------
toggleKeyBtn.addEventListener("click", () => {
  const isPassword = apiKeyInput.type === "password";
  apiKeyInput.type = isPassword ? "text" : "password";
  eyeIcon.textContent = isPassword ? "Hide" : "Show";
});

// ---------------------------------------------------------------------------
// Save Settings
// ---------------------------------------------------------------------------
saveSettingsBtn.addEventListener("click", async () => {
  saveSettingsBtn.disabled = true;
  saveSettingsBtn.textContent = "Saving...";
  hideStatus();

  // Gather current settings from UI
  const intensityRadio = document.querySelector('input[name="intensity"]:checked') as HTMLInputElement | null;

  const settings: ExtensionSettings = {
    apiKey: apiKeyInput.value.trim(),
    enabled: enabledToggle.checked,
    model: modelSelect.value,
    intensity: intensityRadio?.value ?? "balanced",
    enabledActions: {
      highlight: actionCheckboxes.highlight.checked,
      collapse: actionCheckboxes.collapse.checked,
      dim: actionCheckboxes.dim.checked,
      annotate: actionCheckboxes.annotate.checked,
      reorder: actionCheckboxes.reorder.checked,
    },
  };

  // Validate API key (warn but don't block)
  keyWarning.classList.add("hidden");
  if (settings.apiKey && (!settings.apiKey.startsWith("AIza") || settings.apiKey.length < 30)) {
    keyWarning.textContent = "Key doesn't look like a valid Gemini API key. Saving anyway.";
    keyWarning.classList.remove("hidden");
  }

  try {
    await chrome.storage.local.set({ extensionSettings: settings });

    // Notify background service worker
    await chrome.runtime.sendMessage({
      type: "SETTINGS_UPDATED",
      payload: settings,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function showStatus(message: string, type: "success" | "error"): void {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
}

function hideStatus(): void {
  statusDiv.className = "status hidden";
  statusDiv.textContent = "";
}
