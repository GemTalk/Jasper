/**
 * The "one doit streams an escaped tab/newline payload" convention.
 *
 * Several features need many objects' printStrings in one GCI round trip rather
 * than one call per object. They all use the same wire format: one record per
 * line, fields separated by tabs, with any field that could itself contain a
 * delimiter escaped server-side. This module owns both halves of that format —
 * the Smalltalk that writes it and the TypeScript that reads it — so the escape
 * and un-escape rules cannot drift apart.
 *
 * Callers: `fetchStackDump` and `fetchFrameVariables` in debugQueries.ts, and the
 * basic inspector's queries.
 */

/** Chars a single field is capped at server-side before `...` is appended. */
export const DEFAULT_MAX_FIELD_CHARS = 2000;

/**
 * Smalltalk temps {@link dumpPayloadPrelude} assigns. A doit using the prelude
 * must declare these in its own `| ... |` line, alongside its own temps.
 */
export const DUMP_PAYLOAD_TEMPS = 'tab esc psOf';

/**
 * Smalltalk statements that set up the payload writers. Assigns:
 *
 *  - `tab`  — the field separator.
 *  - `esc`  — one-arg block: cap a string at `maxFieldChars` then escape
 *             backslash, tab, lf and cr. Backslash goes FIRST so an escape it
 *             introduces isn't re-escaped by a later replacement.
 *  - `psOf` — one-arg block: an object's escaped printString, or `<unprintable>`
 *             if printing raises.
 *
 * Emitted with a trailing newline, so a caller can concatenate its own
 * statements straight after. Read back with {@link unescapeDumpField}.
 */
export function dumpPayloadPrelude(maxFieldChars: number = DEFAULT_MAX_FIELD_CHARS): string {
  return `tab := String with: Character tab.
esc := [:str | | s |
  s := str.
  s size > ${maxFieldChars} ifTrue: [s := (s copyFrom: 1 to: ${maxFieldChars}), '...'].
  s := s copyReplaceAll: (String with: $\\) with: '\\\\'.
  s := s copyReplaceAll: tab with: '\\t'.
  s := s copyReplaceAll: (String with: Character lf) with: '\\n'.
  s := s copyReplaceAll: (String with: Character cr) with: '\\r'.
  s].
psOf := [:obj | esc value: ([obj printString] on: Error do: [:e | '<unprintable>'])].
`;
}

/**
 * Reverse {@link dumpPayloadPrelude}'s `esc`: `\\` `\t` `\n` `\r`. Single pass, so
 * a backslash the un-escaping introduces can't be re-interpreted as the start of
 * another escape.
 */
export function unescapeDumpField(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      const n = s[++i];
      out += n === 't' ? '\t' : n === 'n' ? '\n' : n === 'r' ? '\r' : n;
    } else {
      out += s[i];
    }
  }
  return out;
}

/**
 * Split a payload into records of raw (still-escaped) fields, dropping blank
 * lines and any record with fewer than `minFields` fields. Parsing is
 * best-effort by design: a malformed record is skipped rather than throwing, so
 * one bad row can't cost the caller the whole payload.
 */
export function splitDumpRows(data: string, minFields: number): string[][] {
  const rows: string[][] = [];
  if (!data) return rows;
  for (const line of data.split('\n')) {
    if (line.length === 0) continue;
    const fields = line.split('\t');
    if (fields.length < minFields) continue;
    rows.push(fields);
  }
  return rows;
}
