// Query layer for the stone and gem CONFIGURATION reports — the values behind
// `System stoneConfigurationReport` and `System gemConfigurationReport`, which
// each answer a SymbolDictionary of configuration parameter name -> current
// value. The GemStone Manager renders these so an admin can see what a live
// session is actually running with, and change the runtime-settable ones.
//
// Two naming conventions appear as keys in the same report, and they mean
// different things:
//   - ALL_CAPS (e.g. SHR_PAGE_CACHE_SIZE_KB) are config-file parameters, read
//     from a .conf before the process started. They are read-only at runtime —
//     the stone answers `rtErrConfigReadOnly` to any attempt to set one.
//   - CamelCase (e.g. StnMaxSessions, GemTempObjCacheSize) are the runtime
//     parameters, some of which may be changed in a live session via
//     `System stoneConfigurationAt:put:` / `System gemConfigurationAt:put:`.
// That single rule — a lowercase letter in the key means "runtime-settable" —
// is exactly the distinction issue #232 asks the viewer to draw. Whether a
// given runtime key can actually be changed *now* is the server's call, not
// ours: stone-level sets require SystemUser, and some gem parameters are frozen
// after login. So the UI marks CamelCase keys editable and lets the stone be
// the authority — {@link setConfiguration} surfaces its exact verdict.
//
// All emitted Smalltalk is ASCII-only (the 3.6.x ComStrmSetCursor bug) and
// evaluates to a verbatim String, matching the other query modules.
import { QueryExecutor } from './types';

/** Which report a parameter came from — decides which setter applies. */
export type ConfigScope = 'stone' | 'gem';

/** The kinds of value the viewer knows how to display and edit. */
export type ConfigValueType = 'boolean' | 'integer' | 'string' | 'other';

export interface ConfigEntry {
  key: string;
  /** Display form: the raw characters for a String, printString otherwise. */
  value: string;
  type: ConfigValueType;
  /** CamelCase key — a runtime parameter the stone *may* let a session change. */
  settable: boolean;
}

// A value the report emits with a class name we don't otherwise recognise is
// 'other' (an Array, a Float, a Fraction) — shown, never offered for editing.
const INTEGER_CLASSES = new Set([
  'SmallInteger',
  'LargePositiveInteger',
  'LargeNegativeInteger',
  'LargeInteger',
]);
const STRING_CLASSES = new Set([
  'String',
  'Symbol',
  'DoubleByteString',
  'QuadByteString',
  'Unicode7',
  'Unicode16',
  'Unicode32',
]);

function classifyType(className: string): ConfigValueType {
  if (className === 'Boolean') return 'boolean';
  if (INTEGER_CLASSES.has(className)) return 'integer';
  if (STRING_CLASSES.has(className)) return 'string';
  return 'other';
}

/**
 * A configuration key is runtime-settable when it is spelled in CamelCase — i.e.
 * it carries a lowercase letter. The ALL_CAPS config-file parameters never do,
 * so this one test separates the two families the report mixes together. It is
 * a *necessary* condition, not a sufficient one: the stone still decides whether
 * a given key may change in this session (see this module's header).
 */
export function isRuntimeSettable(key: string): boolean {
  return /[a-z]/.test(key);
}

/**
 * Whether the viewer should offer an inline editor for this entry: it must be a
 * runtime key *and* one of the value kinds we can round-trip through an editor
 * (a Boolean, an Integer, or a String). An 'other' value — an Array, say — is
 * shown but never edited, since we have no faithful literal to rebuild it from.
 */
export function isEditable(entry: ConfigEntry): boolean {
  return entry.settable && entry.type !== 'other';
}

// The report is serialised one parameter per line as `key<TAB>class<TAB>value`,
// with any tab/newline inside a value flattened to a space on the server so a
// value can never span or split a line. Everything after the second tab is the
// value, rejoined defensively in case one slipped through.
const REPORT_TERMINATOR = 'GS-ERROR:';

function reportCode(reportSelector: string): string {
  return `[ | ws rpt |
ws := WriteStream on: String new.
rpt := System ${reportSelector}.
(rpt keys asSortedCollection: [:a :b | a asString <= b asString]) do: [:k | | v cls dv |
  v := rpt at: k.
  cls := v class name asString.
  dv := (v isKindOf: String) ifTrue: [v] ifFalse: [v printString].
  dv := dv copyReplaceAll: (String with: Character tab) with: ' '.
  dv := dv copyReplaceAll: (String with: Character lf) with: ' '.
  dv := dv copyReplaceAll: (String with: Character cr) with: ' '.
  ws nextPutAll: k asString; nextPut: Character tab;
     nextPutAll: cls; nextPut: Character tab;
     nextPutAll: dv; nextPut: Character lf ].
ws contents ] on: Error do: [:e | '${REPORT_TERMINATOR} ', e messageText]`;
}

export function buildStoneReportCode(): string {
  return reportCode('stoneConfigurationReport');
}

export function buildGemReportCode(): string {
  return reportCode('gemConfigurationReport');
}

/**
 * Parse the tab-delimited report emitted by {@link reportCode} into entries.
 * A line missing its two tabs is skipped rather than guessed at, and a whole
 * report that came back as the error sentinel is raised — the caller asked for
 * a report and got a failure, not an empty one.
 */
