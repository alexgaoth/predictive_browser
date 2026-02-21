# Session 3: Transform Executor + Animation System

## Your Role
You are building the **visual magic** of the extension — the module that takes a `TransformResponse` (array of surgical instructions) and applies them to the live DOM with smooth, satisfying animations. This is what judges see. Your code is the difference between "cool concept" and "wow, I want to use this."

## Files You Own
```
src/content/transformer.ts     (core transform execution + animations)
```

**That's it — one file.** You own the most focused, most impactful piece. Do NOT create or modify any files in `src/background/`, `src/popup/`, `src/types/`, or other `src/content/` files.

---

## Read First: Shared Interface Contracts

Read `00-SHARED-SETUP.md` for the full type definitions. Your key contracts:

- **You receive:** `TransformResponse` (containing `TransformInstruction[]`)
- **You apply:** DOM mutations with animations to the live page
- **You use:** CSS selectors from `TransformInstruction.selector` to find target elements
- **You export:** `applyTransforms(response: TransformResponse): void`

---

## The Main Export

```typescript
// src/content/transformer.ts

export async function applyTransforms(response: TransformResponse): Promise<void> {
  // 1. Inject animation styles into the page (once)
  // 2. Sort transforms by relevance (highest first)
  // 3. Apply each transform with staggered timing
  // 4. Optionally show a summary toast
}
```

This function is called by `index.ts` (Session 1) after receiving transforms from the background worker.

---

## Task 1: CSS Injection

Inject a `<style>` element into the page head with all necessary animation classes. Do this once — check for an existing style tag with a specific ID to avoid duplicates.

```typescript
function injectStyles(): void {
  if (document.getElementById("predictive-browser-styles")) return;
  
  const style = document.createElement("style");
  style.id = "predictive-browser-styles";
  style.textContent = `
    /* ... all animation CSS ... */
  `;
  document.head.appendChild(style);
}
```

### Required CSS Classes

Design these animations to feel **smooth and intentional**, not jarring. Think of it like a page "breathing" into its new shape.

#### `.pb-highlight`
- Adds a subtle colored left border (3px solid, a calm blue like `#4A90D9`)
- Very light background tint (`rgba(74, 144, 217, 0.05)`)
- Slightly increases padding-left for breathing room
- Transition: fade in over 400ms with a slight scale pulse (1.0 → 1.005 → 1.0)

#### `.pb-collapse`
- Animates `max-height` from current height to 0
- Simultaneously fades `opacity` from 1 to 0
- Adds `overflow: hidden` during animation
- After animation completes, sets `display: none`
- Duration: 500ms, ease-out curve
- **Important:** Store the original `display` and `maxHeight` values as data attributes so it could theoretically be undone

#### `.pb-reorder`
- The element slides out of its current position (fade + translateY)
- Reappears at the new position (fade in + translateY from opposite direction)
- This is the trickiest animation — see detailed implementation below

#### `.pb-annotate`
- Inserts a small badge element **before** the target element (not inside it)
- Badge: inline-block, small rounded pill, subtle background (`#E8F4FD`), blue text
- Text from `instruction.annotation`
- Fades in with a slight downward slide

#### `.pb-dim`
- Reduces opacity to 0.4
- Slight grayscale filter (`filter: grayscale(30%)`)
- Transition: 400ms ease

### Animation Timing Constants

```typescript
const TIMING = {
  STAGGER_DELAY: 80,        // ms between each transform starting
  HIGHLIGHT_DURATION: 400,
  COLLAPSE_DURATION: 500,
  REORDER_DURATION: 600,
  ANNOTATE_DURATION: 300,
  DIM_DURATION: 400,
  TOAST_DURATION: 3000,
} as const;
```

The stagger delay is key — transforms apply one after another with 80ms gaps, creating a cascade effect that looks intentional and lets users track what's changing.

---

## Task 2: Transform Executors

Each action type gets its own executor function.

### Highlight

