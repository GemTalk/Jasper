import { compareNames } from '../methodOrder';
import { QueryExecutor } from './types';
import { classLookupExpr, escapeString } from './util';

const DEFINITION_HEADING = '=== Definition ===';

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
//
// The stone sends the methods first, unsorted, as `i|c <tab> category [<tab> selector]` rows,
// then the definition and comment text; the method sections are built here so they follow
// methodOrder. Rows come first because the comment can contain any text.
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
{ cls -> 'i'. cls class -> 'c' } do: [:side |
  side key categoryNames do: [:cat |
    ws nextPutAll: side value; tab; nextPutAll: cat; lf.
    (side key selectorsIn: cat) do: [:sel |
      ws nextPutAll: side value; tab; nextPutAll: cat; tab; nextPutAll: sel; lf]]].
ws nextPutAll: '${DEFINITION_HEADING}'; lf.
ws nextPutAll: cls definition; lf; lf.
ws nextPutAll: '=== Comment ==='; lf.
ws nextPutAll: (cls comment ifNil: ['(no comment)']); lf; lf.
ws contents`;
  return formatDescription(execute(code));
}

function formatDescription(raw: string): string {
  const textStart = `\n${raw}`.indexOf(`\n${DEFINITION_HEADING}\n`);
  // No definition heading: the lookup failed and the answer is its message.
  if (textStart < 0) return raw;

  const sides = { i: new Map<string, string[]>(), c: new Map<string, string[]>() };
  for (const row of raw.slice(0, textStart).split('\n')) {
    const [side, category, selector] = row.split('\t');
    if (side !== 'i' && side !== 'c') continue;
    const selectors = sides[side].get(category) ?? [];
    if (selector !== undefined) selectors.push(selector);
    sides[side].set(category, selectors);
  }
  const section = (categories: Map<string, string[]>) =>
    [...categories.keys()]
      .sort(compareNames)
      .map((category) => {
        const selectors = categories.get(category)!.sort(compareNames);
        return `${category}:\n${selectors.map((s) => `  ${s}\n`).join('')}`;
      })
      .join('');
  return (
    raw.slice(textStart) +
    `=== Instance methods ===\n${section(sides.i)}` +
    `\n=== Class methods ===\n${section(sides.c)}`
  );
}
