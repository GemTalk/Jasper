// Plain CJS module (not TypeScript) so it can be require()'d directly by
// client/bin/gemstone-integration-versions.js without a build step. That
// script runs in CI before the TypeScript compilation step (to determine
// which GemStone versions to test against), so it cannot depend on compiled
// output. The TypeScript declaration file (gemStoneVersion.d.ts) provides
// types for the compiled extension.

/**
 * A release, and optionally the pre-release tag that leads to it: three or four
 * numeric parts, then a tag attached with either separator — GemStone builds
 * have spelled it both ways ("4.0.0.a2", "4.0.0-a3"). A tag starts with a letter,
 * which is what keeps it distinct from a fourth numeric part: "3.7.4.3" is a
 * patch release, not a pre-release of 3.7.4.
 */
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?(?:[.-]([A-Za-z][A-Za-z0-9]*))?$/;

/**
 * Parses a version string into its four numeric parts (padded with 0) and its
 * pre-release tag, if it has one. Throws if the string is neither.
 * @param {string} versionString
 * @returns {{ segments: number[], tag: string | undefined }}
 */
function parseGemStoneVersion(versionString) {
  const match = VERSION_PATTERN.exec(versionString);
  if (!match) throw new Error(`Invalid version: ${versionString}`);

  return {
    // normalize to 4 parts so compareGemStoneVersions can always iterate exactly 4
    segments: [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? 0)],
    tag: match[5],
  };
}

/**
 * Compares two GemStone version strings.
 *
 * A pre-release sorts *before* the release it leads to — "4.0.0-a3" < "4.0.0" —
 * which is semver's rule and the one that reads correctly while 4.0.0 proper does
 * not exist yet. The opposite reading (a tag as a later build of a release, the
 * way 3.7.4.3 follows 3.7.4) is defensible too, so it is written down here rather
 * than left to be inferred: the Versions list sort is the only thing that depends
 * on it. Two pre-releases of one release compare by tag, digits within the tag
 * numerically, so a9 precedes a10.
 *
 * @param {string} versionString
 * @param {string} anotherVersionString
 * @returns {number} Negative if versionString < anotherVersionString,
 *                   0 if equal,
 *                   positive if versionString > anotherVersionString.
 */
function compareGemStoneVersions(versionString, anotherVersionString) {
  const va = parseGemStoneVersion(versionString);
  const vb = parseGemStoneVersion(anotherVersionString);

  for (let i = 0; i < 4; i++) {
    const diff = va.segments[i] - vb.segments[i];
    if (diff !== 0) return diff;
  }

  if (va.tag === vb.tag) return 0;
  if (va.tag === undefined) return 1;
  if (vb.tag === undefined) return -1;
  return va.tag.localeCompare(vb.tag, 'en', { numeric: true, sensitivity: 'base' });
}

/**
 * Whether compareGemStoneVersions can read this string. A product directory
 * carries whatever name someone gave it, so a caller that must not fail over
 * one row asks first rather than catching the throw.
 * @param {string} versionString
 * @returns {boolean}
 */
function isComparableGemStoneVersion(versionString) {
  return VERSION_PATTERN.test(versionString);
}

module.exports = { compareGemStoneVersions, isComparableGemStoneVersion };
