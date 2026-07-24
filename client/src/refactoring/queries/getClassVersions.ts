import { QueryExecutor } from '../../queries/types';
import { escapeString, splitLines } from '../../queries/util';

/** A class's position in its class history: the 1-based index of the currently
 *  bound version and the total number of versions. Rendered as `[current/total]`. */
export interface ClassVersionInfo {
  current: number;
  total: number;
}

// className → {current,total}, for every class in a dictionary whose class has
// MORE THAN ONE version in its class history, in a single round trip. Classes
// with a single version are omitted, so the Explorer renders them with no version
// tag; a returned entry means "show `Foo[current/total]`", where current is the
// 1-based position of the dictionary's class within its class history (base = 1)
// and total is the history size. The GemStone Explorer uses this to make
// recompiled/reshaped class versions visible at a glance. Accepts a dictionary by
// 1-based index (canonical for Jasper) or by name.
export function getClassVersions(
  execute: QueryExecutor,
  dict: number | string,
): Map<string, ClassVersionInfo> {
  const dictExpr =
    typeof dict === 'number'
      ? `System myUserProfile symbolList at: ${dict}`
      : `System myUserProfile symbolList objectNamed: #'${escapeString(dict)}'`;
  const code = `| ws dict |
dict := ${dictExpr}.
dict ifNil: [^ ''].
ws := WriteStream on: String new.
dict keysAndValuesDo: [:k :v |
  v isBehavior ifTrue: [
    | hist |
    hist := [v classHistory] on: Error do: [:e | nil].
    (hist notNil and: [hist size > 1]) ifTrue: [
      ws nextPutAll: k; tab; print: (hist indexOf: v); tab; print: hist size; lf]]].
ws contents`;
  const map = new Map<string, ClassVersionInfo>();
  for (const line of splitLines(execute(code))) {
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const current = parseInt(parts[1], 10);
    const total = parseInt(parts[2], 10);
    if (current > 0 && total > 0) map.set(parts[0], { current, total });
  }
  return map;
}
