import { version } from 'milib';
export interface versionsMap {
    [key: string]: version.versionInfo;
}
/**
 * Get map of version numbers in git repository:
 *  <tag name> -> <parsed version info>
 */
export declare function getVersions(): Promise<versionsMap>;
export declare function latestVersionTag(v: versionsMap): string;
/**
 * Check if action was started from branch AND current commit is
 * repository's branch head.
 */
export declare function isBranchHead(): Promise<boolean>;
/**
 * Check if current version is the latest known modification of the major verison.
 * Returns 'true' when 1.3.12 is the latest known modification of v1 even if
 * 2.12.1, 3.0.0 and other higher versions exist in list.
 */
export declare function isLatestMajor(knownVersions: versionsMap, current: version.versionInfo): boolean;
/**
 Filter out tags that are not valid semantic versions
 Sort tags in descending order (newest first)
*/
export declare function sortTagsBySemver(tags: string[]): string[];
