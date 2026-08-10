export function escapeString(s: string): string {
  return s.replace(/'/g, "''");
}

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
// `ifNil:` to handle the missing case. This is the ONE place that knows how to
// resolve a dictionary within the symbol list — do not hand-roll
// `System myUserProfile symbolList at:/objectNamed:` for a caller-supplied dict
// elsewhere (see the duplication guard test). To resolve a CLASS within a
// dictionary, use classLookupExpr instead.
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
