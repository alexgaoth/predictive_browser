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
  /** CSS selector that uniquely identifies this element */
  selector: string;
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
  /** One-line summary of what was changed and why (for optional UI toast) */
  summary: string;
  /** Inferred user intent used for this transformation */
  inferredIntent: string;
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

export type ExtensionMessage = SkeletonMessage | TransformMessage | ErrorMessage;
