import { QueryExecutor } from './types';
import { escapeString } from './util';

/**
 * Find compiled methods whose SELECTOR matches a substring, across every class in the user's
 * symbol list (instance and class side). This is the backend for GemStone Search's "Methods" category
 * (issue #378) and is intended to be reused, scoped, by the Explorer method-signature search
 * (issue #377).
 *
 * Result rows are tab-separated `dictName<TAB>className<TAB>isMeta(0|1)<TAB>selector<TAB>category`,
 * matching the shape `methodSearch.ts` already uses, so the client parse is identical.
 *
 * Bounded on purpose: the scan stops (`^ws contents`) as soon as `limit` matches are collected, so
 * a common term returns quickly instead of walking every selector in the image. A smarter global
 * selector index is a documented follow-up; this bounded scan is the basic implementation.
 *
 * 3.6.2 discipline: uses `includesString:` (not `includesSubstring:`, which DNUs on 3.6.2) and
 * `asLowercase` folding; all generated source is ASCII.
 */
export interface SelectorSearchResult {
  dictName: string;
  className: string;
  isMeta: boolean;
  selector: string;
  category: string;
}

export interface SelectorSearchOptions {
  /** Max rows to collect before the scan short-circuits. */
  limit: number;
  /** When true (the default for omni), fold case on both sides before comparing. */
  ignoreCase: boolean;
  /** environmentId for category lookup; 0 is the base environment. */
  environmentId?: number;
}

export function buildSelectorSearchCode(term: string, opts: SelectorSearchOptions): string {
  const envId = opts.environmentId ?? 0;
  const limit = Math.max(1, Math.trunc(opts.limit));
  const needle = opts.ignoreCase
    ? `'${escapeString(term)}' asLowercase`
    : `'${escapeString(term)}'`;
  const selText = opts.ignoreCase ? 'sel asString asLowercase' : 'sel asString';
  // A `^ws contents` inside the innermost block is a non-local return from the doit — it exits all
  // the loops at once the moment the limit is reached.
  return `| ws sl count needle |
ws := WriteStream on: String new.
count := 0.
needle := ${needle}.
sl := System myUserProfile symbolList.
1 to: sl size do: [:idx | | dict |
  dict := sl at: idx.
  dict keysAndValuesDo: [:k :v |
    v isBehavior ifTrue: [
      #(false true) do: [:meta | | cls |
        cls := meta ifTrue: [v class] ifFalse: [v].
        cls selectors do: [:sel |
          (${selText} includesString: needle) ifTrue: [
            ws nextPutAll: dict name; tab;
               nextPutAll: k; tab;
               nextPutAll: (meta ifTrue: ['1'] ifFalse: ['0']); tab;
               nextPutAll: sel asString; tab;
               nextPutAll: ((cls categoryOfSelector: sel environmentId: ${envId}) ifNil: ['']); lf.
            count := count + 1.
            count >= ${limit} ifTrue: [^ws contents]]]]]]].
ws contents`;
}

export function parseSelectorSearchResults(raw: string): SelectorSearchResult[] {
  const results: SelectorSearchResult[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 5) continue;
    results.push({
      dictName: parts[0],
      className: parts[1],
      isMeta: parts[2] === '1',
      selector: parts[3],
      category: parts[4],
    });
  }
  return results;
}

export function searchSelectors(
  execute: QueryExecutor,
  term: string,
  opts: SelectorSearchOptions,
): SelectorSearchResult[] {
  return parseSelectorSearchResults(execute(buildSelectorSearchCode(term, opts)));
}
