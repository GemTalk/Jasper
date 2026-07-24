import { QueryExecutor } from './types';
import { classLookupExpr, escapeString } from './util';

// Combined class description: definition (which embeds superclass, instVars,
// classVars, classInstVars, pools, dictionary), comment, and methods grouped
// by category for both sides. A single round trip — designed for agent use
// where Claude wants enough context to decide whether this is the class it
// cares about without multiple follow-up queries.
//
// Returns structured human-readable text. Own methods only (not inherited)
// to keep output bounded even for classes deep in the hierarchy.
//
// `dict` is optional; when given (1-based index or name), disambiguates
// shadowed class names. Without it, falls back to `objectNamed:` — the
// first match in the user's symbolList.
export function describeClass(
  execute: QueryExecutor,
  className: string,
  dict?: number | string,
): string {
  const esc = escapeString(className);
  const code = `| cls ws |
cls := ${classLookupExpr(className, dict)}.
cls ifNil: [^ 'Class not found: ${esc}'].
cls isBehavior ifFalse: [^ 'Not a class: ${esc}'].
ws := WriteStream on: Unicode7 new.
ws nextPutAll: '=== Definition ==='; lf.
ws nextPutAll: cls definition; lf; lf.
ws nextPutAll: '=== Comment ==='; lf.
ws nextPutAll: (cls comment ifNil: ['(no comment)']); lf; lf.
ws nextPutAll: '=== Instance methods ==='; lf.
cls categoryNames asSortedCollection do: [:cat |
  ws nextPutAll: cat; nextPutAll: ':'; lf.
  (cls sortedSelectorsIn: cat) do: [:sel |
    ws nextPutAll: '  '; nextPutAll: sel; lf]].
ws lf.
ws nextPutAll: '=== Class methods ==='; lf.
cls class categoryNames asSortedCollection do: [:cat |
  ws nextPutAll: cat; nextPutAll: ':'; lf.
  (cls class sortedSelectorsIn: cat) do: [:sel |
    ws nextPutAll: '  '; nextPutAll: sel; lf]].
ws contents`;
  return execute(code);
}
