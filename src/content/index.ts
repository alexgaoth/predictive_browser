// src/content/index.ts
// Orchestrator — wires extractor to messaging to transformer.

import { extractSkeleton } from './extractor.js';
import { applyTransforms } from './transformer.js';
import { startSignalCollection } from './signal-collector.js';
import type { TransformResponse, LinkPreviewMessage } from '../types/interfaces.js';

async function main() {
  // 0. Check if extension is enabled
  try {
    const stored = await chrome.storage.local.get("extensionSettings");
    if (stored["extensionSettings"]?.enabled === false) {
      console.log("[Predictive Browser] Extension is disabled, skipping.");
      return;
    }
  } catch { /* proceed if storage read fails */ }

  // 1. Wait for page to settle (handle SPAs)
  await waitForDomStable();

  // 2. Extract skeleton
  const skeleton = extractSkeleton();

  // 3. Validate skeleton has content
  if (skeleton.nodes.length === 0) {
    console.log("[Predictive Browser] Empty page, skipping.");
    return;
  }

  // 4. Send skeleton to background service worker
  try {
    const response = await chrome.runtime.sendMessage({
      type: "SKELETON_READY",
      payload: skeleton,
    });

    // 5. Handle response
    if (response?.type === "TRANSFORMS_READY") {
      const transformResponse = response.payload as TransformResponse;
      console.log("[Predictive Browser] Transforms received:", transformResponse);

      await applyTransforms(transformResponse, skeleton);

      // 6. Start signal collection on the transformed elements
      const appliedTransforms = transformResponse.transforms.map(t => ({
        selector: t.selector,
        action: t.action,
      }));
      startSignalCollection(appliedTransforms);
    } else if (response?.type === "TRANSFORM_ERROR") {
      console.error("[Predictive Browser] Transform error:", response.payload.message);
      // Still collect basic page signals even without transforms
      startSignalCollection([]);
    }
  } catch (err) {
    console.error("[Predictive Browser] Failed to send skeleton:", err);
    // Collect basic page signals even on error
    startSignalCollection([]);
  }
}

// ---------------------------------------------------------------------------
// Second pass listener — link previews arrive asynchronously
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message: { type: string }) => {
  if (message.type === "LINK_PREVIEWS_READY") {
    const msg = message as unknown as LinkPreviewMessage;
    console.log("[Predictive Browser] Link previews received:", msg.payload.previews.length, "previews");
    applyTransforms({
      transforms: msg.payload.transforms,
      summary: "",
      inferredIntent: ""
    });
  }
});

function waitForDomStable(): Promise<void> {
  return new Promise((resolve) => {
    let timeout: number;

    const observer = new MutationObserver(() => {
      clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 1000); // 1s of silence = DOM is stable
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Hard cap: extract no later than 6s (covers slow Next.js / heavy SPA hydration)
    setTimeout(() => {
      observer.disconnect();
      resolve();
    }, 6000);

    // Initial timeout — resolves early if DOM is already stable on load
    timeout = window.setTimeout(() => {
      observer.disconnect();
      resolve();
    }, 1000);
  });
}

// Run
main().catch(console.error);