export function parseConfigReport(raw: string): ConfigEntry[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith(REPORT_TERMINATOR)) {
    throw new Error(
      trimmed.slice(REPORT_TERMINATOR.length).trim() || 'configuration report failed',
    );
  }
  const entries: ConfigEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line === '') continue;
    const firstTab = line.indexOf('\t');
    if (firstTab < 0) continue;
    const secondTab = line.indexOf('\t', firstTab + 1);
    if (secondTab < 0) continue;
    const key = line.slice(0, firstTab);
    const className = line.slice(firstTab + 1, secondTab);
    const value = line.slice(secondTab + 1);
    if (key === '') continue;
    entries.push({
      key,
      value,
      type: classifyType(className),
      settable: isRuntimeSettable(key),
    });
  }
  // Alphabetize case-insensitively. The report interns keys as Symbols and sorts
  // them by ASCII, which puts every ALL_CAPS config-file name ahead of every
  // CamelCase runtime name — two runs that read as "not sorted" to a person
  // scanning for a name. Folding case interleaves them into one A–Z list.
  entries.sort(
    (a, b) => a.key.toLowerCase().localeCompare(b.key.toLowerCase()) || a.key.localeCompare(b.key),
  );
  return entries;
}

function runReport(execute: QueryExecutor, code: string): ConfigEntry[] {
  return parseConfigReport(execute(code));
}

/** The stone's current configuration, sorted by key. */
export function stoneConfiguration(execute: QueryExecutor): ConfigEntry[] {
  return runReport(execute, buildStoneReportCode());
}

/** The connected gem's current configuration, sorted by key. */
export function gemConfiguration(execute: QueryExecutor): ConfigEntry[] {
  return runReport(execute, buildGemReportCode());
}

// A key is only ever formed from the report's own keys, but it is still spliced
// into Smalltalk, so it is checked against the shape a configuration name can
// take before it goes anywhere near the gem.
const KEY_SHAPE = /^[A-Za-z][A-Za-z0-9_]*$/;

export class ConfigValueError extends Error {}

/**
 * The Smalltalk literal for a typed value the user typed into the editor.
 * Throws {@link ConfigValueError} when the text cannot be a value of that type,
 * so a bad integer or an unknown kind never reaches the gem as malformed code.
 */
export function configValueLiteral(type: ConfigValueType, value: string): string {
  switch (type) {
    case 'boolean': {
      const v = value.trim().toLowerCase();
      if (v === 'true') return 'true';
      if (v === 'false') return 'false';
      throw new ConfigValueError(`Expected true or false, got "${value}"`);
    }
    case 'integer': {
      const v = value.trim();
      if (!/^-?\d+$/.test(v)) throw new ConfigValueError(`Expected an integer, got "${value}"`);
      return v;
    }
    case 'string':
      // Double every quote — the one escape a Smalltalk string literal needs.
      return `'${value.replace(/'/g, "''")}'`;
    default:
      throw new ConfigValueError(`Cannot edit a value of type "${type}"`);
  }
}

export function buildSetConfigCode(
  scope: ConfigScope,
  key: string,
  type: ConfigValueType,
  value: string,
): string {
  if (!KEY_SHAPE.test(key)) throw new ConfigValueError(`Not a configuration key: "${key}"`);
  const literal = configValueLiteral(type, value);
  const keyword = scope === 'stone' ? 'stoneConfigurationAt' : 'gemConfigurationAt';
  return `[ System ${keyword}: #${key} put: ${literal}. 'OK' ]
  on: Error do: [:e | '${REPORT_TERMINATOR} ', e messageText]`;
}

/**
 * Whether a value the session now reports is the one that was requested — used
 * to tell a change that stuck from one the stone accepted and then ignored.
 * Boolean and integer values are compared case- and whitespace-insensitively
 * (`True` == `true`, ` 60 ` == `60`); anything else is compared verbatim.
 */
export function configValuesMatch(
  type: ConfigValueType,
  requested: string,
  settled: string,
): boolean {
  if (type === 'boolean' || type === 'integer') {
    return requested.trim().toLowerCase() === settled.trim().toLowerCase();
  }
  return requested === settled;
}

export interface SetConfigResult {
  ok: boolean;
  /** The stone's message when the set was refused — its exact words. */
  message?: string;
}

/**
 * Attempt to set a runtime configuration value, letting the stone be the
 * authority: it answers `'OK'` on success, or the error sentinel with its own
 * reason (a SecurityError for a stone key a DataCurator may not touch, a
 * "may not be changed after login" for a frozen gem key, and so on).
 */
export function setConfiguration(
  execute: QueryExecutor,
  scope: ConfigScope,
  key: string,
  type: ConfigValueType,
  value: string,
): SetConfigResult {
  const result = execute(buildSetConfigCode(scope, key, type, value)).trim();
  if (result === 'OK') return { ok: true };
  const message = result.startsWith(REPORT_TERMINATOR)
    ? result.slice(REPORT_TERMINATOR.length).trim()
    : result;
  return { ok: false, message: message || 'The configuration value could not be set.' };
}
