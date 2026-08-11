export function escapeString(s: string): string {
  return s.replace(/'/g, "''");
}

// Unicode7 gotcha for generated Smalltalk (GemStone 3.6.x). Every string literal inside a
// GCI-executed doit compiles to Unicode7, and comparing an image-derived value against one
// misbehaves: `Symbol = 'lit'` silently answers false, and `String = 'lit'` raises ArgumentError
// 2718 — so class/method/dictionary sync and export failed outright on 3.6.x clients (issues #399,
// #400). The safe idiom is to compare interned Symbols: `someName asSymbol == #Lit`. When the
// image value may be nil (e.g. an unnamed SymbolDictionary — `SymbolDictionary new name` is nil),
// go through asString first: `name asString asSymbol == #Lit`, so nil answers #nil instead of a
// `nil asSymbol` doesNotUnderstand. Never write a plain `= 'literal'` against an image-derived
// value in a doit; 3.7.x tolerates it, so a reverted idiom only breaks at a 3.6.x client site.

// A Smalltalk expression for the class (or its metaclass) that receives a
// method-level operation. `dict` (a 1-based SymbolList index, or a name) scopes
// the resolution to a specific dictionary so the same key in two dictionaries
// resolves to the intended class; without it, the bare class name is resolved as
// a global (first match in the symbol list).
export function receiver(className: string, isMeta: boolean, dict?: number | string): string {
  const base = dict === undefined ? className : `(${classLookupExpr(className, dict)})`;
  return isMeta ? `${base} class` : base;
}

export function splitLines(result: string): string[] {
  return result.split('\n').filter((s) => s.length > 0);
}

export function compiledMethodExpr(
  className: string,
  isMeta: boolean,
  selector: string,
  environmentId: number,
  dict?: number | string,
): string {
  return `(${receiver(className, isMeta, dict)} compiledMethodAt: #'${escapeString(selector)}' environmentId: ${environmentId})`;
}

// A Smalltalk expression resolving the SymbolDictionary identified by `dict` — a
// 1-based SymbolList index (unambiguous) or a name (first match). Evaluates to the
// dictionary, or **nil** when there is no such dictionary (an out-of-range index or
// an unbound name) — both branches are uniformly nil-on-absent, so callers just
// `ifNil:` to handle the missing case with a clean refusal string.
//
// Why the numeric branch answers nil rather than letting the raw `at:` raise: a
// numeric index does come from Jasper's own tree (a live SymbolList position), so
// out-of-range only happens when that tree has gone stale — a dictionary earlier in
// the list was removed and this node hasn't refreshed yet. Letting `at:` raise there
// doesn't produce a tidy "programming error" — it unwinds the doit before the caller's
// `ifNil:` guard, and executeFetchString rethrows the raw GemStone index-out-of-range
// as a walkback notification. Answering nil instead lets the caller show its clean
// refusal (and a refresh recovers). The one cost: a stale index resolves as an *empty*
// dictionary in the read queries (getClassNames et al. answer '' on nil), which looks
// like a dictionary that legitimately has no classes — also self-correcting on refresh.
// classLookupExpr (below) shares this preference for a clean answer over a walkback but
// deliberately lands the opposite way on its numeric branch — see its NB for why.
//
// This is the ONE place that knows how to resolve a dictionary within the symbol
// list — do not hand-roll `System myUserProfile symbolList at:/objectNamed:` for a
// caller-supplied dict elsewhere (see the duplication guard test). To resolve a CLASS
// within a dictionary, use classLookupExpr instead.
export function dictLookupExpr(dict: number | string): string {
  return typeof dict === 'number'
    ? `System myUserProfile symbolList at: ${dict} ifAbsent: [nil]`
    : `System myUserProfile symbolList objectNamed: #'${escapeString(dict)}'`;
}

// Compose a Smalltalk expression that resolves a class by name, optionally
// scoped to a specific dictionary (by 1-based index or by name). Evaluates to
// the class OOP, or nil if not found. Callers should `ifNil:` to handle the
// missing case.
//
// Why "optionally scoped": a user's symbolList is an ordered list of
// SymbolDictionaries; `objectNamed:` returns the first match and shadows
// later entries with the same name. When a caller knows which dictionary it
// wants (e.g. Jasper's class browser walking a tree), dict-scoped lookup
// hits the specific class even when shadowed.
export function classLookupExpr(className: string, dict?: number | string): string {
  const esc = escapeString(className);
  if (dict === undefined) {
    return `System myUserProfile symbolList objectNamed: #'${esc}'`;
  }
  // Prefer a 1-based SymbolList index (unambiguous — two dictionaries can share a
  // name). A number scopes to exactly that dictionary; a name is a best-effort
  // fallback for callers that only have a name (e.g. some MCP tools).
  //
  // NB: unlike dictLookupExpr (above), the index branch here does NOT `ifAbsent:` the
  // outer `at:` — an out-of-range dictionary index raises rather than answering nil.
  // Both helpers prefer a clean answer over a raw walkback; they diverge only because
  // guarding is cheap for one and awkward for the other. dictLookupExpr returns the
  // dictionary directly, so `at: N ifAbsent: [nil]` is a trivial nil-on-absent. Here the
  // outer `at:` is the RECEIVER of a further `at: #'class' ifAbsent:`, so nil-guarding it
  // would mean wrapping the whole thing in `ifNotNil:` (else `nil at:ifAbsent:` DNUs) —
  // structure the string branch below already has to carry, but the index branch would
  // otherwise not. We accept the raise on the index branch because out-of-range there is
  // the same rare stale-tree race dictLookupExpr describes (a live SymbolList position
  // whose tree hasn't refreshed), recoverable by a refresh — not worth the extra wrap on
  // the common path. The name branch DOES guard, because a name genuinely may not resolve.
  // The inner `at: #'class' ifAbsent: [nil]` still returns nil when the dictionary exists
  // but the class isn't in it.
  if (typeof dict === 'number') {
    return `(System myUserProfile symbolList at: ${dict}) at: #'${esc}' ifAbsent: [nil]`;
  }
  return `(System myUserProfile symbolList objectNamed: #'${escapeString(dict)}') ifNotNil: [:d | d at: #'${esc}' ifAbsent: [nil]]`;
}

// Smalltalk statements that bind `cls` to the dictionary-scoped class and raise
// a clear "not found" error if it's absent — the resolve-or-raise preamble
// shared by the SUnit run/discover queries. The caller must declare `cls` in
// its temps and use it afterward; the `^Error signal:` short-circuits the doit
// when the class can't be resolved (so the tool surfaces a clean error rather
// than sending messages to nil).
export function classLookupOrRaiseExpr(className: string, dictName?: string): string {
  const esc = escapeString(className);
  const where = dictName ? ` in dictionary ${escapeString(dictName)}` : '';
  return `cls := ${classLookupExpr(className, dictName)}.
cls isNil ifTrue: [^Error signal: 'Test class ${esc}${where} not found'].`;
}
