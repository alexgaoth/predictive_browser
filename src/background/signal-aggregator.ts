// src/background/signal-aggregator.ts
// Processes raw signals into weighted topic model, per-domain profiles,
// session detection, temporal bucketing, and transform feedback rates.

import type {
  PageVisitSignal,
  EngagementSignal,
  TopicScore,
  DomainProfile,
  BrowsingSession,
  TemporalBucket,
  TemporalBucketKey,
  TransformFeedback,
  TransformAction,
  SignalStore,
  EnhancedUserProfile,
  UserProfile,
} from '../types/interfaces.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const WRITE_DEBOUNCE_MS = 5000;
const STORAGE_KEY = 'signalStore';

// Storage limits
const MAX_PAGE_VISITS = 200;
const MAX_DOMAINS = 100;
const MAX_TOPICS = 50;
const MAX_ENGAGEMENTS = 500;
const MAX_SESSIONS = 10;
const DOMAIN_EXPIRY_DAYS = 30;
const TOPIC_MIN_SCORE = 0.01;

// Score weights
const SCORE_SEARCH_QUERY = 3.0;
const SCORE_HIGH_ENGAGEMENT = 2.0;
const SCORE_NORMAL_VISIT = 1.0;
const SCORE_CLICK_HIGHLIGHT = 2.5;

// Decay constant
const DECAY_LAMBDA = 0.1;

// ---------------------------------------------------------------------------
// Module State
// ---------------------------------------------------------------------------

let store: SignalStore = createEmptyStore();
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

