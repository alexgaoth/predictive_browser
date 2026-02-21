interface SkeletonNode {
    id: string;
    selector: string;
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
export declare function extractSkeleton(): PageSkeleton;
export declare function testExtractor(): void;
export {};
