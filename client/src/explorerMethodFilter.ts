import { filterMatches } from './explorerFilter';

// A parsed Methods-pane filter. The plain (non-token) part is a prefix/`*`
// pattern on the selector; `reads:`/`writes:`/`accesses:` tokens constrain by
// which instance variables a method reads or writes.
export interface MethodFilter {
  selector?: string;
  ivar: IvarConstraint[];
}

export interface IvarConstraint {
  kind: 'reads' | 'writes' | 'accesses';
  pattern: string;
}

const TOKEN = /^(reads|writes|accesses):(.*)$/i;

// Parse a raw filter string. Whitespace separates terms: a `reads:x` / `writes:x`
// / `accesses:x` term becomes an ivar constraint (x is a prefix/`*` pattern on
// the ivar name); any other term is the selector prefix (last one wins — a
// selector carries no spaces, so there is normally at most one).
export function parseMethodFilter(raw: string): MethodFilter {
  const ivar: IvarConstraint[] = [];
  let selector: string | undefined;
  for (const term of raw.split(/\s+/)) {
    if (term.length === 0) continue;
    const m = TOKEN.exec(term);
    if (m && m[2].length > 0) {
      ivar.push({ kind: m[1].toLowerCase() as IvarConstraint['kind'], pattern: m[2] });
    } else {
      selector = term;
    }
  }
  return { selector, ivar };
}

type Access = { reads: string[]; writes: string[] } | undefined;

function namesFor(kind: IvarConstraint['kind'], access: Access): string[] {
  if (kind === 'reads') return access?.reads ?? [];
  if (kind === 'writes') return access?.writes ?? [];
  return [...(access?.reads ?? []), ...(access?.writes ?? [])];
}

// Whether a method matches: its selector against the prefix (if any) AND every
// ivar constraint against the method's read/write sets.
export function methodMatchesFilter(
  filter: MethodFilter,
  selector: string,
  access: Access,
): boolean {
  if (filter.selector !== undefined && !filterMatches(selector, filter.selector)) return false;
  return filter.ivar.every((c) =>
    namesFor(c.kind, access).some((n) => filterMatches(n, c.pattern)),
  );
}

// Whole-identifier occurrences of any of `names` in `text`, as [start, end)
// offset pairs — used to highlight the filtered instance variable(s) in an
// opened method source. Matches identifier tokens only, so it won't light up a
// substring inside a larger name (e.g. `origin` inside `origins`).
export function ivarIdentifierRanges(text: string, names: string[]): Array<[number, number]> {
  if (names.length === 0) return [];
  const want = new Set(names);
  const ranges: Array<[number, number]> = [];
  const re = /[A-Za-z_][A-Za-z0-9_]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (want.has(m[0])) ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

// The r/w/rw marker for a method under an ivar filter — does it read and/or write
// an ivar the filter names? Undefined when the filter has no ivar constraints.
export function ivarAccessMark(filter: MethodFilter, access: Access): 'r' | 'w' | 'rw' | undefined {
  if (filter.ivar.length === 0) return undefined;
  const patterns = filter.ivar.map((c) => c.pattern);
  const hit = (names: string[] | undefined): boolean =>
    (names ?? []).some((n) => patterns.some((p) => filterMatches(n, p)));
  const r = hit(access?.reads);
  const w = hit(access?.writes);
  return r && w ? 'rw' : r ? 'r' : w ? 'w' : undefined;
}
