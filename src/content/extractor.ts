// src/content/extractor.ts
// Core DOM extraction logic — produces a compressed semantic skeleton of the page.
// Types referenced from src/types/interfaces.ts (Session 2). Defined inline until merge.

interface SkeletonNode {
  id: string;
  selector: string;
  fallbackSelector?: string;
  type: "heading" | "nav" | "section" | "link" | "image" | "text" | "list" | "form" | "unknown";
  textPreview: string;
  tag: string;
  headingLevel?: number;
  href?: string;
  alt?: string;
  children: SkeletonNode[];
}

interface PageSkeleton {
  url: string;
  title: string;
  metaDescription: string;
  nodes: SkeletonNode[];
  extractedAt: number;
}

const MAX_NODES = 150;
const MAX_DEPTH = 6;
const MAX_CHILDREN = 30;
const TEXT_PREVIEW_LENGTH = 80;

const SKIP_TAGS = new Set([
  "script", "style", "noscript", "template", "iframe",
]);

const AD_PATTERNS = [
  "ad-", "adsbygoogle", "cookie-banner", "consent",
  "ad_", "ads-", "advertisement", "cookie-consent",
  "gdpr", "cookie-notice",
];

let nodeCounter = 0;
let totalNodes = 0;

function classifyElement(el: Element): SkeletonNode["type"] {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute("role");

  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "nav" || role === "navigation") return "nav";
  if (["section", "article", "main", "aside"].includes(tag) || role === "main" || role === "region") return "section";
  if (tag === "a" && el.hasAttribute("href")) return "link";
  if (["img", "picture", "svg"].includes(tag) || role === "img") return "image";
  if (["ul", "ol"].includes(tag) || role === "list") return "list";
  if (tag === "form" || role === "form") return "form";
  if (["p", "span", "div"].includes(tag)) {
    const text = getTextPreview(el);
    if (text.length > 0) return "text";
  }

  // Check for visible content
  const text = getTextPreview(el);
  if (text.length > 0) return "unknown";

  return "unknown";
}

function getTextPreview(el: Element): string {
  // For images, use alt text
  if (el.tagName.toLowerCase() === "img" || el.getAttribute("role") === "img") {
    return el.getAttribute("alt") || "";
  }

  let text = el.textContent || "";
  text = text.trim().replace(/\s+/g, " ");
  if (text.length > TEXT_PREVIEW_LENGTH) {
    return text.slice(0, TEXT_PREVIEW_LENGTH) + "...";
  }
  return text;
}

function isHidden(el: Element): boolean {
  // Check zero dimensions
  const htmlEl = el as HTMLElement;
  if (htmlEl.offsetWidth === 0 && htmlEl.offsetHeight === 0) return true;

  // Check computed style
  try {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return true;
  } catch {
    // getComputedStyle can fail on some elements
  }

  return false;
}

function isAdOrCookieBanner(el: Element): boolean {
  const className = (el.className || "").toString().toLowerCase();
  const id = (el.id || "").toLowerCase();
  const combined = className + " " + id;
  return AD_PATTERNS.some(pattern => combined.includes(pattern));
}

function shouldSkipElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return true;

  // Skip decorative inline SVGs (but not SVGs that are role="img")
  if (tag === "svg" && el.getAttribute("role") !== "img") return true;

  if (isHidden(el)) return true;
  if (isAdOrCookieBanner(el)) return true;

  return false;
}

function generateSelector(el: Element): string {
  // Priority 1: unique ID
  if (el.id) {
    const sel = `#${CSS.escape(el.id)}`;
    try {
      if (document.querySelector(sel) === el) return sel;
    } catch { /* invalid selector, fall through */ }
  }

  // Priority 2: data-testid or aria-label
  const testId = el.getAttribute("data-testid");
  if (testId) {
    const sel = `[data-testid="${CSS.escape(testId)}"]`;
    try {
      if (document.querySelector(sel) === el) return sel;
    } catch { /* fall through */ }
  }

  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) {
    const sel = `[aria-label="${CSS.escape(ariaLabel)}"]`;
    try {
      if (document.querySelector(sel) === el) return sel;
    } catch { /* fall through */ }
  }

  // Priority 3: positional path
  return buildPositionalSelector(el);
}

function buildPositionalSelector(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current !== document.documentElement) {
    const tag = current.tagName.toLowerCase();
    if (tag === "body" || tag === "html") {
      parts.unshift(tag);
      current = current.parentElement;
      continue;
    }

    const parent = current.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }

    const siblings = Array.from(parent.children);
    const sameTagSiblings = siblings.filter(s => s.tagName === current!.tagName);

    if (sameTagSiblings.length === 1) {
      parts.unshift(tag);
    } else {
      const index = siblings.indexOf(current) + 1;
      parts.unshift(`${tag}:nth-child(${index})`);
    }

    current = parent;
  }

  const selector = parts.join(" > ");

  // Validate
  try {
    if (document.querySelector(selector) === el) return selector;
  } catch { /* fall through */ }

  // Fallback: try with more specificity using full nth-child path
  return buildFullNthChildSelector(el);
}

function buildFullNthChildSelector(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current !== document.documentElement) {
    const tag = current.tagName.toLowerCase();
    if (tag === "body" || tag === "html") {
      parts.unshift(tag);
      current = current.parentElement;
      continue;
    }

    const parent = current.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }

    const index = Array.from(parent.children).indexOf(current) + 1;
    parts.unshift(`${tag}:nth-child(${index})`);
    current = parent;
  }

  return parts.join(" > ");
}

