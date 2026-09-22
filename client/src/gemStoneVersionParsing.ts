/**
 * Extracts the leading numeric version from a raw `GciTsVersion` string
 * (e.g. "3.7.5 build ...") and pads it to 3 segments so it compares cleanly
 * with `compareGemStoneVersions` instead of throwing on a short or
 * suffixed version.
 */
export function normalizeGemStoneVersion(rawVersion: string | undefined): string | undefined {
  const numeric = rawVersion?.match(/^\d+\.\d+(\.\d+){0,2}/)?.[0];
  if (!numeric) return undefined;
  return numeric.split('.').length < 3 ? `${numeric}.0` : numeric;
}
