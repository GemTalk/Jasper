import { QueryExecutor } from './types';
import { splitLines, dictLookupExpr } from './util';

// className → number of instance variables DEFINED in that class (not inherited),
// for every class in a dictionary, in a single round trip. The GemStone Explorer
// uses this up front to decide whether a class row shows an expansion chevron for
// its variable sub-tree, so classes with no locally-defined variables stay flat.
// Accepts a dictionary by 1-based index (canonical for Jasper) or by name.
export function getDefinedInstVarCounts(
  execute: QueryExecutor,
  dict: number | string,
): Map<string, number> {
  const dictExpr = dictLookupExpr(dict);
  const code = `| ws dict |
dict := ${dictExpr}.
dict ifNil: [^ ''].
ws := WriteStream on: String new.
dict keysAndValuesDo: [:k :v |
  v isBehavior ifTrue: [
    | n |
    n := [v instVarNames size] on: Error do: [:e | 0].
    ws nextPutAll: k; tab; print: n; lf]].
ws contents`;
  const map = new Map<string, number>();
  for (const line of splitLines(execute(code))) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    map.set(line.slice(0, tab), parseInt(line.slice(tab + 1), 10) || 0);
  }
  return map;
}