```typescript
function executeHighlight(el: HTMLElement, instruction: TransformInstruction): void {
  // Save original styles
  el.dataset.pbOriginalBorder = el.style.borderLeft;
  el.dataset.pbOriginalBg = el.style.backgroundColor;
  el.dataset.pbOriginalPadding = el.style.paddingLeft;
  
  // Apply transition first, then styles
  el.style.transition = `all ${TIMING.HIGHLIGHT_DURATION}ms ease`;
  
  requestAnimationFrame(() => {
    el.style.borderLeft = "3px solid #4A90D9";
    el.style.backgroundColor = "rgba(74, 144, 217, 0.05)";
    el.style.paddingLeft = (parseInt(getComputedStyle(el).paddingLeft) + 8) + "px";
    el.style.borderRadius = "2px";
  });
}
```

### Collapse

```typescript
function executeCollapse(el: HTMLElement, instruction: TransformInstruction): void {
  // Store originals for potential undo
  el.dataset.pbOriginalDisplay = getComputedStyle(el).display;
  el.dataset.pbOriginalHeight = el.offsetHeight + "px";
  el.dataset.pbOriginalOverflow = el.style.overflow;
  
  // Set up for animation
  el.style.maxHeight = el.offsetHeight + "px";
  el.style.overflow = "hidden";
  el.style.transition = `max-height ${TIMING.COLLAPSE_DURATION}ms ease-out, 
                          opacity ${TIMING.COLLAPSE_DURATION}ms ease-out`;
  
  requestAnimationFrame(() => {
    el.style.maxHeight = "0px";
    el.style.opacity = "0";
  });
  
  // After animation, fully hide
  setTimeout(() => {
    el.style.display = "none";
  }, TIMING.COLLAPSE_DURATION);
}
```

### Reorder

This is the hardest one. Moving a DOM element and making it look good.

```typescript
function executeReorder(el: HTMLElement, instruction: TransformInstruction): void {
  const parent = el.parentElement;
  if (!parent) return;

  // Step 1: Record current position
  const startRect = el.getBoundingClientRect();
  
  // Step 2: Move the element in the DOM
  if (instruction.position === "top") {
    parent.insertBefore(el, parent.firstElementChild);
  } else if (instruction.position?.startsWith("above:")) {
    const targetSelector = instruction.position.replace("above:", "");
    const targetEl = document.querySelector(targetSelector);
    if (targetEl && targetEl.parentElement) {
      targetEl.parentElement.insertBefore(el, targetEl);
    }
  }
  
  // Step 3: Record new position
  const endRect = el.getBoundingClientRect();
  
  // Step 4: Use FLIP technique (First, Last, Invert, Play)
  const deltaY = startRect.top - endRect.top;
  const deltaX = startRect.left - endRect.left;
  
  // Invert: move it back to where it was
  el.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
  el.style.opacity = "0.6";
  el.style.transition = "none";
  
  // Play: animate to final position
  requestAnimationFrame(() => {
    el.style.transition = `transform ${TIMING.REORDER_DURATION}ms cubic-bezier(0.25, 0.46, 0.45, 0.94), 
                           opacity ${TIMING.REORDER_DURATION / 2}ms ease`;
    el.style.transform = "translate(0, 0)";
    el.style.opacity = "1";
  });
  
  // Cleanup
  setTimeout(() => {
    el.style.transform = "";
    el.style.transition = "";
  }, TIMING.REORDER_DURATION + 50);
}
```

### Annotate

```typescript
function executeAnnotate(el: HTMLElement, instruction: TransformInstruction): void {
  if (!instruction.annotation) return;
  
  // Create badge
  const badge = document.createElement("div");
  badge.className = "pb-annotation-badge";
  badge.textContent = instruction.annotation;
  badge.style.cssText = `
    display: inline-block;
    background: #E8F4FD;
    color: #2171B5;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 10px;
    margin-bottom: 4px;
    opacity: 0;
    transform: translateY(-4px);
    transition: opacity ${TIMING.ANNOTATE_DURATION}ms ease, 
                transform ${TIMING.ANNOTATE_DURATION}ms ease;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    line-height: 1.6;
    letter-spacing: 0.3px;
  `;
  
  // Insert before the element
  el.parentElement?.insertBefore(badge, el);
  
  // Animate in
  requestAnimationFrame(() => {
    badge.style.opacity = "1";
    badge.style.transform = "translateY(0)";
  });
}
```

### Dim

