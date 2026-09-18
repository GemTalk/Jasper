// ─────────────────────────────────────────────────────────────────────────────
// SUPPORTED CONFIGURATION — Tonel file out / file in (issue #616)
//
//   GemStone 3.7.5 and later, on a **rowan3** extent. Nothing else.
//
// Full statement, and the reasoning: ./tonelCapability.ts
// ─────────────────────────────────────────────────────────────────────────────
//
// Which symbol dictionaries hold a class of this name, in symbol-list order.
//
// File in asks this twice:
//
//   * to default the target dictionary to the one the class already lives in —
//     Tonel carries no dictionary (`#category` is a PACKAGE), so it has to come
//     from the image or from the user;
//   * to decide whether a superclass resolves at all, before anything is created.
//
// Order is the session's own symbol-list order, because that is what an
// unqualified name binds to — a caller picking a default must see the same order
// the image would use.
//
// `isBehavior` is the filter, not mere presence: a SymbolDictionary can hold
// anything, and a global that happens to share the class's name is not the class
// living there.
import { QueryExecutor } from '../types';
import { escapeString, splitLines } from '../util';

/** Names of the dictionaries holding a class called `className`, in symbol-list order. */
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
