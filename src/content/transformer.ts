// src/content/transformer.ts — Transform Executor + Animation System
// Framework-aware 3-tier element finding | Variable font sizes | Viewport-filling

import type { TransformResponse, TransformInstruction, PageSkeleton, SkeletonNode, LinkPreview } from '../types/interfaces.js';

// ---------------------------------------------------------------------------
// Framework Detection
// ---------------------------------------------------------------------------

type FrameworkType = 'next' | 'react' | 'vue' | 'angular' | 'vanilla';

function detectFramework(): FrameworkType {
  try {
    const w = window as unknown as Record<string, unknown>;
    if ('__NEXT_DATA__' in w) return 'next';
    if ('__nuxt' in w || '__vue_app__' in w) return 'vue';
    if ('getAllAngularRootElements' in w || !!document.querySelector('[ng-version]')) return 'angular';
    if (!!document.querySelector('[data-reactroot]')) return 'react';
  } catch { /* ignore CSP/cross-origin errors */ }
  return 'vanilla';
}

// ---------------------------------------------------------------------------
// Timing Constants
// ---------------------------------------------------------------------------

const TIMING = {
  STAGGER_DELAY: 20,
  HIGHLIGHT_DURATION: 300,
  COLLAPSE_DURATION: 220,
  REORDER_DURATION: 500,
  ANNOTATE_DURATION: 250,
  DIM_DURATION: 300,
} as const;

// ---------------------------------------------------------------------------
// CSS Injection
// ---------------------------------------------------------------------------

