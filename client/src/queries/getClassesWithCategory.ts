import { QueryExecutor } from './types';
import { escapeString, splitLines } from './util';

export interface ClassCategoryEntry {
  className: string;
  category: string;
}

// Lists every class in a dictionary paired with its class-category, so the
// GemStone Explorer can build a distinct-categories pane and a classes-in-category
// pane from a single fetch. Accepts a dictionary by 1-based index (canonical
// for Jasper) or by name (convenient for callers that skip enumeration).
// Classes whose category is nil/empty are reported under 'as yet unclassified'.
export function getClassesWithCategory(
  execute: QueryExecutor,
  dict: number | string,
): ClassCategoryEntry[] {
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
    | cat |
    cat := [v category] on: Error do: [:e | nil].
    (cat isNil or: [cat isEmpty]) ifTrue: [cat := 'as yet unclassified'].
    ws nextPutAll: cat asString; tab; nextPutAll: k; lf]].
ws contents`;
  return splitLines(execute(code)).map((line) => {
    const tab = line.indexOf('\t');
    return {
      category: line.slice(0, tab),
      className: line.slice(tab + 1),
    };
  });
}
