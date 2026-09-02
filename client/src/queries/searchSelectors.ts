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
 * RANKED, not first-come. The scan collects matches into three tiers — the selector EQUALS the term,
 * the selector STARTS WITH it, the term appears somewhere else in it — and returns them in that
 * order, each tier capped at `limit`. That ordering is the whole point: the walk visits the symbol
 * list in dictionary-hash order, which has nothing to do with relevance, so a scan that simply
 * stopped at the first `limit` matches answered whichever classes it happened to reach first. A
 * search for `at:` filled its slice with `instVarAt:put:`, `floatAt:put:` and friends from two
 * incidental classes and never reached `Array>>at:` — the one row anybody typing `at:` wants
 * (issue #517). Tiering costs nothing extra to compute and makes the cut-off fall on the least
 * relevant rows instead of the last-visited ones.
 *
 * What it costs: the walk now runs to the end of the symbol list instead of quitting at the first
 * `limit` matches, because a better-tier match can appear anywhere in it. That was already the price
 * of any precise term (a term with fewer than `limit` matches never short-circuited), and measured on
 * a 3.6.2 base image (671 behaviours) a full walk for `at:` is ~27 ms against ~2 ms for the old
 * early exit. The one early exit still worth taking is a FULL EXACT tier: once `limit` selectors
 * equal the term, every row we would return is already an exact match and nothing later can displace
 * one, so the scan returns right there.
 *
 * Memory is bounded to 3 × `limit` rows on the server; `searchSelectors` then hands the caller at
 * most `limit` of them, best tier first — so `limit` still means what it always did (the most rows a
 * scan yields), and a caller that gets exactly `limit` still cannot tell a complete answer from a cut
 * off one, which is why `methodsProvider` reports truncation at that point.
 *
 * 3.6.2 discipline: uses `includesString:` (not `includesSubstring:`, which DNUs on 3.6.2) and
 * `asLowercase` folding; all generated source is ASCII.
 *
 * NO STRING `=` ANYWHERE, and that is not stylistic. `GciLibrary.execute` compiles our source with
 * the `Utf8` class as its string type, so every literal in this code — the needle included — is a
 * `Utf8`, while `sel asString` answers a `String`; comparing the two raises
 * `ArgumentError 2718, Unicode argument disallowed in String comparison` and the whole search fails.
 * `includesString:` is happy across the two classes, so the tier test is expressed with it and with
 * integer size comparisons: equal sizes plus a substring hit means the strings are equal, and a hit
 * inside the first `needle size` characters means the term is a prefix. (Should a non-ASCII term ever
 * make the two classes disagree about `size`, the only consequence is a row landing in a
 * neighbouring tier — the tier decides ORDER, never whether a row matches.)
 */
export interface SelectorSearchResult {
  dictName: string;
  className: string;
  isMeta: boolean;
  selector: string;
  category: string;
}

export interface SelectorSearchOptions {
  /** Max rows to collect per tier on the server, and the most rows `searchSelectors` returns. */
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
  // `^exact contents` inside the innermost block is a non-local return from the doit — it exits all
  // the loops at once the moment the exact tier is full (see the note above on why that is the only
  // safe early exit). The tier test runs before the row is built, so the per-row category lookup is
  // only paid for a row we are actually keeping. `copyFrom: 1 to: needle size` is always in range:
  // the enclosing `includesString:` already proved the term fits inside the selector.
  return `| exact prefixed other exactCount prefixCount otherCount sl needle |
exact := WriteStream on: String new.
prefixed := WriteStream on: String new.
other := WriteStream on: String new.
exactCount := 0.
prefixCount := 0.
otherCount := 0.
needle := ${needle}.
sl := System myUserProfile symbolList.
1 to: sl size do: [:idx | | dict |
  dict := sl at: idx.
  dict keysAndValuesDo: [:k :v |
    v isBehavior ifTrue: [
      #(false true) do: [:meta | | cls |
        cls := meta ifTrue: [v class] ifFalse: [v].
        cls selectors do: [:sel | | text ws |
          text := ${selText}.
          (text includesString: needle) ifTrue: [
            ws := nil.
            text size = needle size
              ifTrue: [
                exactCount < ${limit} ifTrue: [ws := exact. exactCount := exactCount + 1]]
              ifFalse: [
                ((text copyFrom: 1 to: needle size) includesString: needle)
                  ifTrue: [
                    prefixCount < ${limit} ifTrue: [ws := prefixed. prefixCount := prefixCount + 1]]
                  ifFalse: [
                    otherCount < ${limit} ifTrue: [ws := other. otherCount := otherCount + 1]]].
            ws == nil ifFalse: [
              ws nextPutAll: dict name; tab;
                 nextPutAll: k; tab;
                 nextPutAll: (meta ifTrue: ['1'] ifFalse: ['0']); tab;
                 nextPutAll: sel asString; tab;
                 nextPutAll: ((cls categoryOfSelector: sel environmentId: ${envId}) ifNil: ['']); lf].
            exactCount >= ${limit} ifTrue: [^exact contents]]]]]]].
exact contents, prefixed contents, other contents`;
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
  // The server caps each TIER at `limit`, so up to 3 × `limit` rows can come back. Keep the first
  // `limit` of them: the rows arrive best tier first, so this drops the least relevant matches rather
  // than the last-visited ones, and `limit` keeps its documented meaning for every caller.
  const limit = Math.max(1, Math.trunc(opts.limit));
  return parseSelectorSearchResults(execute(buildSelectorSearchCode(term, opts))).slice(0, limit);
}