function injectStyles(): void {
  if (document.getElementById('predictive-browser-styles')) return;
  const style = document.createElement('style');
  style.id = 'predictive-browser-styles';
  style.textContent = `
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
      50% { transform: scale(1.006); }
      100% { transform: scale(1); }
    }
    @keyframes pb-slide-in {
      from { opacity: 0; transform: translateY(-6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes pb-slide-in-right {
      from { opacity: 0; transform: translateX(20px); }
      to   { opacity: 1; transform: translateX(0); }
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// SkeletonNode Lookup Maps
// ---------------------------------------------------------------------------

/** Flat map: selector → SkeletonNode (for text-content tier) */
function buildSelectorMap(nodes: SkeletonNode[], map: Map<string, SkeletonNode>): void {
  for (const node of nodes) {
    if (node.selector) map.set(node.selector, node);
    if (node.children.length > 0) buildSelectorMap(node.children, map);
  }
}

/** Flat map: primary selector → fallback nth-child selector */
function buildFallbackMap(nodes: SkeletonNode[], map: Map<string, string>): void {
  for (const node of nodes) {
    if (node.fallbackSelector) map.set(node.selector, node.fallbackSelector);
    if (node.children.length > 0) buildFallbackMap(node.children, map);
  }
}

// ---------------------------------------------------------------------------
// Tier 3 — Text Content Matching
// ---------------------------------------------------------------------------

/**
 * Find an element by text content fingerprint.
 * This is the key technique for React/Next.js where hydration wipes data-pb-node
 * attributes and may also change DOM structure (breaking nth-child paths).
 *
 * Strategy: extract the first 35 chars of textPreview (minus ellipsis) as a
 * fingerprint. Search all elements of the same tag for one whose textContent
 * contains that fingerprint. For containers, also search semantic container tags.
 */
function findByTextContent(node: SkeletonNode): HTMLElement | null {
  // Clean up the preview — strip ellipsis/× prefix markers
  const raw = node.textPreview
    .replace(/\.\.\.$/, '')
    .replace(/…\s*$/, '')
    .replace(/^×\s*repeated \d+x:\s*/, '')
    .trim();

  if (!raw || raw.length < 8) return null;

  // 35 chars is long enough to be unique, short enough to handle truncation
  const fingerprint = raw.slice(0, 35).toLowerCase();

  // --- Pass 1: Search elements of the exact same tag (fastest, most precise) ---
  const exact = Array.from(document.querySelectorAll<HTMLElement>(node.tag)).slice(0, 400);
  for (const el of exact) {
    if (el.dataset.pbTransformed) continue;
    const elText = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 300).toLowerCase();
    if (elText.includes(fingerprint)) return el;
  }

  // --- Pass 2: Broaden to semantic containers for div/section/article types ---
  const containerTags = new Set(['div', 'section', 'article', 'aside', 'main', 'header', 'footer', 'li', 'td', 'tr']);
  if (containerTags.has(node.tag)) {
    const broad = Array.from(document.querySelectorAll<HTMLElement>(
      'section, article, [class*="content"], [class*="post"], [class*="card"], [class*="item"], [class*="block"], [class*="row"]'
    )).slice(0, 250);
    for (const el of broad) {
      if (el.dataset.pbTransformed) continue;
      const elText = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 300).toLowerCase();
      if (elText.includes(fingerprint)) return el;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// 3-Tier Element Finder
// ---------------------------------------------------------------------------

/**
 * Framework-aware element lookup with 3 tiers:
 *
 * Tier 1 — data-pb-node attribute: stamped by extractor. May be wiped by
 *           React hydration (Next.js, CRA) during the ~3s Gemini API call.
 *
 * Tier 2 — nth-child path: captured at extraction time. Reliable for vanilla
 *           and Angular, unreliable for React/Next.js if DOM structure changes.
 *           For Next.js we skip this initially and use it as a final fallback.
 *
 * Tier 3 — Text content fingerprint: survives ALL hydration because text
 *           content is always preserved. Slightly fuzzy but accurate in practice.
 */
function findElement(
  selector: string,
  selectorMap: Map<string, SkeletonNode>,
  fallbackMap: Map<string, string>,
  framework: FrameworkType,
): HTMLElement | null {
  // --- Tier 1 ---
  let el = document.querySelector<HTMLElement>(selector);
  if (el) return el;

  const nodeId = selector.match(/data-pb-node="([^"]+)"/)?.[1];
  const restamp = (found: HTMLElement): HTMLElement => {
    if (nodeId) found.setAttribute('data-pb-node', nodeId);
    return found;
  };

  // --- Tier 2 (skip for Next.js on first attempt — hydration changes structure) ---
  if (framework !== 'next') {
    const fallback = fallbackMap.get(selector);
    if (fallback) {
      el = document.querySelector<HTMLElement>(fallback);
      if (el) return restamp(el);
    }
  }

  // --- Tier 3: text-content fingerprint (most robust for SPA frameworks) ---
  const skeletonNode = selectorMap.get(selector);
  if (skeletonNode) {
    el = findByTextContent(skeletonNode);
    if (el) return restamp(el);
  }

  // --- Tier 2 for Next.js as last resort ---
  if (framework === 'next') {
    const fallback = fallbackMap.get(selector);
    if (fallback) {
      el = document.querySelector<HTMLElement>(fallback);
      if (el) return restamp(el);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Variable Font Scaling
// ---------------------------------------------------------------------------

/**
 * Scale up font size of high-relevance elements.
 * Only applies to text-bearing elements (headings, paragraphs, list items, etc.)
 * to create a visual hierarchy that matches the relevance score.
 *
 * relevance ≥ 92 → 1.28×  (prominent, large)
 * relevance ≥ 80 → 1.15×
 * relevance ≥ 65 → 1.06×
 */
function scaleFontSize(el: HTMLElement, relevance: number): void {
  if (relevance < 65) return;

  const tag = el.tagName.toLowerCase();
  const isTextNode = /^(p|h[1-6]|span|li|td|blockquote|cite|figcaption|label|dt|dd)$/.test(tag);
  const hasDirectText = Array.from(el.childNodes).some(
    n => n.nodeType === Node.TEXT_NODE && (n.textContent?.trim().length ?? 0) > 0
  );
  if (!isTextNode && !hasDirectText) return;

  const baseSize = parseFloat(getComputedStyle(el).fontSize) || 16;
  let multiplier = 1;
  if (relevance >= 92) multiplier = 1.28;
  else if (relevance >= 80) multiplier = 1.15;
  else if (relevance >= 65) multiplier = 1.06;
  if (multiplier === 1) return;

  el.dataset.pbOriginalFontSize = el.style.fontSize;
  el.dataset.pbOriginalLineHeight = el.style.lineHeight;
  el.style.fontSize = `${(baseSize * multiplier).toFixed(1)}px`;
  el.style.lineHeight = '1.5';
  el.style.transition = `font-size ${TIMING.HIGHLIGHT_DURATION}ms ease`;
}

// ---------------------------------------------------------------------------
// Transform Executors
// ---------------------------------------------------------------------------

function executeHighlight(el: HTMLElement, instruction: TransformInstruction, accent: string): void {
  el.dataset.pbOriginalBorder = el.style.borderLeft;
  el.dataset.pbOriginalBg = el.style.backgroundColor;
  el.dataset.pbOriginalPadding = el.style.paddingLeft;

  // Use site's own accent colour for highlight border/bg (blends naturally)
  const bgRgba = toRgba(accent, 0.06);

  el.style.transition = `all ${TIMING.HIGHLIGHT_DURATION}ms ease`;
  requestAnimationFrame(() => {
    el.style.borderLeft = `3px solid ${accent}`;
    el.style.backgroundColor = bgRgba;
    el.style.paddingLeft = (parseInt(getComputedStyle(el).paddingLeft) + 8) + 'px';
    el.style.borderRadius = '3px';
    el.style.animation = 'pb-pulse 400ms ease';
  });

  scaleFontSize(el, instruction.relevance);
}

function executeCollapse(el: HTMLElement, _instruction: TransformInstruction): void {
  el.dataset.pbOriginalHeight = el.offsetHeight + 'px';
  el.dataset.pbOriginalOverflow = el.style.overflow;
  el.dataset.pbOriginalMaxHeight = el.style.maxHeight;

  const height = el.offsetHeight;
  const duration = height > 2000 ? 280 : TIMING.COLLAPSE_DURATION;

  el.style.maxHeight = height + 'px';
  el.style.overflow = 'hidden';
  el.style.transition = `max-height ${duration}ms ease-out, opacity ${duration}ms ease-out`;

  requestAnimationFrame(() => {
    el.style.maxHeight = '0px';
    el.style.opacity = '0';
  });

  setTimeout(() => {
    el.style.display = 'none';
    el.dataset.pbCollapsed = 'true';
  }, duration);
}

function executeReorder(el: HTMLElement, instruction: TransformInstruction): void {
  const parent = el.parentElement;
  if (!parent) return;

  const pos = getComputedStyle(el).position;
  if (pos === 'fixed' || pos === 'sticky') {
    console.warn('[Predictive Browser] Skipping reorder on fixed/sticky element:', instruction.selector);
    return;
  }

  // FLIP animation
  const startRect = el.getBoundingClientRect();

  if (instruction.position === 'top') {
    parent.insertBefore(el, parent.firstElementChild);
  } else if (instruction.position?.startsWith('above:')) {
    const targetSel = instruction.position.replace('above:', '');
    const targetEl = document.querySelector(targetSel);
    if (targetEl?.parentElement) {
      targetEl.parentElement.insertBefore(el, targetEl);
    }
  }

  const endRect = el.getBoundingClientRect();
  const dy = startRect.top - endRect.top;
  const dx = startRect.left - endRect.left;

  el.style.transform = `translate(${dx}px, ${dy}px)`;
  el.style.opacity = '0.5';
  el.style.transition = 'none';

  requestAnimationFrame(() => {
    el.style.transition = `transform ${TIMING.REORDER_DURATION}ms cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity ${TIMING.REORDER_DURATION / 2}ms ease`;
    el.style.transform = 'translate(0, 0)';
    el.style.opacity = '1';
  });

  setTimeout(() => {
    el.style.transform = '';
    el.style.transition = '';
  }, TIMING.REORDER_DURATION + 60);
}

function executeAnnotate(el: HTMLElement, instruction: TransformInstruction): void {
  if (!instruction.annotation) return;

  const badgeClass = (instruction as TransformInstruction & { badgeClass?: string }).badgeClass ?? 'pb-annotation-badge';
  const badge = document.createElement('div');
  badge.className = badgeClass;
  badge.textContent = instruction.annotation;
  badge.style.cssText = `opacity: 0; transform: translateY(-4px); transition: opacity ${TIMING.ANNOTATE_DURATION}ms ease, transform ${TIMING.ANNOTATE_DURATION}ms ease;`;

  el.parentElement?.insertBefore(badge, el);

  requestAnimationFrame(() => {
    badge.style.opacity = '1';
    badge.style.transform = 'translateY(0)';
  });
}

function executeDim(el: HTMLElement, _instruction: TransformInstruction): void {
  el.dataset.pbOriginalOpacity = el.style.opacity;
  el.dataset.pbOriginalPointerEvents = el.style.pointerEvents;

  el.style.transition = `opacity ${TIMING.DIM_DURATION}ms ease`;
  requestAnimationFrame(() => {
    el.style.opacity = '0.12';
    el.style.pointerEvents = 'none';
  });
}

// ---------------------------------------------------------------------------
// Site Style Extraction
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

function resolveBackground(start: Element): string {
  let el: Element | null = start;
  while (el) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
    el = el.parentElement;
  }
  return '#ffffff';
}

function toRgba(color: string, alpha: number): string {
  if (color.startsWith('rgba(')) {
    return color.replace(/,\s*[\d.]+\)$/, `, ${alpha})`);
  }
  if (color.startsWith('rgb(')) {
    return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  }
  // hex: #rrggbb or #rgb
  const full = color.length === 4
    ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
    : color;
  const r = parseInt(full.slice(1, 3), 16);
  const g = parseInt(full.slice(3, 5), 16);
  const b = parseInt(full.slice(5, 7), 16);
  if (isNaN(r)) return `rgba(74, 144, 217, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getSiteStyle() {
  const content = document.querySelector("main, [role='main'], article, #content, .content") ?? document.body;
  const heading = document.querySelector('h1, h2, h3') ?? content;

  const fontFamily =
    getComputedStyle(heading).fontFamily ||
    getComputedStyle(content).fontFamily ||
    '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  const bgColor = resolveBackground(content);
  const isDark = isColorDark(bgColor);
  const textColor = getComputedStyle(content).color || (isDark ? '#ffffff' : '#111111');

  const linkEl = document.querySelector('a');
  const linkColor = linkEl ? getComputedStyle(linkEl).color : null;
  // Use link colour as accent — it's already the site's brand colour
  const accent = (linkColor && parseLuminance(linkColor) !== null) ? linkColor : '#6366f1';

  return { fontFamily, isDark, textColor, accent, bgColor };
}

// ---------------------------------------------------------------------------
// Rich Digest Panel — right-side panel with intent, key items, links, summary
// ---------------------------------------------------------------------------

/** Clickable link card for the "Further links" section. */
function buildLinkItem(
  href: string,
  title: string,
  summary: string,
  accent: string,
  borderColor: string,
  mutedColor: string,
  cardBg: string,
): HTMLElement {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.style.cssText = `
    display: block; text-decoration: none;
    padding: 10px 12px; margin-bottom: 8px;
    background: ${cardBg}; border: 1px solid ${borderColor};
    border-radius: 6px; transition: background 0.15s; cursor: pointer;
  `;
  a.onmouseenter = () => { a.style.background = toRgba(accent, 0.07); };
  a.onmouseleave = () => { a.style.background = cardBg; };

  const titleEl = document.createElement('div');
  titleEl.style.cssText = `
    font-size: 13px; font-weight: 600; color: ${accent};
    margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  `;
  titleEl.textContent = title.length > 65 ? title.slice(0, 62) + '\u2026' : title;

  const summaryEl = document.createElement('div');
  summaryEl.style.cssText = `
    font-size: 11px; color: ${mutedColor}; line-height: 1.45;
    display: -webkit-box; -webkit-line-clamp: 2;
    -webkit-box-orient: vertical; overflow: hidden;
  `;
  summaryEl.textContent = summary;

  a.appendChild(titleEl);
  a.appendChild(summaryEl);
  return a;
}

/**
 * Update the "Further links" panel section with real link previews (second pass).
 * Called from index.ts when LINK_PREVIEWS_READY arrives.
 */
export function updatePanelWithLinkPreviews(previews: LinkPreview[]): void {
  const list = document.getElementById('pb-further-links-list');
  if (!list) return;

  const colors = (window as unknown as Record<string, unknown>).__pbPanelColors as
    { accent: string; borderColor: string; mutedColor: string; cardBg: string } | undefined;
  if (!colors) return;

  list.innerHTML = '';

  const relevant = previews
    .filter(p => p.relevance >= 40)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 6);

  if (relevant.length === 0) {
    document.getElementById('pb-further-links-section')?.remove();
    return;
  }

  for (const p of relevant) {
    list.appendChild(buildLinkItem(
      p.href, p.title || p.href, p.summary,
      colors.accent, colors.borderColor, colors.mutedColor, colors.cardBg,
    ));
  }
}

