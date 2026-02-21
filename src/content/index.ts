// src/content/index.ts
// Orchestrator — wires extractor to messaging to transformer.
// Message types referenced from src/types/interfaces.ts (Session 2).

import { extractSkeleton } from './extractor.js';
import { applyTransforms } from './transformer.js';

// Inline type references until Session 2 merges interfaces.ts
interface SkeletonMessage {
  type: "SKELETON_READY";
  payload: ReturnType<typeof extractSkeleton>;
}

async function main() {
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
    } as SkeletonMessage);

    // 5. Handle response
    if (response?.type === "TRANSFORMS_READY") {
      console.log("[Predictive Browser] Transforms received:", response.payload);
      await applyTransforms(response.payload);
    } else if (response?.type === "TRANSFORM_ERROR") {
      console.error("[Predictive Browser] Transform error:", response.payload.message);
    }
  } catch (err) {
    console.error("[Predictive Browser] Failed to send skeleton:", err);
  }
}

function waitForDomStable(): Promise<void> {
  return new Promise((resolve) => {
    let timeout: number;

    const observer = new MutationObserver(() => {
      clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 500);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Fallback: resolve after 3 seconds no matter what
    setTimeout(() => {
      observer.disconnect();
      resolve();
    }, 3000);

    // Initial timeout in case DOM is already stable
    timeout = window.setTimeout(() => {
      observer.disconnect();
      resolve();
    }, 500);
  });
}

// Run
main().catch(console.error);
