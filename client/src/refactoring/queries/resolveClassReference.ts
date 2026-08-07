import { QueryExecutor } from '../../queries/types';
import { escapeString, splitLines } from '../../queries/util';

/** A class reference resolved from a name at the cursor: the class's own name plus
 *  the 1-based SymbolList index that binds it (0 when it is not bound by its own
 *  name — the caller falls back to a whole-symbol-list scope). */
export interface ClassReference {
  className: string;
  dictIndex: number;
}

/** Resolve `name` as the running image would from a method body — across the whole
 *  symbol list — and answer it only when it names a Class (not a plain
 *  global/shared variable such as `Transcript`, and not an unbound name), together
 *  with the SymbolList index binding it. `undefined` when `name` is not a class.
 *
 *  Resolution is deliberately unscoped: a class referenced in a method resolves the
 *  way the compiler resolved it, which may be a different dictionary than the one
 *  the editor's class lives in. */
export function resolveClassReference(
  execute: QueryExecutor,
  name: string,
): ClassReference | undefined {
  const code = `| obj |
obj := System myUserProfile symbolList objectNamed: '${escapeString(name)}' asSymbol.
(obj isNil or: [(obj isKindOf: Class) not])
  ifTrue: ['']
  ifFalse: [ | sym idx |
    sym := System myUserProfile symbolList.
    idx := 0.
    1 to: sym size do: [:i |
      (idx = 0 and: [((sym at: i) at: obj name asSymbol ifAbsent: [nil]) == obj])
        ifTrue: [idx := i]].
    obj name asString, (String with: Character lf), idx printString ]`;
  const lines = splitLines(execute(code));
  if (lines.length === 0) return undefined;
  const dictIndex = lines.length > 1 ? Number(lines[1]) : 0;
  return { className: lines[0], dictIndex: Number.isFinite(dictIndex) ? dictIndex : 0 };
}
