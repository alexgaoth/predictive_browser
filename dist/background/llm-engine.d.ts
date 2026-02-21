import type { PageSkeleton, UserProfile, TransformResponse, EnhancedUserProfile } from '../types/interfaces.js';
export declare function generateTransforms(skeleton: PageSkeleton, profile: UserProfile | EnhancedUserProfile): Promise<TransformResponse>;
export declare function testEngine(): Promise<void>;
