// Descriptions for configuration parameters, parsed from a GemStone product's
// `data/system.conf`. Issue #232 asks the configuration viewer to show each
// value's purpose as a tooltip; the authoritative text for that lives in the
// comment block above every parameter in the shipped system.conf, e.g.
//
//   #=========================================================================
//   # STN_MAX_SESSIONS: The maximum number of sessions ...
//   #  ... more explanation ...
//   # Default: 40
//   #STN_MAX_SESSIONS = 40;
//
// This parses that file into a `configKey -> description` map. Two conventions
// matter: the divider lines (`#====`) that separate one parameter's block from
// the next, and the block's first ALL_CAPS token, which names the parameter.
// The setting line itself (`#KEY = value;`) is dropped — it is the current
// default, not a description, and the live value is what the viewer already
// shows beside it.
//
// The report the viewer draws mixes ALL_CAPS config-file keys with their
// CamelCase runtime spellings (see queries/configurationReport.ts). system.conf
// is keyed only by the ALL_CAPS names, so {@link descriptionFor} also tries the
// CamelCase -> UPPER_SNAKE spelling. The mapping is heuristic and misses a few
// (TempObj vs TEMPOBJ); a miss yields no matched description here, and the viewer
// then says why (no matching entry) rather than showing a wrong one.

/** A line that separates one parameter's comment block from the next. */
const DIVIDER = /^#[=-]{3,}/;
/** A comment line: `#` optionally indented, capturing the text after it. */
const COMMENT = /^\s*#\s?(.*)$/;
/** The first token of a block that names its parameter, ALL_CAPS with `_`. */
const KEY_HEADER = /^([A-Z][A-Z0-9_]{2,})\b\s*:?\s*(.*)$/;

/**
 * Parse a system.conf into a map from configuration key to its description
 * text. Descriptions keep their internal line breaks (a tooltip renders them),
 * with the leading `#` stripped and surrounding blank lines trimmed.
 */
export function parseConfigDescriptions(text: string): Map<string, string> {
  const map = new Map<string, string>();
  let key: string | undefined;
  let lines: string[] = [];

  const flush = (): void => {
    if (key) {
      const desc = lines.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
      // The first non-empty block for a key wins: once set it is never
      // overwritten, and an empty block never sets it in the first place.
      if (desc && !map.has(key)) map.set(key, desc);
    }
    key = undefined;
    lines = [];
  };

  for (const raw of text.split('\n')) {
    if (DIVIDER.test(raw)) {
      flush();
      continue;
    }
    const comment = raw.match(COMMENT);
    if (!comment) {
      // A bare setting line (the extent list at the end of the file, say) is
      // not part of any description.
      continue;
    }
    const body = comment[1].trimEnd();
    if (key === undefined) {
      const header = body.match(KEY_HEADER);
      if (header) {
        key = header[1];
        if (header[2]) lines.push(header[2]);
        continue;
      }
      // Comment text before any key is a file banner — skip until a key appears.
      continue;
    }
    // Drop the setting line for this key (`KEY = ...` or `#KEY = ...`, possibly
    // indented), which is the default value, not prose.
    if (new RegExp(`^\\s*${key}\\b\\s*=`).test(body)) continue;
    lines.push(body);
  }
  flush();
  return map;
}

/**
 * The UPPER_SNAKE spelling of a CamelCase runtime key, so a `StnMaxSessions`
 * can be looked up against the file's `STN_MAX_SESSIONS`. An already-ALL_CAPS
 * key is returned unchanged.
 */
export function toConfigFileKey(key: string): string {
  if (!/[a-z]/.test(key)) return key;
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toUpperCase();
}

/**
 * The description for a report key, trying its own spelling first and then the
 * config-file spelling of a CamelCase key. Undefined when the file named
 * neither — the viewer then explains the miss (no matching entry, or no
 * system.conf for the version) rather than showing a blank.
 */
export function descriptionFor(descriptions: Map<string, string>, key: string): string | undefined {
  return descriptions.get(key) ?? descriptions.get(toConfigFileKey(key));
}
