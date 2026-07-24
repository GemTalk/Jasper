import { QueryExecutor } from './types';
import { escapeString } from './util';

export interface EnvCategoryLine {
  isMeta: boolean;
  envId: number;
  category: string;
  selectors: string[];
  // Per-selector override bitmask keyed by bare selector: bit 1 = overrides a
  // superclass impl (▲), bit 2 = overridden in a subclass (▼). Selectors with
  // no indicator are absent. Always populated by the parser below.
  methodOverrideBits?: Record<string, number>;
  // Per-selector session-method flag keyed by bare selector: 1 = session
  // extension (installed only in the transient dict — adds new behavior),
  // 2 = session override (also present in the persistent dict — shadows a base
  // method). Absent = not a session method. Populated whenever the stone has
  // session methods installed on the browsed class (see SessionMethods design).
  sessionMethodBits?: Record<string, number>;
}

export function getClassEnvironments(
  execute: QueryExecutor,
  dictIndex: number,
  className: string,
  maxEnv: number,
): EnvCategoryLine[] {
  // Each emitted selector token is prefixed with a fixed 2-digit flag byte
  // (00..15) so the indicators ride along on the existing method-list round
  // trip: bit 1 = overrides super (▲), bit 2 = overridden in a subclass (▼),
  // bit 4 = session method, bit 8 = session override (also in the persistent
  // dict). Two digits because the four bits can co-occur (max 15); selectors
  // never begin with a digit, so a 2-char numeric prefix is unambiguous.
  // "Overridden in a subclass" is computed once by intersecting subclass-local
  // selectors with this class's own selectors, so the working set stays small
  // even for classes with thousands of subclasses (e.g. Object). Session state
  // is read via `at:otherwise:` (NOT `includesKey:`) because the transient dict
  // is a GsSessionMethodDictionary whose lookup methods are <protected>.
  const code = `| class envs stream instOwn metaOwn instSub metaSub |
envs := ${maxEnv}.
class := (System myUserProfile symbolList at: ${dictIndex}) at: #'${escapeString(className)}'.
instOwn := class selectors asIdentitySet.
metaOwn := class class selectors asIdentitySet.
instSub := IdentitySet new.
metaSub := IdentitySet new.
class allSubclasses do: [:sub |
  sub selectors do: [:s | (instOwn includes: s) ifTrue: [instSub add: s]].
  sub class selectors do: [:s | (metaOwn includes: s) ifTrue: [metaSub add: s]]].
stream := WriteStream on: Unicode7 new.
{ class class. class. } doWithIndex: [:eachClass :idx |
  | isMeta subSel superCls |
  isMeta := idx = 1.
  subSel := isMeta ifTrue: [metaSub] ifFalse: [instSub].
  superCls := eachClass superclass.
  0 to: envs do: [:env |
    | trDict prDict |
    trDict := eachClass transientMethodDictForEnv: env.
    prDict := eachClass persistentMethodDictForEnv: env.
    (eachClass _unifiedCategorys: env) keysAndValuesDo: [:categoryName :selectors |
      stream
        nextPutAll: eachClass name; tab;
        nextPutAll: env printString; tab;
        nextPutAll: categoryName; tab;
        yourself.
      selectors do: [:each | | up down sess flag |
        up := superCls notNil and: [(superCls whichClassIncludesSelector: each) notNil].
        down := subSel includes: each.
        "Session method iff present in the transient dict (read via at:otherwise:,
         the transient dict's includesKey: is <protected>). Override iff the
         persistent dict also has it, else a session-only extension."
        sess := trDict notNil and: [(trDict at: each otherwise: nil) notNil].
        flag := (up ifTrue: [1] ifFalse: [0]) + (down ifTrue: [2] ifFalse: [0]).
        sess ifTrue: [
          flag := flag + 4.
          (prDict notNil and: [prDict includesKey: each]) ifTrue: [flag := flag + 8].
        ].
        flag < 10 ifTrue: [stream nextPut: $0].
        stream nextPutAll: flag printString; nextPutAll: each; tab.
      ].
      stream lf.
    ].
  ].
].
stream contents`;

  const raw = execute(code);

  const results: EnvCategoryLine[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t').filter((s) => s.length > 0);
    if (parts.length < 3) continue;
    const receiverName = parts[0];
    const envId = parseInt(parts[1], 10);
    const category = parts[2];
    const methodOverrideBits: Record<string, number> = {};
    const sessionMethodBits: Record<string, number> = {};
    const selectors = parts
      .slice(3)
      .map((tok) => {
        // Leading 2 digits are the flag byte: bit 1 = overrides super, bit 2 =
        // overridden in subclass, bit 4 = session method, bit 8 = session
        // override (also in persistent dict).
        const flag = Number(tok.slice(0, 2));
        const sel = tok.slice(2);
        const overrideBits = flag & 3;
        if (overrideBits) methodOverrideBits[sel] = overrideBits;
        if (flag & 4) sessionMethodBits[sel] = flag & 8 ? 2 : 1;
        return sel;
      })
      .sort();
    const isMeta = receiverName.endsWith(' class');
    results.push({ isMeta, envId, category, selectors, methodOverrideBits, sessionMethodBits });
  }
  return results;
}
