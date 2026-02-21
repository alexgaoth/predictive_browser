// =============================================================================
// Predictive Browser — Shared Type Definitions
// Session 2 owns this file. All sessions import from here.
// Do NOT modify this file's exports without coordinating across all sessions.
// =============================================================================

// ---------------------------------------------------------------------------
// Interface Contract 1: PageSkeleton
// Producer: Session 1 (Extractor) | Consumer: Session 2 (LLM Engine)
// ---------------------------------------------------------------------------

export interface SkeletonNode {
  /** Unique ID assigned during extraction (e.g., "node-0", "node-1") */
  id: string;
  /** Primary selector: [data-pb-node="node-N"] — stable if attribute survives re-render */
  selector: string;
  /** Fallback nth-child path — used if data-pb-node attribute was wiped by a JS framework */
  fallbackSelector?: string;
  /** Semantic tag type */
  type: "heading" | "nav" | "section" | "link" | "image" | "text" | "list" | "form" | "unknown";
  /** First ~80 chars of visible text content */
  textPreview: string;
  /** Tag name (e.g., "div", "h1", "a") */
  tag: string;
  /** Heading level if applicable (1-6) */
  headingLevel?: number;
  /** href if it's a link */
  href?: string;
  /** alt text if it's an image */
  alt?: string;
  /** Child nodes */
  children: SkeletonNode[];
}

export interface PageSkeleton {
  /** The URL of the page */
  url: string;
  /** Page title from <title> tag */
  title: string;
  /** Meta description if available */
  metaDescription: string;
  /** The skeleton tree */
  nodes: SkeletonNode[];
  /** Timestamp of extraction */
  extractedAt: number;
}

// ---------------------------------------------------------------------------
// Interface Contract 2: TransformInstruction
// Producer: Session 2 (LLM Engine) | Consumer: Session 3 (Transform Executor)
// ---------------------------------------------------------------------------

export type TransformAction = "highlight" | "collapse" | "reorder" | "annotate" | "dim";

export interface TransformInstruction {
  /** Which action to perform */
  action: TransformAction;
  /** CSS selector targeting the element (from SkeletonNode.selector) */
  selector: string;
  /** Human-readable reason for this transform (shown in debug/tooltip) */
  reason: string;
  /** For "reorder": target position — "top" of parent or "above:{selector}" */
  position?: "top" | string;
  /** For "annotate": text to display as a small badge/tooltip */
  annotation?: string;
  /** Relevance score 0-100, used for animation priority ordering */
  relevance: number;
}

export interface TransformResponse {
  /** Array of transforms to apply, ordered by relevance (highest first) */
  transforms: TransformInstruction[];
  /** One-line summary of what was changed and why */
  summary: string;
  /** Inferred user intent used for this transformation */
  inferredIntent: string;
  /** 2-3 sentence digest of the most relevant content on this page, in natural language */
  digest?: string;
}

// ---------------------------------------------------------------------------
// Interface Contract 3: UserProfile
// Producer: Session 2 (Profile Manager) | Consumer: Session 2 (LLM Engine)
// ---------------------------------------------------------------------------

export interface UserProfile {
  /** Free-text from onboarding: "What are you focused on right now?" */
  currentFocus: string;
  /** Extracted topics/interests from browsing history */
  interests: string[];
  /** Recent URLs visited (last 50) */
  recentUrls: string[];
  /** Seed profile for cold start */
  seedContext: string;
  /** Last updated timestamp */
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Interface Contract 4: Message Passing (Chrome Runtime)
// Content script ↔ Background service worker communication
// ---------------------------------------------------------------------------

/** Content script → Background: "Here's a skeleton, give me transforms" */
export interface SkeletonMessage {
  type: "SKELETON_READY";
  payload: PageSkeleton;
}

/** Background → Content script: "Here are your transforms" */
export interface TransformMessage {
  type: "TRANSFORMS_READY";
  payload: TransformResponse;
}

/** Background → Content script: "Something went wrong" */
export interface ErrorMessage {
  type: "TRANSFORM_ERROR";
  payload: { message: string };
}

// ---------------------------------------------------------------------------
// Interface Contract 5: Signal Collection (Content → Background)
// ---------------------------------------------------------------------------

export type EngagementType = "click" | "scroll_into_view" | "hover" | "expand";

export interface EngagementSignal {
  /** CSS selector of the engaged element */
  selector: string;
  /** What transform action was applied to this element */
  action: TransformAction;
  /** Type of engagement */
  engagementType: EngagementType;
  /** Timestamp of the engagement */
  timestamp: number;
}

export interface PageVisitSignal {
  url: string;
  title: string;
  /** Referring URL */
  referrer: string;
  /** Search query extracted from referrer/URL params, if any */
  searchQuery: string;
  /** Scroll depth 0-100 */
  scrollDepth: number;
  /** Dwell time in milliseconds */
  dwellTime: number;
  /** Engagement events on transformed elements */
  engagements: EngagementSignal[];
  /** Which transforms were applied to this page */
  appliedTransforms: { selector: string; action: TransformAction }[];
  /** Timestamp when the page was first loaded */
  visitedAt: number;
}

/** Content → Background: page-level signals on unload */
export interface PageSignalsMessage {
  type: "PAGE_SIGNALS";
  payload: PageVisitSignal;
}

/** Content → Background: real-time engagement event */
export interface EngagementEventMessage {
  type: "ENGAGEMENT_EVENT";
  payload: EngagementSignal & { url: string };
}

// ---------------------------------------------------------------------------
// Interface Contract 6: Aggregated Signal Types (Background internal)
// ---------------------------------------------------------------------------

export interface TopicScore {
  topic: string;
  score: number;
  /** Last time this topic was seen */
  lastSeen: number;
}

export interface DomainProfile {
  domain: string;
  visitCount: number;
  avgDwellTime: number;
  avgScrollDepth: number;
  lastVisited: number;
  /** Top topics associated with this domain */
  topics: string[];
}

export interface BrowsingSession {
  id: string;
  startedAt: number;
  lastActivityAt: number;
  urls: string[];
  searchQueries: string[];
}

export type TimeOfDay = "morning" | "afternoon" | "evening";
export type DayType = "weekday" | "weekend";
export type TemporalBucketKey = `${DayType}_${TimeOfDay}`;

export interface TemporalBucket {
  key: TemporalBucketKey;
  /** Topics active during this time bucket */
  topics: string[];
  /** Number of visits in this bucket */
  visitCount: number;
}

export interface TransformFeedback {
  action: TransformAction;
  appliedCount: number;
  engagedCount: number;
}

export interface SignalStore {
  pageVisits: PageVisitSignal[];
  domainProfiles: DomainProfile[];
  topicScores: TopicScore[];
  engagements: EngagementSignal[];
  sessions: BrowsingSession[];
  temporalBuckets: TemporalBucket[];
  transformFeedback: TransformFeedback[];
  lastCleanup: number;
}

export interface EnhancedUserProfile extends UserProfile {
  topicModel: TopicScore[];
  currentSession: BrowsingSession | null;
  temporalBucket: TemporalBucket | null;
  transformFeedback: TransformFeedback[];
  openTabTitles: string[];
  inboundSearchQuery: string;
}

// ---------------------------------------------------------------------------
// Message Union
// ---------------------------------------------------------------------------

export type ExtensionMessage =
  | SkeletonMessage
  | TransformMessage
  | ErrorMessage
  | PageSignalsMessage
  | EngagementEventMessage;
