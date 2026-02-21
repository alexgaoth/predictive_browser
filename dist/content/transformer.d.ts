import type { TransformResponse } from '../types/interfaces.js';
export declare function applyTransforms(response: TransformResponse): Promise<void>;
export declare function testTransformer(): Promise<void>;
export declare function cleanupTransforms(): void;