```typescript
function executeDim(el: HTMLElement, instruction: TransformInstruction): void {
  el.dataset.pbOriginalOpacity = el.style.opacity;
  el.dataset.pbOriginalFilter = el.style.filter;
  
  el.style.transition = `opacity ${TIMING.DIM_DURATION}ms ease, 
                         filter ${TIMING.DIM_DURATION}ms ease`;
  
  requestAnimationFrame(() => {
    el.style.opacity = "0.4";
    el.style.filter = "grayscale(30%)";
  });
}
```

---

## Task 3: The Orchestrator

```typescript
export async function applyTransforms(response: TransformResponse): Promise<void> {
  // 1. Inject styles
  injectStyles();
  
  // 2. Sort by relevance (highest first — most important transforms animate first)
  const sorted = [...response.transforms].sort((a, b) => b.relevance - a.relevance);
  
  // 3. Apply with stagger
  for (let i = 0; i < sorted.length; i++) {
    const instruction = sorted[i];
    
    // Find the element
    const el = document.querySelector(instruction.selector) as HTMLElement | null;
    if (!el) {
      console.warn(`[Predictive Browser] Selector not found: ${instruction.selector}`);
      continue;
    }
    
    // Stagger delay
    await delay(TIMING.STAGGER_DELAY);
    
    // Execute the appropriate transform
    switch (instruction.action) {
      case "highlight":
        executeHighlight(el, instruction);
        break;
      case "collapse":
        executeCollapse(el, instruction);
        break;
      case "reorder":
        executeReorder(el, instruction);
        break;
      case "annotate":
        executeAnnotate(el, instruction);
        break;
      case "dim":
        executeDim(el, instruction);
        break;
    }
  }
  
  // 4. Show summary toast
  if (response.summary && response.transforms.length > 0) {
    showToast(response.summary, response.inferredIntent);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## Task 4: Summary Toast

After all transforms apply, show a small floating toast in the bottom-right corner that briefly describes what happened.

```typescript
function showToast(summary: string, intent: string): void {
  const toast = document.createElement("div");
  toast.id = "pb-toast";
  toast.innerHTML = `
    <div style="font-weight: 600; margin-bottom: 4px;">🔮 Page optimized</div>
    <div style="font-size: 12px; opacity: 0.9;">${summary}</div>
    <div style="font-size: 11px; opacity: 0.6; margin-top: 4px;">Intent: ${intent}</div>
  `;
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #1a1a2e;
    color: white;
    padding: 14px 18px;
    border-radius: 10px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    max-width: 320px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    z-index: 999999;
    opacity: 0;
    transform: translateY(10px);
    transition: opacity 300ms ease, transform 300ms ease;
    line-height: 1.5;
  `;
  
  document.body.appendChild(toast);
  
  // Animate in
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });
  
  // Animate out and remove
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    setTimeout(() => toast.remove(), 300);
  }, TIMING.TOAST_DURATION);
}
```

---

## Task 5: Self-Test Function

Create a test that can be run on any page from the browser console:

```typescript
export async function testTransformer(): Promise<void> {
  // Create a mock TransformResponse using real selectors from the current page
  const firstH1 = document.querySelector("h1");
  const firstNav = document.querySelector("nav");
  const firstSection = document.querySelector("section") || document.querySelector("main");
  const firstLink = document.querySelector("a[href]");
  
  const mockResponse: TransformResponse = {
    transforms: [],
    summary: "Test: Highlighted headings, dimmed navigation, annotated first link.",
    inferredIntent: "Testing transform executor"
  };
  
  if (firstH1) {
    mockResponse.transforms.push({
      action: "highlight",
      selector: getTestSelector(firstH1),
      reason: "Test highlight",
      relevance: 90
    });
  }
  
  if (firstNav) {
    mockResponse.transforms.push({
      action: "dim",
      selector: getTestSelector(firstNav),
      reason: "Test dim",
      relevance: 30
    });
  }
  
  if (firstLink) {
    mockResponse.transforms.push({
      action: "annotate",
      selector: getTestSelector(firstLink),
      reason: "Test annotation",
      relevance: 70,
      annotation: "★ Test badge"
    });
  }
  
  console.log("[Predictive Browser] Running transformer test with", mockResponse.transforms.length, "transforms");
  await applyTransforms(mockResponse);
  console.log("[Predictive Browser] Transformer test complete!");
}

function getTestSelector(el: Element): string {
  if (el.id) return `#${el.id}`;
  // Build a basic positional selector
  const path: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.body) {
    const parent = current.parentElement;
    if (parent) {
      const index = Array.from(parent.children).indexOf(current) + 1;
      path.unshift(`${current.tagName.toLowerCase()}:nth-child(${index})`);
    }
    current = parent;
  }
  return "body > " + path.join(" > ");
}
```

---

## Edge Cases to Handle

1. **Selector returns null**: Skip silently with a console.warn. Don't crash.
2. **Element already transformed**: Check for a `data-pb-transformed` attribute. If present, skip to avoid double-applying.
3. **Fixed/sticky elements**: Don't reorder elements with `position: fixed` or `position: sticky` — it'll break the page layout. Check `getComputedStyle(el).position` before reorder.
4. **Very tall collapsed sections**: If an element is taller than 2000px, collapse might look weird. Cap the animation with a faster duration for very tall elements.
5. **Selectors with special characters**: Some CSS selectors might have characters that need escaping. Use `CSS.escape()` for ID-based selectors.
6. **Page navigation (SPA)**: If the page URL changes without a full reload, the old transforms are stale. Mark all transformed elements with `data-pb-transformed="true"` so a future pass can clean them up.

### Cleanup Function (For SPA Re-runs)

```typescript
export function cleanupTransforms(): void {
  // Remove all annotations
  document.querySelectorAll(".pb-annotation-badge").forEach(el => el.remove());
  
  // Remove toast
  document.getElementById("pb-toast")?.remove();
  
  // Restore all transformed elements
  document.querySelectorAll("[data-pb-transformed]").forEach(el => {
    const htmlEl = el as HTMLElement;
    // Restore original styles from data attributes
    if (htmlEl.dataset.pbOriginalBorder !== undefined) {
      htmlEl.style.borderLeft = htmlEl.dataset.pbOriginalBorder;
    }
    if (htmlEl.dataset.pbOriginalBg !== undefined) {
      htmlEl.style.backgroundColor = htmlEl.dataset.pbOriginalBg;
    }
    if (htmlEl.dataset.pbOriginalOpacity !== undefined) {
      htmlEl.style.opacity = htmlEl.dataset.pbOriginalOpacity;
    }
    if (htmlEl.dataset.pbOriginalFilter !== undefined) {
      htmlEl.style.filter = htmlEl.dataset.pbOriginalFilter;
    }
    if (htmlEl.dataset.pbOriginalDisplay !== undefined) {
      htmlEl.style.display = htmlEl.dataset.pbOriginalDisplay;
      htmlEl.style.maxHeight = "";
    }
    // Remove all pb- data attributes
    Object.keys(htmlEl.dataset).forEach(key => {
      if (key.startsWith("pb")) delete htmlEl.dataset[key];
    });
  });
}
```

---

## Visual Quality Checklist

This is a hackathon — judges form impressions in seconds. The animations need to feel **polished**:

- [ ] No layout jank — elements don't jump before animating
- [ ] Stagger creates a satisfying cascade, not a strobe effect
- [ ] Collapsed sections don't leave visible gaps (surrounding elements should reflow naturally)
- [ ] Toast is readable and doesn't overlap important content
- [ ] Colors are subtle, not garish — this is a tool, not a theme park
- [ ] Annotations don't break text wrapping or layout
- [ ] The page is still usable after transforms — links work, text is readable

---

## Definition of Done

- [ ] `applyTransforms()` handles all 5 action types
- [ ] Animations are smooth with proper stagger timing
- [ ] FLIP technique works correctly for reorder
- [ ] Toast appears and auto-dismisses
- [ ] Cleanup function can fully restore the page
- [ ] All edge cases handled (null selectors, fixed elements, double-apply)
- [ ] Elements are marked with `data-pb-transformed` for tracking
- [ ] Self-test function works on any arbitrary page
- [ ] No files outside your ownership were created or modified

## Estimated Time: 2-3 hours

## Note on Merge
When merging, Session 1 needs to uncomment the import in `index.ts`:
```typescript
import { applyTransforms } from './transformer.js';
```
And uncomment the call to `applyTransforms(response.payload)` in the message handler. That's it — one line change to wire everything together.
