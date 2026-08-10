/**
 * Pure text helpers for the class-definition editor.
 *
 * GemStone's `Class>>definition` never emits a `category:` line, yet every class
 * belongs to a category — so the editor shows the category on its own line for the
 * user to see and edit. That line is NOT part of a compilable class-creation
 * message: the 8-keyword `subclass:…inDictionary:category:options:` selector is
 * absent on base images (it raises MessageNotUnderstood), so the category cannot
 * ride in the subclass message. Instead the save path strips the category line,
 * compiles the remaining (always-valid) definition, and applies the category
 * separately via `Class>>category:`.
 *
 * These helpers keep that split/join pure and unit-testable, out of the
 * FileSystemProvider.
 */

// A `category: '<smalltalk-string>'` line (single-quote escapes doubled), possibly
// indented, on its own line. Anchored per-line so it matches wherever it sits.
const CATEGORY_LINE = /^[ \t]*category:[ \t]*'((?:[^']|'')*)'[ \t]*\r?\n?/m;

// GemStone's standard default class category. The New Class template always offers
// an editable category line so the user can set a category regardless of explorer
// selection; this is the value pre-filled when no category was selected.
export const DEFAULT_CLASS_CATEGORY = 'User Classes';

/**
 * Split a class-definition source into the compilable definition (the category
 * line removed) and the category value it carried (Smalltalk-unescaped), if any.
 * A source with no category line is returned unchanged with `category` undefined.
 */
export function splitOutCategory(source: string): { source: string; category?: string } {
  const m = CATEGORY_LINE.exec(source);
  if (!m) return { source };
  const category = m[1].replace(/''/g, "'");
  const stripped = source.replace(CATEGORY_LINE, '');
  return { source: stripped, category };
}

/**
 * Insert a `category: '<escaped>'` line into a class definition for display —
 * immediately before the `options:` line when present (matching the new-class
 * template's layout), otherwise appended. An empty category yields the definition
 * unchanged.
 */
export function withCategoryLine(definition: string, category: string): string {
  if (!category) return definition;
  const line = `  category: '${category.replace(/'/g, "''")}'`;
  const optionsMatch = /^[ \t]*options:/m.exec(definition);
  if (!optionsMatch) {
    return `${definition.replace(/\s*$/, '')}\n${line}\n`;
  }
  const at = optionsMatch.index;
  return `${definition.slice(0, at)}${line}\n${definition.slice(at)}`;
}

/** The class name a `<Super> subclass: 'Name' …` definition creates, or undefined
 *  if the source has no recognizable subclass clause. Used to pre-check whether a
 *  new-class save would collide with an existing class. */
export function classNameFromDefinition(source: string): string | undefined {
  const m = /\bsubclass:\s*'((?:[^']|'')*)'/.exec(source);
  return m ? m[1].replace(/''/g, "'") : undefined;
}

/** The symbol-dictionary name a `… inDictionary: <Name> …` definition targets, or
 *  undefined if absent. The value is a bareword (a SymbolDictionary global variable),
 *  not a quoted string, so the class can be created in a dictionary other than the
 *  one currently selected in the explorer — callers must target THIS dictionary for
 *  the post-compile categorize/reveal, not the selected one. */
export function dictNameFromDefinition(source: string): string | undefined {
  const m = /\binDictionary:\s*([A-Za-z_]\w*)/.exec(source);
  return m ? m[1] : undefined;
}
