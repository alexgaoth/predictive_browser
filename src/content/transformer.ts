// src/content/transformer.ts — Transform Executor + Animation System
// Owned by Session 3. Do NOT modify files outside this module.

import type { TransformResponse, TransformInstruction, PageSkeleton, SkeletonNode } from '../types/interfaces.js';

// ---------------------------------------------------------------------------
// Timing Constants
// ---------------------------------------------------------------------------

const TIMING = {
  STAGGER_DELAY: 25,       // faster cascade for compact-view effect
  HIGHLIGHT_DURATION: 300,
  COLLAPSE_DURATION: 220,  // quick collapse — we're hiding a lot
  REORDER_DURATION: 500,
  ANNOTATE_DURATION: 250,
  DIM_DURATION: 300,
  TOAST_DURATION: 3000,
} as const;

// ---------------------------------------------------------------------------
// Task 1: CSS Injection
// ---------------------------------------------------------------------------

function injectStyles(): void {
  if (document.getElementById("predictive-browser-styles")) return;

  const style = document.createElement("style");
  style.id = "predictive-browser-styles";
  style.textContent = `
    .pb-highlight {
      border-left: 3px solid #4A90D9 !important;
      background-color: rgba(74, 144, 217, 0.05) !important;
      border-radius: 2px;
      transition: all 400ms ease;
    }

    .pb-collapse {
      overflow: hidden !important;
      transition: max-height 500ms ease-out, opacity 500ms ease-out;
    }

    .pb-dim {
      opacity: 0.4 !important;
      filter: grayscale(30%) !important;
      transition: opacity 400ms ease, filter 400ms ease;
    }

    .pb-annotation-badge {
      display: inline-block;
      background: #E8F4FD;
      color: #2171B5;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 10px;
      margin-bottom: 4px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.6;
      letter-spacing: 0.3px;
    }

    .pb-link-preview-badge {
      display: inline-block;
      background: #E8F8E8;
      color: #2E7D32;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 10px;
      margin-bottom: 4px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.6;
      letter-spacing: 0.3px;
    }

    @keyframes pb-pulse {
      0% { transform: scale(1); }
      50% { transform: scale(1.005); }
      100% { transform: scale(1); }
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Task 2: Transform Executors
// ---------------------------------------------------------------------------

function executeHighlight(el: HTMLElement, _instruction: TransformInstruction): void {
  el.dataset.pbOriginalBorder = el.style.borderLeft;
  el.dataset.pbOriginalBg = el.style.backgroundColor;
  el.dataset.pbOriginalPadding = el.style.paddingLeft;

  el.style.transition = `all ${TIMING.HIGHLIGHT_DURATION}ms ease`;

  requestAnimationFrame(() => {
    el.style.borderLeft = "3px solid #4A90D9";
    el.style.backgroundColor = "rgba(74, 144, 217, 0.05)";
    el.style.paddingLeft = (parseInt(getComputedStyle(el).paddingLeft) + 8) + "px";
    el.style.borderRadius = "2px";
    el.style.animation = "pb-pulse 400ms ease";
  });
}

function executeCollapse(el: HTMLElement, _instruction: TransformInstruction): void {
  el.dataset.pbOriginalDisplay = getComputedStyle(el).display;
  el.dataset.pbOriginalHeight = el.offsetHeight + "px";
  el.dataset.pbOriginalOverflow = el.style.overflow;

  const height = el.offsetHeight;
  // For very tall elements (>2000px), use a faster duration
  const duration = height > 2000 ? 300 : TIMING.COLLAPSE_DURATION;

  el.style.maxHeight = height + "px";
  el.style.overflow = "hidden";
  el.style.transition = `max-height ${duration}ms ease-out, opacity ${duration}ms ease-out`;

  requestAnimationFrame(() => {
    el.style.maxHeight = "0px";
    el.style.opacity = "0";
  });

  setTimeout(() => {
    el.style.display = "none";
  }, duration);
}

function executeReorder(el: HTMLElement, instruction: TransformInstruction): void {
  const parent = el.parentElement;
  if (!parent) return;

  // Don't reorder fixed/sticky elements
  const position = getComputedStyle(el).position;
  if (position === "fixed" || position === "sticky") {
    console.warn("[Predictive Browser] Skipping reorder on fixed/sticky element:", instruction.selector);
    return;
  }

  // FLIP: First — record current position
  const startRect = el.getBoundingClientRect();

  // Last — move the element in the DOM
  if (instruction.position === "top") {
    parent.insertBefore(el, parent.firstElementChild);
  } else if (instruction.position?.startsWith("above:")) {
    const targetSelector = instruction.position.replace("above:", "");
    const targetEl = document.querySelector(targetSelector);
    if (targetEl && targetEl.parentElement) {
      targetEl.parentElement.insertBefore(el, targetEl);
    }
  }

  // Record new position
  const endRect = el.getBoundingClientRect();

  // Invert — translate back to where it was
  const deltaY = startRect.top - endRect.top;
  const deltaX = startRect.left - endRect.left;

  el.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
  el.style.opacity = "0.6";
  el.style.transition = "none";

  // Play — animate to final position
  requestAnimationFrame(() => {
    el.style.transition = `transform ${TIMING.REORDER_DURATION}ms cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity ${TIMING.REORDER_DURATION / 2}ms ease`;
    el.style.transform = "translate(0, 0)";
    el.style.opacity = "1";
  });

  // Cleanup
  setTimeout(() => {
    el.style.transform = "";
    el.style.transition = "";
  }, TIMING.REORDER_DURATION + 50);
}

function executeAnnotate(el: HTMLElement, instruction: TransformInstruction): void {
  if (!instruction.annotation) return;

  const badgeClass = (instruction as TransformInstruction & { badgeClass?: string }).badgeClass || "pb-annotation-badge";
  const badge = document.createElement("div");
  badge.className = badgeClass;
  badge.textContent = instruction.annotation;
  badge.style.opacity = "0";
  badge.style.transform = "translateY(-4px)";
  badge.style.transition = `opacity ${TIMING.ANNOTATE_DURATION}ms ease, transform ${TIMING.ANNOTATE_DURATION}ms ease`;

  el.parentElement?.insertBefore(badge, el);

  requestAnimationFrame(() => {
    badge.style.opacity = "1";
    badge.style.transform = "translateY(0)";
  });
}

function executeDim(el: HTMLElement, _instruction: TransformInstruction): void {
  el.dataset.pbOriginalOpacity = el.style.opacity;
  el.dataset.pbOriginalFilter = el.style.filter;

  el.style.transition = `opacity ${TIMING.DIM_DURATION}ms ease, filter ${TIMING.DIM_DURATION}ms ease`;

  requestAnimationFrame(() => {
    el.style.opacity = "0.4";
    el.style.filter = "grayscale(30%)";
  });
}

// ---------------------------------------------------------------------------
// Task 3: The Orchestrator
// ---------------------------------------------------------------------------

/** Recursively build a map: primary selector → fallback nth-child selector */
function buildFallbackMap(nodes: SkeletonNode[], map: Map<string, string>): void {
  for (const node of nodes) {
    if (node.fallbackSelector) {
      map.set(node.selector, node.fallbackSelector);
    }
    if (node.children.length > 0) {
      buildFallbackMap(node.children, map);
    }
  }
}

/** Find element by primary selector, then by fallback nth-child path, then re-stamp attribute */
function findElement(selector: string, fallbackMap: Map<string, string>): HTMLElement | null {
  // Primary: data-pb-node attribute
  let el = document.querySelector(selector) as HTMLElement | null;
  if (el) return el;

  // Fallback: nth-child path (in case JS framework wiped data-pb-node during hydration)
  const fallback = fallbackMap.get(selector);
  if (fallback) {
    el = document.querySelector(fallback) as HTMLElement | null;
    if (el) {
      // Re-stamp the attribute so later lookups on this element still work
      const nodeId = selector.match(/data-pb-node="([^"]+)"/)?.[1];
      if (nodeId) el.setAttribute("data-pb-node", nodeId);
      return el;
    }
  }

  return null;
}

export async function applyTransforms(response: TransformResponse, skeleton?: PageSkeleton): Promise<void> {
  injectStyles();

  // Build fallback map from skeleton (nth-child paths as backup selectors)
  const fallbackMap = new Map<string, string>();
  if (skeleton) buildFallbackMap(skeleton.nodes, fallbackMap);

  // Sort by relevance (highest first)
  const sorted = [...response.transforms].sort((a, b) => b.relevance - a.relevance);

  for (let i = 0; i < sorted.length; i++) {
    const instruction = sorted[i];

    const el = findElement(instruction.selector, fallbackMap);
    if (!el) {
      console.warn(`[Predictive Browser] Selector not found: ${instruction.selector}`);
      continue;
    }

    // Skip already-transformed elements
    if (el.dataset.pbTransformed) {
      console.warn(`[Predictive Browser] Element already transformed: ${instruction.selector}`);
      continue;
    }

    // Stagger delay
    await delay(TIMING.STAGGER_DELAY);

    // Mark as transformed
    el.dataset.pbTransformed = "true";

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

  // Inject digest panel — replaces the old toast
  if (response.transforms.length > 0) {
    injectDigestPanel(response);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Task 4: Digest Panel — persistent, site-styled summary at top of page
// ---------------------------------------------------------------------------

function parseLuminance(color: string): number | null {
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) / 255;
}

function isColorDark(color: string): boolean {
  const l = parseLuminance(color);
  return l !== null && l < 0.5;
}

/** Walk up from a candidate element until we find a non-transparent background. */
function resolveBackground(start: Element): string {
  let el: Element | null = start;
  while (el) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
    el = el.parentElement;
  }
  return "#ffffff";
}

/** Extract the site's real font, background, text, and accent colours. */
function getSiteStyle() {
  const content = document.querySelector("main, [role='main'], article, #content, .content") ?? document.body;
  const heading = document.querySelector("h1, h2, h3") ?? content;

  const fontFamily =
    getComputedStyle(heading).fontFamily ||
    getComputedStyle(content).fontFamily ||
    '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  const bgColor  = resolveBackground(content);
  const isDark   = isColorDark(bgColor);
  const textColor = getComputedStyle(content).color || (isDark ? "#ffffff" : "#111111");

  // Use the page's link colour as accent if readable, otherwise fall back to indigo
  const linkEl   = document.querySelector("a");
  const linkColor = linkEl ? getComputedStyle(linkEl).color : null;
  const accent   = linkColor && parseLuminance(linkColor) !== null ? linkColor : "#6366f1";

  return { fontFamily, isDark, textColor, accent };
}

function injectDigestPanel(response: TransformResponse): void {
  document.getElementById("pb-digest")?.remove();

  const { fontFamily, isDark, textColor, accent } = getSiteStyle();

  const subtleColor = isDark ? "rgba(255,255,255,0.38)" : "rgba(0,0,0,0.36)";
  const panelBg     = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.025)";
  const borderColor = isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.09)";

  const panel = document.createElement("div");
  panel.id = "pb-digest";
  panel.style.cssText = `
    font-family: ${fontFamily};
    background: ${panelBg};
    border-bottom: 1px solid ${borderColor};
    border-left: 3px solid ${accent};
    padding: 10px 36px 10px 14px;
    position: relative;
    z-index: 9999;
    box-sizing: border-box;
    width: 100%;
    color: ${textColor};
    opacity: 0;
    transition: opacity 280ms ease;
  `;

  // Label row
  const label = document.createElement("div");
  label.style.cssText = `font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: ${accent}; margin-bottom: 5px;`;
  label.textContent = `\u{1F52E} Focused view \u00B7 ${response.inferredIntent}`;

  // Digest / summary text
  const body = document.createElement("div");
  body.style.cssText = `font-size: 13px; line-height: 1.55; color: ${textColor};`;
  body.textContent = response.digest ?? response.summary;

  // Dismiss button
  const dismiss = document.createElement("button");
  dismiss.textContent = "\u2715";
  dismiss.title = "Dismiss";
  dismiss.style.cssText = `
    position: absolute; top: 8px; right: 10px;
    background: none; border: none; cursor: pointer;
    font-size: 13px; padding: 2px 4px; line-height: 1;
    color: ${subtleColor}; transition: color 0.15s;
  `;
  dismiss.onmouseenter = () => { dismiss.style.color = textColor; };
  dismiss.onmouseleave = () => { dismiss.style.color = subtleColor; };
  dismiss.onclick = () => panel.remove();

  panel.appendChild(label);
  panel.appendChild(body);
  panel.appendChild(dismiss);

  document.body.insertBefore(panel, document.body.firstChild);

  requestAnimationFrame(() => { panel.style.opacity = "1"; });
}

// ---------------------------------------------------------------------------
// Task 4b: Toast (kept for potential future use)
// ---------------------------------------------------------------------------

function showToast(summary: string, intent: string): void {
  // Remove existing toast if present
  document.getElementById("pb-toast")?.remove();

  const toast = document.createElement("div");
  toast.id = "pb-toast";

  // Sanitize text content to prevent XSS
  const summarySpan = document.createElement("div");
  summarySpan.style.cssText = "font-size: 12px; opacity: 0.9;";
  summarySpan.textContent = summary;

  const intentSpan = document.createElement("div");
  intentSpan.style.cssText = "font-size: 11px; opacity: 0.6; margin-top: 4px;";
  intentSpan.textContent = `Intent: ${intent}`;

  const header = document.createElement("div");
  header.style.cssText = "font-weight: 600; margin-bottom: 4px;";
  header.textContent = "\u{1F52E} Page optimized";

  toast.appendChild(header);
  toast.appendChild(summarySpan);
  toast.appendChild(intentSpan);

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

  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    setTimeout(() => toast.remove(), 300);
  }, TIMING.TOAST_DURATION);
}

// ---------------------------------------------------------------------------
// Task 5: Self-Test Function
// ---------------------------------------------------------------------------

export async function testTransformer(): Promise<void> {
  const firstH1 = document.querySelector("h1");
  const firstNav = document.querySelector("nav");
  const firstLink = document.querySelector("a[href]");

  const mockResponse: TransformResponse = {
    transforms: [],
    summary: "Test: Highlighted headings, dimmed navigation, annotated first link.",
    inferredIntent: "Testing transform executor",
  };

  if (firstH1) {
    mockResponse.transforms.push({
      action: "highlight",
      selector: getTestSelector(firstH1),
      reason: "Test highlight",
      relevance: 90,
    });
  }

  if (firstNav) {
    mockResponse.transforms.push({
      action: "dim",
      selector: getTestSelector(firstNav),
      reason: "Test dim",
      relevance: 30,
    });
  }

  if (firstLink) {
    mockResponse.transforms.push({
      action: "annotate",
      selector: getTestSelector(firstLink),
      reason: "Test annotation",
      relevance: 70,
      annotation: "\u2605 Test badge",
    });
  }

  console.log("[Predictive Browser] Running transformer test with", mockResponse.transforms.length, "transforms");
  await applyTransforms(mockResponse);
  console.log("[Predictive Browser] Transformer test complete!");
}

function getTestSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const path: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.body) {
    const parent: Element | null = current.parentElement;
    if (parent) {
      const index = Array.from(parent.children).indexOf(current) + 1;
      path.unshift(`${current.tagName.toLowerCase()}:nth-child(${index})`);
    }
    current = parent;
  }
  return "body > " + path.join(" > ");
}

// ---------------------------------------------------------------------------
// Cleanup (for SPA re-runs)
// ---------------------------------------------------------------------------

export function cleanupTransforms(): void {
  // Remove all annotations (regular and link preview)
  document.querySelectorAll(".pb-annotation-badge, .pb-link-preview-badge").forEach(el => el.remove());

  // Remove digest panel and toast
  document.getElementById("pb-digest")?.remove();
  document.getElementById("pb-toast")?.remove();

  // Restore all transformed elements
  document.querySelectorAll("[data-pb-transformed]").forEach(el => {
    const htmlEl = el as HTMLElement;

    if (htmlEl.dataset.pbOriginalBorder !== undefined) {
      htmlEl.style.borderLeft = htmlEl.dataset.pbOriginalBorder;
    }
    if (htmlEl.dataset.pbOriginalBg !== undefined) {
      htmlEl.style.backgroundColor = htmlEl.dataset.pbOriginalBg;
    }
    if (htmlEl.dataset.pbOriginalPadding !== undefined) {
      htmlEl.style.paddingLeft = htmlEl.dataset.pbOriginalPadding;
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
      htmlEl.style.opacity = "";
    }

    // Remove all pb- data attributes
    Object.keys(htmlEl.dataset).forEach(key => {
      if (key.startsWith("pb")) delete htmlEl.dataset[key];
    });
  });

  // Remove stable node stamps added by the extractor
  document.querySelectorAll("[data-pb-node]").forEach(el => el.removeAttribute("data-pb-node"));
}
