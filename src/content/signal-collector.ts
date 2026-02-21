// src/content/signal-collector.ts
// Lightweight content script module: engagement tracking, scroll depth,
// dwell time, and referrer/search query extraction.

import type {
  TransformAction,
  EngagementSignal,
  PageVisitSignal,
} from '../types/interfaces.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOVER_THRESHOLD_MS = 2000;
const SCROLL_THROTTLE_MS = 2000;
const SEARCH_PARAMS = ['q', 'query', 'search_query', 'p'];
const SEARCH_DOMAINS = [
  'google.', 'bing.com', 'duckduckgo.com', 'yahoo.com',
  'baidu.com', 'yandex.', 'ecosia.org', 'brave.com',
];

// ---------------------------------------------------------------------------
// Module State
// ---------------------------------------------------------------------------

let startTime = 0;
let maxScrollDepth = 0;
let engagements: EngagementSignal[] = [];
let appliedTransforms: { selector: string; action: TransformAction }[] = [];
let flushed = false;
let scrollTimer: number | null = null;
let intersectionObserver: IntersectionObserver | null = null;

// Track hover timers per element to properly clear them
const hoverTimers = new Map<HTMLElement, number>();

// ---------------------------------------------------------------------------
// Search Query Extraction
// ---------------------------------------------------------------------------

function extractSearchQuery(): string {
  // Check current URL params (for search engine result pages)
  for (const param of SEARCH_PARAMS) {
    const value = new URL(location.href).searchParams.get(param);
    if (value) return value;
  }

  // Check referrer for search engine queries
  if (document.referrer) {
    try {
      const refUrl = new URL(document.referrer);
      const isSearch = SEARCH_DOMAINS.some(d => refUrl.hostname.includes(d));
      if (isSearch) {
        for (const param of SEARCH_PARAMS) {
          const value = refUrl.searchParams.get(param);
          if (value) return value;
        }
      }
    } catch {
      // Malformed referrer — skip
    }
  }

  return '';
}

// ---------------------------------------------------------------------------
// Scroll Depth Tracking
// ---------------------------------------------------------------------------

function onScroll(): void {
  if (scrollTimer !== null) return;

  scrollTimer = window.setTimeout(() => {
    scrollTimer = null;
    const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollHeight > 0) {
      const depth = Math.round((window.scrollY / scrollHeight) * 100);
      if (depth > maxScrollDepth) maxScrollDepth = depth;
    }
  }, SCROLL_THROTTLE_MS);
}

// ---------------------------------------------------------------------------
// Engagement Tracking on Transformed Elements
// ---------------------------------------------------------------------------

function trackClick(selector: string, action: TransformAction): void {
  const signal: EngagementSignal = {
    selector,
    action,
    engagementType: 'click',
    timestamp: Date.now(),
  };
  engagements.push(signal);

  // Send click events immediately for real-time feedback
  chrome.runtime.sendMessage({
    type: 'ENGAGEMENT_EVENT',
    payload: { ...signal, url: location.href },
  }).catch(() => { /* extension context may be invalidated */ });
}

function trackScrollIntoView(selector: string, action: TransformAction): void {
  engagements.push({
    selector,
    action,
    engagementType: 'scroll_into_view',
    timestamp: Date.now(),
  });
}

function trackHover(selector: string, action: TransformAction): void {
  engagements.push({
    selector,
    action,
    engagementType: 'hover',
    timestamp: Date.now(),
  });
}

function trackExpand(selector: string): void {
  engagements.push({
    selector,
    action: 'collapse',
    engagementType: 'expand',
    timestamp: Date.now(),
  });
}

function setupElementTracking(
  transforms: { selector: string; action: TransformAction }[]
): void {
  appliedTransforms = transforms;

  // IntersectionObserver for scroll-into-view
  const viewedSelectors = new Set<string>();
  intersectionObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const sel = (entry.target as HTMLElement).dataset.pbSignalSelector;
          const act = (entry.target as HTMLElement).dataset.pbSignalAction as TransformAction | undefined;
          if (sel && act && !viewedSelectors.has(sel)) {
            viewedSelectors.add(sel);
            trackScrollIntoView(sel, act);
            intersectionObserver?.unobserve(entry.target);
          }
        }
      }
    },
    { threshold: 0.5 }
  );

  for (const t of transforms) {
    const el = document.querySelector(t.selector) as HTMLElement | null;
    if (!el) continue;

    // Tag element for observer identification
    el.dataset.pbSignalSelector = t.selector;
    el.dataset.pbSignalAction = t.action;

    // Click tracking
    el.addEventListener('click', () => trackClick(t.selector, t.action), { once: true });

    // Intersection observer
    intersectionObserver.observe(el);

    // Hover tracking (>2s)
    el.addEventListener('mouseenter', () => {
      const timer = window.setTimeout(() => {
        trackHover(t.selector, t.action);
        hoverTimers.delete(el);
      }, HOVER_THRESHOLD_MS);
      hoverTimers.set(el, timer);
    });

    el.addEventListener('mouseleave', () => {
      const timer = hoverTimers.get(el);
      if (timer !== undefined) {
        clearTimeout(timer);
        hoverTimers.delete(el);
      }
    });

    // For collapsed elements, watch for manual expansion (display change)
    if (t.action === 'collapse') {
      const collapseObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (
            m.type === 'attributes' &&
            m.attributeName === 'style' &&
            (el.style.display !== 'none' && el.style.maxHeight !== '0px')
          ) {
            trackExpand(t.selector);
            collapseObserver.disconnect();
            break;
          }
        }
      });
      collapseObserver.observe(el, { attributes: true, attributeFilter: ['style'] });
    }
  }
}

// ---------------------------------------------------------------------------
// Flush — send PAGE_SIGNALS on unload
// ---------------------------------------------------------------------------

function flush(): void {
  if (flushed) return;
  flushed = true;

  // Cleanup
  intersectionObserver?.disconnect();
  for (const timer of hoverTimers.values()) clearTimeout(timer);
  hoverTimers.clear();

  const signal: PageVisitSignal = {
    url: location.href,
    title: document.title,
    referrer: document.referrer,
    searchQuery: extractSearchQuery(),
    scrollDepth: maxScrollDepth,
    dwellTime: Date.now() - startTime,
    engagements,
    appliedTransforms,
    visitedAt: startTime,
  };

  chrome.runtime.sendMessage({
    type: 'PAGE_SIGNALS',
    payload: signal,
  }).catch(() => { /* extension context may be invalidated */ });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startSignalCollection(
  transforms: { selector: string; action: TransformAction }[]
): void {
  startTime = Date.now();
  flushed = false;
  engagements = [];
  maxScrollDepth = 0;

  // Scroll depth
  window.addEventListener('scroll', onScroll, { passive: true });

  // Element-level engagement tracking
  setupElementTracking(transforms);

  // Flush on page hide/unload
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('beforeunload', flush);
}
