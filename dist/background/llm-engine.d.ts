import type { PageSkeleton, UserProfile, TransformResponse } from '../types/interfaces.js';
export declare function generateTransforms(skeleton: PageSkeleton, profile: UserProfile): Promise<TransformResponse>;
export declare function testEngine(): Promise<void>;
