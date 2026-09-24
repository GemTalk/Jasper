/**
 * Compares two GemStone version strings.
 * @param {string} versionString
 * @param {string} anotherVersionString
 * @returns {number} Negative if versionsString < anotherVersionString,
 *                   0 if equal,
 *                   positive if versionsString > anotherVersionString.
 */
export function compareGemStoneVersions(versionString: string, anotherVersionString: string): number;

/**
 * Whether compareGemStoneVersions can read this string, for callers that must
 * not fail over one unreadable row.
 * @param {string} versionString
 */
export function isComparableGemStoneVersion(versionString: string): boolean;
