import type { UserProfile } from '../types/interfaces.js';
export declare class ProfileManager {
    private profile;
    initialize(): Promise<void>;
    getProfile(): UserProfile;
    updateFocus(focus: string): Promise<void>;
    /**
     * Extract unique domains + meaningful title keywords from browsing history.
     * Returns the top 20 interest signals as a deduplicated string array.
     * Example output: ["github.com", "machine learning", "ycombinator.com", "typescript"]
     */
    private extractInterests;
}