function createEmptyStore(): SignalStore {
  return {
    pageVisits: [],
    domainProfiles: [],
    topicScores: [],
    engagements: [],
    sessions: [],
    temporalBuckets: [],
    transformFeedback: [],
    lastCleanup: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export async function initializeAggregator(): Promise<void> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  if (result[STORAGE_KEY]) {
    store = result[STORAGE_KEY] as SignalStore;
  }

  // Run cleanup if overdue
  if (Date.now() - store.lastCleanup > CLEANUP_INTERVAL_MS) {
    runCleanup();
  }
}

// ---------------------------------------------------------------------------
// Process Page Visit Signal
// ---------------------------------------------------------------------------

export function processPageSignal(signal: PageVisitSignal): void {
  // Add to page visits
  store.pageVisits.push(signal);
  if (store.pageVisits.length > MAX_PAGE_VISITS) {
    store.pageVisits = store.pageVisits.slice(-MAX_PAGE_VISITS);
  }

  // Update domain profile
  updateDomainProfile(signal);

  // Extract and score topics
  const topics = extractTopics(signal);
  const baseScore = computeVisitScore(signal);
  for (const topic of topics) {
    updateTopicScore(topic, baseScore);
  }

  // Update session
  updateSession(signal);

  // Update temporal bucket
  updateTemporalBucket(topics);

  // Update transform feedback
  updateTransformFeedback(signal);

  markDirty();
}

// ---------------------------------------------------------------------------
// Process Real-Time Engagement Event
// ---------------------------------------------------------------------------

export function processEngagementEvent(
  signal: EngagementSignal & { url: string }
): void {
  store.engagements.push(signal);
  if (store.engagements.length > MAX_ENGAGEMENTS) {
    store.engagements = store.engagements.slice(-MAX_ENGAGEMENTS);
  }

  // Boost topics from the engaged page
  const url = signal.url;
  const recentVisit = store.pageVisits.find(v => v.url === url);
  if (recentVisit) {
    const topics = extractTopics(recentVisit);
    for (const topic of topics) {
      updateTopicScore(topic, SCORE_CLICK_HIGHLIGHT);
    }
  }

  markDirty();
}

// ---------------------------------------------------------------------------
// Topic Extraction
// ---------------------------------------------------------------------------

function extractTopics(signal: PageVisitSignal): string[] {
  const topics: string[] = [];
  const seen = new Set<string>();

  function addTopic(t: string): void {
    const normalized = t.toLowerCase().trim();
    if (normalized.length >= 3 && !seen.has(normalized)) {
      seen.add(normalized);
      topics.push(normalized);
    }
  }

  // From search query (highest signal)
  if (signal.searchQuery) {
    addTopic(signal.searchQuery);
    // Also add individual words from multi-word queries
    for (const word of signal.searchQuery.split(/\s+/)) {
      if (word.length >= 4) addTopic(word);
    }
  }

  // From URL path segments
  try {
    const url = new URL(signal.url);
    const segments = url.pathname.split('/').filter(s => s.length >= 3);
    for (const seg of segments.slice(0, 3)) {
      // Skip common non-semantic segments
      if (!/^(index|page|post|article|view|id|\d+)$/i.test(seg)) {
        addTopic(seg.replace(/[-_]/g, ' '));
      }
    }
  } catch { /* malformed URL */ }

  // From title — extract bigrams and meaningful words
  if (signal.title) {
    const words = signal.title
      .toLowerCase()
      .split(/[\s\-–|:&/]+/)
      .map(w => w.replace(/[^a-z0-9]/g, ''))
      .filter(w => w.length >= 4);

    // Single meaningful words
    for (const w of words.slice(0, 5)) {
      addTopic(w);
    }

    // Bigrams
    for (let i = 0; i < words.length - 1 && topics.length < 10; i++) {
      addTopic(`${words[i]} ${words[i + 1]}`);
    }
  }

  return topics.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Topic Scoring with Time Decay
// ---------------------------------------------------------------------------

function updateTopicScore(topic: string, scoreIncrement: number): void {
  const existing = store.topicScores.find(t => t.topic === topic);
  if (existing) {
    // Apply time decay then add new score
    const daysSince = (Date.now() - existing.lastSeen) / (1000 * 60 * 60 * 24);
    existing.score = existing.score * Math.exp(-DECAY_LAMBDA * daysSince) + scoreIncrement;
    existing.lastSeen = Date.now();
  } else {
    store.topicScores.push({ topic, score: scoreIncrement, lastSeen: Date.now() });
  }

  // Sort by score descending, trim to limit
  store.topicScores.sort((a, b) => b.score - a.score);
  if (store.topicScores.length > MAX_TOPICS) {
    store.topicScores = store.topicScores.slice(0, MAX_TOPICS);
  }
}

function computeVisitScore(signal: PageVisitSignal): number {
  if (signal.searchQuery) return SCORE_SEARCH_QUERY;
  if (signal.dwellTime > 30000 && signal.scrollDepth > 50) return SCORE_HIGH_ENGAGEMENT;
  return SCORE_NORMAL_VISIT;
}

// ---------------------------------------------------------------------------
// Domain Profiles
// ---------------------------------------------------------------------------

function updateDomainProfile(signal: PageVisitSignal): void {
  let domain: string;
  try {
    domain = new URL(signal.url).hostname.replace(/^www\./, '');
  } catch {
    return;
  }

  const existing = store.domainProfiles.find(d => d.domain === domain);
  if (existing) {
    existing.visitCount++;
    // Running average
    existing.avgDwellTime =
      (existing.avgDwellTime * (existing.visitCount - 1) + signal.dwellTime) /
      existing.visitCount;
    existing.avgScrollDepth =
      (existing.avgScrollDepth * (existing.visitCount - 1) + signal.scrollDepth) /
      existing.visitCount;
    existing.lastVisited = Date.now();
    // Merge topics
    const topics = extractTopics(signal);
    for (const t of topics.slice(0, 3)) {
      if (!existing.topics.includes(t)) {
        existing.topics.push(t);
        if (existing.topics.length > 10) existing.topics.shift();
      }
    }
  } else {
    store.domainProfiles.push({
      domain,
      visitCount: 1,
      avgDwellTime: signal.dwellTime,
      avgScrollDepth: signal.scrollDepth,
      lastVisited: Date.now(),
      topics: extractTopics(signal).slice(0, 3),
    });
  }

  // Trim to limit, removing least recently visited
  if (store.domainProfiles.length > MAX_DOMAINS) {
    store.domainProfiles.sort((a, b) => b.lastVisited - a.lastVisited);
    store.domainProfiles = store.domainProfiles.slice(0, MAX_DOMAINS);
  }
}

// ---------------------------------------------------------------------------
// Session Detection (30min gap = new session)
// ---------------------------------------------------------------------------

function updateSession(signal: PageVisitSignal): void {
  const now = Date.now();
  let current = store.sessions[store.sessions.length - 1];

  if (!current || now - current.lastActivityAt > SESSION_GAP_MS) {
    // Start new session
    current = {
      id: `session-${now}`,
      startedAt: now,
      lastActivityAt: now,
      urls: [],
      searchQueries: [],
    };
    store.sessions.push(current);

    // Trim to max sessions
    if (store.sessions.length > MAX_SESSIONS) {
      store.sessions = store.sessions.slice(-MAX_SESSIONS);
    }
  }

  current.lastActivityAt = now;
  current.urls.push(signal.url);
  if (signal.searchQuery && !current.searchQueries.includes(signal.searchQuery)) {
    current.searchQueries.push(signal.searchQuery);
  }
}

// ---------------------------------------------------------------------------
// Temporal Bucketing
// ---------------------------------------------------------------------------

function getCurrentBucketKey(): TemporalBucketKey {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();

  const dayType = (day === 0 || day === 6) ? 'weekend' : 'weekday';
  let timeOfDay: 'morning' | 'afternoon' | 'evening';
  if (hour < 12) timeOfDay = 'morning';
  else if (hour < 18) timeOfDay = 'afternoon';
  else timeOfDay = 'evening';

  return `${dayType}_${timeOfDay}`;
}

function updateTemporalBucket(topics: string[]): void {
  const key = getCurrentBucketKey();
  let bucket = store.temporalBuckets.find(b => b.key === key);

  if (!bucket) {
    bucket = { key, topics: [], visitCount: 0 };
    store.temporalBuckets.push(bucket);
  }

  bucket.visitCount++;
  for (const t of topics.slice(0, 3)) {
    if (!bucket.topics.includes(t)) {
      bucket.topics.push(t);
      if (bucket.topics.length > 20) bucket.topics.shift();
    }
  }
}

// ---------------------------------------------------------------------------
// Transform Feedback
// ---------------------------------------------------------------------------

function updateTransformFeedback(signal: PageVisitSignal): void {
  // Count applied transforms by action type
  for (const t of signal.appliedTransforms) {
    let fb = store.transformFeedback.find(f => f.action === t.action);
    if (!fb) {
      fb = { action: t.action, appliedCount: 0, engagedCount: 0 };
      store.transformFeedback.push(fb);
    }
    fb.appliedCount++;
  }

  // Count engagements by the action type of the engaged element
  for (const e of signal.engagements) {
    const fb = store.transformFeedback.find(f => f.action === e.action);
    if (fb) fb.engagedCount++;
  }
}

// ---------------------------------------------------------------------------
// Build Enhanced Profile for LLM
// ---------------------------------------------------------------------------

export function buildEnhancedProfile(
  baseProfile: UserProfile,
  openTabTitles: string[],
  currentPageSearchQuery: string
): EnhancedUserProfile {
  // Apply decay to all topic scores before returning
  const now = Date.now();
  for (const topic of store.topicScores) {
    const daysSince = (now - topic.lastSeen) / (1000 * 60 * 60 * 24);
    topic.score *= Math.exp(-DECAY_LAMBDA * daysSince);
    topic.lastSeen = now; // Prevent double decay
  }

  // Remove topics below threshold
  store.topicScores = store.topicScores.filter(t => t.score >= TOPIC_MIN_SCORE);

  const currentSession = store.sessions[store.sessions.length - 1] ?? null;
  const bucketKey = getCurrentBucketKey();
  const currentBucket = store.temporalBuckets.find(b => b.key === bucketKey) ?? null;

  return {
    ...baseProfile,
    topicModel: store.topicScores.slice(0, 10),
    currentSession,
    temporalBucket: currentBucket,
    transformFeedback: store.transformFeedback,
    openTabTitles: openTabTitles.slice(0, 5),
    inboundSearchQuery: currentPageSearchQuery,
  };
}

// ---------------------------------------------------------------------------
// Storage — Debounced Writes
// ---------------------------------------------------------------------------

function markDirty(): void {
  dirty = true;
  if (!writeTimer) {
    writeTimer = setTimeout(flushToStorage, WRITE_DEBOUNCE_MS);
  }
}

async function flushToStorage(): Promise<void> {
  writeTimer = null;
  if (!dirty) return;
  dirty = false;

  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: store });
  } catch (e) {
    console.error('[Predictive Browser] Failed to write signal store:', e);
  }
}

