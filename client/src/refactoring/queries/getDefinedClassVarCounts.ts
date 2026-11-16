import { NbQueryExecutor, QueryExecutor } from '../../queries/types';
import { splitLines, dictLookupExpr } from '../../queries/util';

// className → number of class variables DEFINED in that class (not inherited),
// for every class in a dictionary, in a single round trip. The mirror of
// getDefinedInstVarCounts: the two together decide whether a class row shows an
// expansion chevron for its variable sub-tree. Accepts a dictionary by 1-based index
// (canonical for Jasper) or by name.
export function getDefinedClassVarCounts(
  execute: QueryExecutor,
  dict: number | string,
): Map<string, number> {
  return parseDefinedClassVarCounts(execute(definedClassVarCountsCode(dict)));
}

export async function getDefinedClassVarCountsAsync(
  execute: NbQueryExecutor,
  dict: number | string,
): Promise<Map<string, number>> {
  return parseDefinedClassVarCounts(await execute(definedClassVarCountsCode(dict)));
}

function definedClassVarCountsCode(dict: number | string): string {
  const dictExpr = dictLookupExpr(dict);
  return `| ws dict |
dict := ${dictExpr}.
dict ifNil: [^ ''].
ws := WriteStream on: String new.
dict keysAndValuesDo: [:k :v |
  v isBehavior ifTrue: [
    | n |
    n := [v classVarNames size] on: Error do: [:e | 0].
    ws nextPutAll: k; tab; print: n; lf]].
ws contents`;
}

function parseDefinedClassVarCounts(raw: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of splitLines(raw)) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    map.set(line.slice(0, tab), parseInt(line.slice(tab + 1), 10) || 0);
  }
  return map;
}