function deduplicateSiblings(nodes: SkeletonNode[]): SkeletonNode[] {
  if (nodes.length <= 1) return nodes;

  const groups: { node: SkeletonNode; count: number }[] = [];

  for (const node of nodes) {
    const last = groups[groups.length - 1];
    if (
      last &&
      last.node.type === node.type &&
      last.node.children.length === 0 &&
      node.children.length === 0 &&
      areSimilarPreviews(last.node.textPreview, node.textPreview)
    ) {
      last.count++;
    } else {
      groups.push({ node, count: 1 });
    }
  }

  return groups.map(({ node, count }) => {
    if (count > 1) {
      return {
        ...node,
        textPreview: `\u00d7 repeated ${count}x: ${node.textPreview}`,
      };
    }
    return node;
  });
}

function areSimilarPreviews(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === 0 || b.length === 0) return false;

  // Simple similarity: same length range and same first 20 chars
  const lenRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  if (lenRatio < 0.5) return false;

  const prefixLen = Math.min(20, a.length, b.length);
  return a.slice(0, prefixLen) === b.slice(0, prefixLen);
}

function enforceChildLimit(children: SkeletonNode[]): SkeletonNode[] {
  if (children.length <= MAX_CHILDREN) return children;

  const kept = [
    ...children.slice(0, 20),
    {
      id: `node-${nodeCounter++}`,
      selector: "",
      type: "text" as const,
      textPreview: `... (${children.length - 30} more items)`,
      tag: "synthetic",
      children: [],
    },
    ...children.slice(children.length - 10),
  ];

  return kept;
}

function walkDOM(el: Element | ShadowRoot, depth: number): SkeletonNode[] {
  if (depth > MAX_DEPTH || totalNodes >= MAX_NODES) return [];

  const results: SkeletonNode[] = [];

  for (const child of Array.from(el.children)) {
    if (totalNodes >= MAX_NODES) break;
    if (shouldSkipElement(child)) continue;

    // Recurse into shadow DOM if open
    const shadowRoot = (child as HTMLElement).shadowRoot;
    const childSource = shadowRoot || child;

    const nodeType = classifyElement(child);
    const textPreview = getTextPreview(child);

    // Recurse into children first
    const childNodes = walkDOM(childSource, depth + 1);

    // Skip elements with no text and no meaningful children
    if (textPreview.length === 0 && childNodes.length === 0) continue;

    // Stamp a stable attribute on the element so the selector survives DOM re-renders
    const nodeId = `node-${nodeCounter++}`;
    child.setAttribute("data-pb-node", nodeId);

    // Also capture the nth-child path now, while the DOM is in its extracted state.
    // This becomes the fallback if a JS framework wipes the data-pb-node attribute
    // during hydration / re-render while Gemini is processing.
    const nthChildPath = generateSelector(child);

    // Create the node — use the stable attribute as selector instead of nth-child path
    const node: SkeletonNode = {
      id: nodeId,
      selector: `[data-pb-node="${nodeId}"]`,
      fallbackSelector: nthChildPath !== `[data-pb-node="${nodeId}"]` ? nthChildPath : undefined,
      type: nodeType,
      textPreview,
      tag: child.tagName.toLowerCase(),
      children: enforceChildLimit(deduplicateSiblings(childNodes)),
    };

    // Add optional fields
    const tag = child.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      node.headingLevel = parseInt(tag[1], 10);
    }
    if (tag === "a") {
      node.href = child.getAttribute("href") || undefined;
    }
    if (tag === "img" || child.getAttribute("role") === "img") {
      node.alt = child.getAttribute("alt") || "";
    }

    totalNodes++;
    results.push(node);
  }

  return results;
}

export function extractSkeleton(): PageSkeleton {
  // Reset counters and clear any stale stamps from previous runs
  nodeCounter = 0;
  totalNodes = 0;
  document.querySelectorAll("[data-pb-node]").forEach(el => el.removeAttribute("data-pb-node"));

  const metaDesc = document.querySelector('meta[name="description"]');

  const nodes = walkDOM(document.body, 0);

  return {
    url: window.location.href,
    title: document.title,
    metaDescription: metaDesc?.getAttribute("content") || "",
    nodes: deduplicateSiblings(nodes),
    extractedAt: Date.now(),
  };
}

// Helper utilities for the self-test

function countNodes(nodes: SkeletonNode[]): number {
  let count = nodes.length;
  for (const node of nodes) {
    count += countNodes(node.children);
  }
  return count;
}

function walkNodes(nodes: SkeletonNode[], callback: (node: SkeletonNode) => void): void {
  for (const node of nodes) {
    callback(node);
    walkNodes(node.children, callback);
  }
}

export function testExtractor(): void {
  const skeleton = extractSkeleton();
  console.log("[Predictive Browser] Skeleton extracted:", {
    url: skeleton.url,
    title: skeleton.title,
    nodeCount: countNodes(skeleton.nodes),
    topLevelNodes: skeleton.nodes.length,
    estimatedTokens: JSON.stringify(skeleton).length / 4,
  });
  console.log("[Predictive Browser] Full skeleton:", JSON.stringify(skeleton, null, 2));

  // Validate all selectors resolve
  let brokenSelectors = 0;
  walkNodes(skeleton.nodes, (node) => {
    if (node.selector && !document.querySelector(node.selector)) {
      console.warn(`[Predictive Browser] Broken selector: ${node.selector}`);
      brokenSelectors++;
    }
  });
  console.log(`[Predictive Browser] Selector validation: ${brokenSelectors} broken`);
}