// ---------------------------------------------------------------------------
// Cleanup — runs every 24 hours
// ---------------------------------------------------------------------------

function runCleanup(): void {
  const now = Date.now();

  // Drop domains not visited in 30 days
  const domainExpiry = now - DOMAIN_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  store.domainProfiles = store.domainProfiles.filter(
    d => d.lastVisited > domainExpiry
  );

  // Drop topics below threshold after decay
  for (const topic of store.topicScores) {
    const daysSince = (now - topic.lastSeen) / (1000 * 60 * 60 * 24);
    topic.score *= Math.exp(-DECAY_LAMBDA * daysSince);
  }
  store.topicScores = store.topicScores.filter(t => t.score >= TOPIC_MIN_SCORE);

  // Trim arrays to limits
  if (store.pageVisits.length > MAX_PAGE_VISITS) {
    store.pageVisits = store.pageVisits.slice(-MAX_PAGE_VISITS);
  }
  if (store.engagements.length > MAX_ENGAGEMENTS) {
    store.engagements = store.engagements.slice(-MAX_ENGAGEMENTS);
  }
  if (store.sessions.length > MAX_SESSIONS) {
    store.sessions = store.sessions.slice(-MAX_SESSIONS);
  }

  store.lastCleanup = now;
  markDirty();
}