function injectDigestPanel(
  response: TransformResponse,
  selectorMap: Map<string, SkeletonNode>,
  _skeleton?: PageSkeleton,
): void {
  document.getElementById('pb-digest')?.remove();

  const { fontFamily, isDark, accent } = getSiteStyle();
  const panelBg     = isDark ? 'rgba(8,8,16,0.97)'     : 'rgba(252,252,254,0.97)';
  const panelText   = isDark ? '#e8e8f0'                : '#111120';
  const borderColor = toRgba(accent, 0.18);
  const mutedColor  = isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.38)';
  const bodyMuted   = isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.62)';
  const cardBg      = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)';
  const headerBg    = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';

  const highlights = response.transforms
    .filter(t => t.action === 'highlight')
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 5);

  const annotatedLinks = response.transforms
    .filter(t => t.action === 'annotate')
    .map(t => ({ t, node: selectorMap.get(t.selector) }))
    .filter(({ node }) => !!node?.href)
    .slice(0, 6);

  // ── Panel shell ─────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = 'pb-digest';
  panel.style.cssText = `
    position: fixed; top: 28px; right: 0;
    width: 360px; height: calc(100vh - 28px);
    background: ${panelBg};
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    border-left: 1px solid ${borderColor};
    box-shadow: -8px 0 32px rgba(0,0,0,${isDark ? '0.55' : '0.10'});
    z-index: 2147483646; overflow-y: auto; overflow-x: hidden;
    font-family: ${fontFamily}; color: ${panelText};
    box-sizing: border-box; display: flex; flex-direction: column;
    animation: pb-slide-in-right 300ms cubic-bezier(0.25,0.46,0.45,0.94) forwards;
  `;

  // ── Header ───────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.style.cssText = `
    padding: 14px 40px 12px 14px; background: ${headerBg};
    border-bottom: 1px solid ${borderColor};
    position: sticky; top: 0; z-index: 2;
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  `;

  const intentLabel = document.createElement('div');
  intentLabel.style.cssText = `
    font-size: 9px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.1em; color: ${accent}; margin-bottom: 5px;
  `;
  intentLabel.textContent = '\u26A1 Predictive Browser';

  const intentText = document.createElement('div');
  intentText.style.cssText = `font-size: 13px; font-weight: 600; line-height: 1.4; color: ${panelText};`;
  intentText.textContent = response.inferredIntent;

  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  closeBtn.title = 'Dismiss';
  closeBtn.style.cssText = `
    position: absolute; top: 12px; right: 12px;
    background: none; border: none; cursor: pointer;
    font-size: 17px; line-height: 1; padding: 2px 5px;
    color: ${mutedColor}; transition: color 0.15s; border-radius: 4px;
  `;
  closeBtn.onmouseenter = () => { closeBtn.style.color = panelText; };
  closeBtn.onmouseleave = () => { closeBtn.style.color = mutedColor; };
  closeBtn.onclick = () => panel.remove();

  header.appendChild(intentLabel);
  header.appendChild(intentText);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // ── Section factory ──────────────────────────────────────────────────────
  const makeSec = (label: string, id?: string): HTMLDivElement => {
    const sec = document.createElement('div');
    sec.style.cssText = `padding: 14px 14px 16px; border-bottom: 1px solid ${borderColor};`;
    if (id) sec.id = id;
    const lbl = document.createElement('div');
    lbl.style.cssText = `
      font-size: 9px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.1em; color: ${mutedColor}; margin-bottom: 10px;
    `;
    lbl.textContent = label;
    sec.appendChild(lbl);
    return sec;
  };

  // ── What matters for your search ────────────────────────────────────────
  if (highlights.length > 0) {
    const sec = makeSec(`What matters for your search\u2002(${highlights.length})`);

    for (const t of highlights) {
      const node = selectorMap.get(t.selector);
      const raw = (node?.textPreview ?? t.annotation ?? t.reason ?? '').trim();
      // Smart word-boundary truncation
      const preview = raw.length > 110
        ? (raw.slice(0, 107).replace(/\s\S*$/, '') || raw.slice(0, 107)) + '\u2026'
        : raw;

      const card = document.createElement('div');
      card.style.cssText = `
        position: relative;
        background: ${cardBg}; border: 1px solid ${borderColor};
        border-left: 3px solid ${accent}; border-radius: 6px;
        padding: 10px 12px 10px 12px; margin-bottom: 8px;
        cursor: pointer; transition: background 0.15s;
      `;
      card.onmouseenter = () => {
        card.style.background = toRgba(accent, 0.07);
        jumpHint.style.opacity = '1';
      };
      card.onmouseleave = () => {
        card.style.background = cardBg;
        jumpHint.style.opacity = '0';
      };
      card.onclick = () => {
        const el = document.querySelector<HTMLElement>(t.selector);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const prevOutline = el.style.outline;
        const prevOffset  = el.style.outlineOffset;
        el.style.outline = `2px solid ${accent}`;
        el.style.outlineOffset = '3px';
        setTimeout(() => { el.style.outline = prevOutline; el.style.outlineOffset = prevOffset; }, 1800);
      };

      // "Jump ↗" hint — appears on hover
      const jumpHint = document.createElement('div');
      jumpHint.textContent = 'Jump \u2197';
      jumpHint.style.cssText = `
        position: absolute; top: 10px; right: 10px;
        font-size: 10px; font-weight: 600; color: ${accent};
        opacity: 0; transition: opacity 0.15s; pointer-events: none;
        letter-spacing: 0.02em;
      `;

      const snippet = document.createElement('div');
      snippet.style.cssText = `
        font-size: 13.5px; font-weight: 500; line-height: 1.5;
        color: ${panelText}; margin-bottom: 5px; padding-right: 42px;
        letter-spacing: -0.01em;
      `;
      snippet.textContent = preview;

      const reason = document.createElement('div');
      reason.style.cssText = `
        font-size: 11px; color: ${toRgba(accent, 0.7)}; line-height: 1.4;
      `;
      reason.textContent = '\u2192 ' + t.reason;

      // Relevance bar + percentage
      const barRow = document.createElement('div');
      barRow.style.cssText = `display: flex; align-items: center; gap: 6px; margin-top: 8px;`;

      const barTrack = document.createElement('div');
      barTrack.style.cssText = `
        flex: 1; height: 2px; background: ${toRgba(accent, 0.12)};
        border-radius: 1px; overflow: hidden;
      `;
      const barFill = document.createElement('div');
      barFill.style.cssText = `
        height: 100%; width: 0; background: ${accent};
        border-radius: 1px; transition: width 700ms ease 200ms;
      `;
      barTrack.appendChild(barFill);
      setTimeout(() => { barFill.style.width = `${t.relevance}%`; }, 60);

      const pctLabel = document.createElement('div');
      pctLabel.style.cssText = `font-size: 10px; color: ${mutedColor}; flex-shrink: 0;`;
      pctLabel.textContent = `${t.relevance}%`;

      barRow.appendChild(barTrack);
      barRow.appendChild(pctLabel);

      card.appendChild(jumpHint);
      card.appendChild(snippet);
      card.appendChild(reason);
      card.appendChild(barRow);
      sec.appendChild(card);
    }
    panel.appendChild(sec);
  }

  // ── Page summary ─────────────────────────────────────────────────────────
  const digestText = response.digest ?? response.summary;
  if (digestText) {
    const sec = makeSec('Page summary');
    const txt = document.createElement('div');
    txt.style.cssText = `
      font-size: 13px; line-height: 1.7; color: ${bodyMuted};
      border-left: 2px solid ${toRgba(accent, 0.25)};
      padding-left: 10px; margin-top: 2px;
    `;
    txt.textContent = digestText;
    sec.appendChild(txt);
    panel.appendChild(sec);
  }

  // ── Further links ────────────────────────────────────────────────────────
  const linksSec = makeSec('Further links', 'pb-further-links-section');
  linksSec.style.flex = '1';
  linksSec.style.borderBottom = 'none';

  const linksList = document.createElement('div');
  linksList.id = 'pb-further-links-list';

  if (annotatedLinks.length > 0) {
    for (const { t, node } of annotatedLinks) {
      linksList.appendChild(buildLinkItem(
        node!.href!, node!.textPreview, t.annotation ?? t.reason,
        accent, borderColor, mutedColor, cardBg,
      ));
    }
  } else {
    const ph = document.createElement('div');
    ph.style.cssText = `font-size: 12px; color: ${mutedColor}; font-style: italic;`;
    ph.textContent = 'Analyzing page links\u2026';
    linksList.appendChild(ph);
  }

  linksSec.appendChild(linksList);
  panel.appendChild(linksSec);

  // Persist colors so the link-preview update pass can reuse them
  (window as unknown as Record<string, unknown>).__pbPanelColors = {
    accent, borderColor, mutedColor, cardBg,
  };

  document.body.appendChild(panel);
}

// ---------------------------------------------------------------------------
// Ancestor-Collapse Check
// ---------------------------------------------------------------------------

/** True if the element is inside an already-collapsed ancestor (skip it) */
function hasCollapsedAncestor(el: HTMLElement): boolean {
  let p = el.parentElement;
  while (p) {
    if (p.dataset.pbCollapsed === 'true') return true;
    p = p.parentElement;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main Orchestrator
// ---------------------------------------------------------------------------

export async function applyTransforms(response: TransformResponse, skeleton?: PageSkeleton): Promise<void> {
  injectStyles();

  // Read user setting: collapse dimmed elements entirely, or just grey them
  let removeGrayedSections = true;
  try {
    const stored = await chrome.storage.local.get('extensionSettings');
    removeGrayedSections = stored['extensionSettings']?.removeGrayedSections ?? true;
  } catch { /* use default */ }

  const framework = detectFramework();
  console.log(`[Predictive Browser] Framework: ${framework}`);

  // Build lookup maps from skeleton nodes
  const selectorMap = new Map<string, SkeletonNode>();
  const fallbackMap = new Map<string, string>();
  if (skeleton) {
    buildSelectorMap(skeleton.nodes, selectorMap);
    buildFallbackMap(skeleton.nodes, fallbackMap);
  }

  // Read site style once (used for accent color in highlights)
  const { accent } = getSiteStyle();

  // Separate positive transforms (reorder/highlight) from negative (collapse/dim)
  // Process positive ones first so they're not accidentally collapsed
  const positiveActions = new Set<string>(['reorder', 'highlight', 'annotate']);
  const sorted = [...response.transforms].sort((a, b) => {
    const aPriority = positiveActions.has(a.action) ? 1 : 0;
    const bPriority = positiveActions.has(b.action) ? 1 : 0;
    if (aPriority !== bPriority) return bPriority - aPriority;
    return b.relevance - a.relevance; // then by relevance within each group
  });

  let found = 0;
  let missed = 0;

  for (const instruction of sorted) {
    const el = findElement(instruction.selector, selectorMap, fallbackMap, framework);

    if (!el) {
      console.warn(`[Predictive Browser] [${framework}] Not found: ${instruction.selector}`);
      missed++;
      continue;
    }

    // Skip already-transformed and elements inside collapsed ancestors
    if (el.dataset.pbTransformed) continue;
    if (hasCollapsedAncestor(el)) continue;

    await delay(TIMING.STAGGER_DELAY);

    el.dataset.pbTransformed = 'true';

    switch (instruction.action) {
      case 'highlight': executeHighlight(el, instruction, accent); break;
      case 'collapse':  executeCollapse(el, instruction);          break;
      case 'reorder':   executeReorder(el, instruction);           break;
      case 'annotate':  /* data used by panel only — no DOM badge injected */ break;
      case 'dim':
        if (removeGrayedSections) {
          executeCollapse(el, instruction); // fully remove
        } else {
          executeDim(el, instruction);      // just grey
        }
        break;
    }

    found++;
  }

  console.log(`[Predictive Browser] Applied ${found} transforms, missed ${missed} (${framework})`);

  // Show digest panel only on primary passes (where we have an inferred intent)
  if (found > 0 && response.inferredIntent) {
    injectDigestPanel(response, selectorMap, skeleton);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Self-Test
// ---------------------------------------------------------------------------

export async function testTransformer(): Promise<void> {
  const firstH1   = document.querySelector('h1');
  const firstNav  = document.querySelector('nav');
  const firstLink = document.querySelector('a[href]');

  const mockResponse: TransformResponse = {
    transforms: [],
    summary: 'Test: Highlighted headings, dimmed navigation, annotated first link.',
    inferredIntent: 'Testing transform executor',
  };

  if (firstH1) {
    mockResponse.transforms.push({
      action: 'highlight',
      selector: getTestSelector(firstH1),
      reason: 'Test highlight',
      relevance: 95,
    });
  }

  if (firstNav) {
    mockResponse.transforms.push({
      action: 'dim',
      selector: getTestSelector(firstNav),
      reason: 'Test dim',
      relevance: 20,
    });
  }

  if (firstLink) {
    mockResponse.transforms.push({
      action: 'annotate',
      selector: getTestSelector(firstLink),
      reason: 'Test annotation',
      relevance: 70,
      annotation: '\u2605 Test badge',
    });
  }

  console.log('[Predictive Browser] Running transformer test with', mockResponse.transforms.length, 'transforms');
  await applyTransforms(mockResponse);
  console.log('[Predictive Browser] Transformer test complete!');
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
  return 'body > ' + path.join(' > ');
}

// ---------------------------------------------------------------------------
// Cleanup (for SPA re-runs and extension disable)
// ---------------------------------------------------------------------------

export function cleanupTransforms(): void {
  document.querySelectorAll('.pb-annotation-badge, .pb-link-preview-badge').forEach(el => el.remove());
  document.getElementById('pb-digest')?.remove();

  document.querySelectorAll<HTMLElement>('[data-pb-transformed], [data-pb-collapsed]').forEach(el => {
    if (el.dataset.pbOriginalBorder !== undefined)       el.style.borderLeft       = el.dataset.pbOriginalBorder;
    if (el.dataset.pbOriginalBg !== undefined)           el.style.backgroundColor  = el.dataset.pbOriginalBg;
    if (el.dataset.pbOriginalPadding !== undefined)      el.style.paddingLeft      = el.dataset.pbOriginalPadding;
    if (el.dataset.pbOriginalOpacity !== undefined)      el.style.opacity          = el.dataset.pbOriginalOpacity;
    if (el.dataset.pbOriginalPointerEvents !== undefined) el.style.pointerEvents   = el.dataset.pbOriginalPointerEvents;
    if (el.dataset.pbOriginalFontSize !== undefined)     el.style.fontSize         = el.dataset.pbOriginalFontSize;
    if (el.dataset.pbOriginalLineHeight !== undefined)   el.style.lineHeight       = el.dataset.pbOriginalLineHeight;
    if (el.dataset.pbOriginalMaxHeight !== undefined) {
      el.style.maxHeight  = el.dataset.pbOriginalMaxHeight;
      el.style.overflow   = el.dataset.pbOriginalOverflow ?? '';
      el.style.display    = '';
      el.style.opacity    = '';
    }

    // Remove all pb- data attributes
    for (const key of Object.keys(el.dataset)) {
      if (key.startsWith('pb')) delete el.dataset[key];
    }
  });

  // Remove stable node stamps added by extractor
  document.querySelectorAll('[data-pb-node]').forEach(el => el.removeAttribute('data-pb-node'));
}
