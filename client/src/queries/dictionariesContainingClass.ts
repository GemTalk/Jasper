// Which symbol dictionaries hold a class of this name, in symbol-list order.
//
// A plain symbol-list walk: no Rowan, nothing version-specific, so it answers on
// any stone. Tonel file in is its first caller but has no claim on it — it needs
// the default target dictionary (Tonel carries none, since `#category` is a
// PACKAGE) and needs to know whether a superclass resolves before creating
// anything.
//
// Order is the session's own symbol-list order, because that is what an
// unqualified name binds to — a caller picking a default must see the same order
// the image would use.
//
// `isBehavior` is the filter, not mere presence: a SymbolDictionary can hold
// anything, and a global that happens to share the class's name is not the class
// living there.
import { QueryExecutor } from './types';
import { escapeString, splitLines } from './util';

/**
 * Names of the dictionaries holding a class called `className`, in the session's
 * symbol-list order. Empty when no dictionary holds one.
 *
 * Answers only Behaviors: a non-class global of the same name is not a hit.
 *
 * Works on any stone — this asks the symbol list, not Rowan.
 */
export function dictionariesContainingClass(execute: QueryExecutor, className: string): string[] {
  const code = `| ws |
ws := WriteStream on: String new.
System myUserProfile symbolList do: [:d | | found |
  found := d at: #'${escapeString(className)}' ifAbsent: [nil].
  (found notNil and: [found isBehavior])
    ifTrue: [ws nextPutAll: d name asString; lf]].
ws contents`;
  return splitLines(execute(code))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
