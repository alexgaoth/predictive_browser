"use strict";
(() => {
  // src/content/extractor.ts
  var MAX_NODES = 150;
  var MAX_DEPTH = 6;
  var MAX_CHILDREN = 30;
  var TEXT_PREVIEW_LENGTH = 80;
  var SKIP_TAGS = /* @__PURE__ */ new Set([
    "script",
    "style",
    "noscript",
    "template",
    "iframe"
  ]);
  var AD_PATTERNS = [
    "ad-",
    "adsbygoogle",
    "cookie-banner",
    "consent",
    "ad_",
    "ads-",
    "advertisement",
    "cookie-consent",
    "gdpr",
    "cookie-notice"
  ];
  var nodeCounter = 0;
  var totalNodes = 0;
  function classifyElement(el) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role");
    if (/^h[1-6]$/.test(tag))
      return "heading";
    if (tag === "nav" || role === "navigation")
      return "nav";
    if (["section", "article", "main", "aside"].includes(tag) || role === "main" || role === "region")
      return "section";
    if (tag === "a" && el.hasAttribute("href"))
      return "link";
    if (["img", "picture", "svg"].includes(tag) || role === "img")
      return "image";
    if (["ul", "ol"].includes(tag) || role === "list")
      return "list";
    if (tag === "form" || role === "form")
      return "form";
    if (["p", "span", "div"].includes(tag)) {
      const text2 = getTextPreview(el);
      if (text2.length > 0)
        return "text";
    }
    const text = getTextPreview(el);
    if (text.length > 0)
      return "unknown";
    return "unknown";
  }
  function getTextPreview(el) {
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
  function isHidden(el) {
    const htmlEl = el;
    if (htmlEl.offsetWidth === 0 && htmlEl.offsetHeight === 0)
      return true;
    try {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden")
        return true;
    } catch {
    }
    return false;
  }
  function isAdOrCookieBanner(el) {
    const className = (el.className || "").toString().toLowerCase();
    const id = (el.id || "").toLowerCase();
    const combined = className + " " + id;
    return AD_PATTERNS.some((pattern) => combined.includes(pattern));
  }
  function shouldSkipElement(el) {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag))
      return true;
    if (tag === "svg" && el.getAttribute("role") !== "img")
      return true;
    if (isHidden(el))
      return true;
    if (isAdOrCookieBanner(el))
      return true;
    return false;
  }
  function generateSelector(el) {
    if (el.id) {
      const sel = `#${CSS.escape(el.id)}`;
      try {
        if (document.querySelector(sel) === el)
          return sel;
      } catch {
      }
    }
    const testId = el.getAttribute("data-testid");
    if (testId) {
      const sel = `[data-testid="${CSS.escape(testId)}"]`;
      try {
        if (document.querySelector(sel) === el)
          return sel;
      } catch {
      }
    }
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) {
      const sel = `[aria-label="${CSS.escape(ariaLabel)}"]`;
      try {
        if (document.querySelector(sel) === el)
          return sel;
      } catch {
      }
    }
    return buildPositionalSelector(el);
  }
  function buildPositionalSelector(el) {
    const parts = [];
    let current = el;
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
      const sameTagSiblings = siblings.filter((s) => s.tagName === current.tagName);
      if (sameTagSiblings.length === 1) {
        parts.unshift(tag);
      } else {
        const index = siblings.indexOf(current) + 1;
        parts.unshift(`${tag}:nth-child(${index})`);
      }
      current = parent;
    }
    const selector = parts.join(" > ");
    try {
      if (document.querySelector(selector) === el)
        return selector;
    } catch {
    }
    return buildFullNthChildSelector(el);
  }
  function buildFullNthChildSelector(el) {
    const parts = [];
    let current = el;
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
  function deduplicateSiblings(nodes) {
    if (nodes.length <= 1)
      return nodes;
    const groups = [];
    for (const node of nodes) {
      const last = groups[groups.length - 1];
      if (last && last.node.type === node.type && last.node.children.length === 0 && node.children.length === 0 && areSimilarPreviews(last.node.textPreview, node.textPreview)) {
        last.count++;
      } else {
        groups.push({ node, count: 1 });
      }
    }
    return groups.map(({ node, count }) => {
      if (count > 1) {
        return {
          ...node,
          textPreview: `\xD7 repeated ${count}x: ${node.textPreview}`
        };
      }
      return node;
    });
  }
  function areSimilarPreviews(a, b) {
    if (a === b)
      return true;
    if (a.length === 0 || b.length === 0)
      return false;
    const lenRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    if (lenRatio < 0.5)
      return false;
    const prefixLen = Math.min(20, a.length, b.length);
    return a.slice(0, prefixLen) === b.slice(0, prefixLen);
  }
  function enforceChildLimit(children) {
    if (children.length <= MAX_CHILDREN)
      return children;
    const kept = [
      ...children.slice(0, 20),
      {
        id: `node-${nodeCounter++}`,
        selector: "",
        type: "text",
        textPreview: `... (${children.length - 30} more items)`,
        tag: "synthetic",
        children: []
      },
      ...children.slice(children.length - 10)
    ];
    return kept;
  }
  function walkDOM(el, depth) {
    if (depth > MAX_DEPTH || totalNodes >= MAX_NODES)
      return [];
    const results = [];
    for (const child of Array.from(el.children)) {
      if (totalNodes >= MAX_NODES)
        break;
      if (shouldSkipElement(child))
        continue;
      const shadowRoot = child.shadowRoot;
      const childSource = shadowRoot || child;
      const nodeType = classifyElement(child);
      const textPreview = getTextPreview(child);
      const childNodes = walkDOM(childSource, depth + 1);
      if (textPreview.length === 0 && childNodes.length === 0)
        continue;
      const node = {
        id: `node-${nodeCounter++}`,
        selector: generateSelector(child),
        type: nodeType,
        textPreview,
        tag: child.tagName.toLowerCase(),
        children: enforceChildLimit(deduplicateSiblings(childNodes))
      };
      const tag = child.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        node.headingLevel = parseInt(tag[1], 10);
      }
      if (tag === "a") {
        node.href = child.getAttribute("href") || void 0;
      }
      if (tag === "img" || child.getAttribute("role") === "img") {
        node.alt = child.getAttribute("alt") || "";
      }
      totalNodes++;
      results.push(node);
    }
    return results;
  }
  function extractSkeleton() {
    nodeCounter = 0;
    totalNodes = 0;
    const metaDesc = document.querySelector('meta[name="description"]');
    const nodes = walkDOM(document.body, 0);
    return {
      url: window.location.href,
      title: document.title,
      metaDescription: metaDesc?.getAttribute("content") || "",
      nodes: deduplicateSiblings(nodes),
      extractedAt: Date.now()
    };
  }

  // src/content/transformer.ts
  var TIMING = {
    STAGGER_DELAY: 80,
    HIGHLIGHT_DURATION: 400,
    COLLAPSE_DURATION: 500,
    REORDER_DURATION: 600,
    ANNOTATE_DURATION: 300,
    DIM_DURATION: 400,
    TOAST_DURATION: 3e3
  };
  function injectStyles() {
    if (document.getElementById("predictive-browser-styles"))
      return;
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

    @keyframes pb-pulse {
      0% { transform: scale(1); }
      50% { transform: scale(1.005); }
      100% { transform: scale(1); }
    }
  `;
    document.head.appendChild(style);
  }
  function executeHighlight(el, _instruction) {
    el.dataset.pbOriginalBorder = el.style.borderLeft;
    el.dataset.pbOriginalBg = el.style.backgroundColor;
    el.dataset.pbOriginalPadding = el.style.paddingLeft;
    el.style.transition = `all ${TIMING.HIGHLIGHT_DURATION}ms ease`;
    requestAnimationFrame(() => {
      el.style.borderLeft = "3px solid #4A90D9";
      el.style.backgroundColor = "rgba(74, 144, 217, 0.05)";
      el.style.paddingLeft = parseInt(getComputedStyle(el).paddingLeft) + 8 + "px";
      el.style.borderRadius = "2px";
      el.style.animation = "pb-pulse 400ms ease";
    });
  }
  function executeCollapse(el, _instruction) {
    el.dataset.pbOriginalDisplay = getComputedStyle(el).display;
    el.dataset.pbOriginalHeight = el.offsetHeight + "px";
    el.dataset.pbOriginalOverflow = el.style.overflow;
    const height = el.offsetHeight;
    const duration = height > 2e3 ? 300 : TIMING.COLLAPSE_DURATION;
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
  function executeReorder(el, instruction) {
    const parent = el.parentElement;
    if (!parent)
      return;
    const position = getComputedStyle(el).position;
    if (position === "fixed" || position === "sticky") {
      console.warn("[Predictive Browser] Skipping reorder on fixed/sticky element:", instruction.selector);
      return;
    }
    const startRect = el.getBoundingClientRect();
    if (instruction.position === "top") {
      parent.insertBefore(el, parent.firstElementChild);
    } else if (instruction.position?.startsWith("above:")) {
      const targetSelector = instruction.position.replace("above:", "");
      const targetEl = document.querySelector(targetSelector);
      if (targetEl && targetEl.parentElement) {
        targetEl.parentElement.insertBefore(el, targetEl);
      }
    }
    const endRect = el.getBoundingClientRect();
    const deltaY = startRect.top - endRect.top;
    const deltaX = startRect.left - endRect.left;
    el.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    el.style.opacity = "0.6";
    el.style.transition = "none";
    requestAnimationFrame(() => {
      el.style.transition = `transform ${TIMING.REORDER_DURATION}ms cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity ${TIMING.REORDER_DURATION / 2}ms ease`;
      el.style.transform = "translate(0, 0)";
      el.style.opacity = "1";
    });
    setTimeout(() => {
      el.style.transform = "";
      el.style.transition = "";
    }, TIMING.REORDER_DURATION + 50);
  }
  function executeAnnotate(el, instruction) {
    if (!instruction.annotation)
      return;
    const badge = document.createElement("div");
    badge.className = "pb-annotation-badge";
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
  function executeDim(el, _instruction) {
    el.dataset.pbOriginalOpacity = el.style.opacity;
    el.dataset.pbOriginalFilter = el.style.filter;
    el.style.transition = `opacity ${TIMING.DIM_DURATION}ms ease, filter ${TIMING.DIM_DURATION}ms ease`;
    requestAnimationFrame(() => {
      el.style.opacity = "0.4";
      el.style.filter = "grayscale(30%)";
    });
  }
  async function applyTransforms(response) {
    injectStyles();
    const sorted = [...response.transforms].sort((a, b) => b.relevance - a.relevance);
    for (let i = 0; i < sorted.length; i++) {
      const instruction = sorted[i];
      const el = document.querySelector(instruction.selector);
      if (!el) {
        console.warn(`[Predictive Browser] Selector not found: ${instruction.selector}`);
        continue;
      }
      if (el.dataset.pbTransformed) {
        console.warn(`[Predictive Browser] Element already transformed: ${instruction.selector}`);
        continue;
      }
      await delay(TIMING.STAGGER_DELAY);
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
    if (response.summary && response.transforms.length > 0) {
      showToast(response.summary, response.inferredIntent);
    }
  }
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function showToast(summary, intent) {
    document.getElementById("pb-toast")?.remove();
    const toast = document.createElement("div");
    toast.id = "pb-toast";
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

  // src/content/index.ts
  async function main() {
    await waitForDomStable();
    const skeleton = extractSkeleton();
    if (skeleton.nodes.length === 0) {
      console.log("[Predictive Browser] Empty page, skipping.");
      return;
    }
    try {
      const response = await chrome.runtime.sendMessage({
        type: "SKELETON_READY",
        payload: skeleton
      });
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
  function waitForDomStable() {
    return new Promise((resolve) => {
      let timeout;
      const observer = new MutationObserver(() => {
        clearTimeout(timeout);
        timeout = window.setTimeout(() => {
          observer.disconnect();
          resolve();
        }, 500);
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
      setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 3e3);
      timeout = window.setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 500);
    });
  }
  main().catch(console.error);
})();
