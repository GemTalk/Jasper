import { QueryExecutor } from './types';
import { splitLines, dictLookupExpr } from './util';

export interface ClassCategoryEntry {
  className: string;
  category: string;
  hasComment: boolean;
}

// Lists every class in a dictionary paired with its class-category, so the
// GemStone Explorer can build a distinct-categories pane and a classes-in-category
// pane from a single fetch. Accepts a dictionary by 1-based index (canonical
// for Jasper) or by name (convenient for callers that skip enumeration).
// Classes whose category is nil/empty are reported under 'as yet unclassified'.
//
// Each entry also reports whether the class carries a real comment, so the
// Explorer can withhold the comment button on classes that have none (#387 item
// 11). The test is the `#comment` key in the class's extra dict, NOT `Class>>
// comment`: since 3.1 that accessor SYNTHESISES a placeholder ("No class-specific
// documentation for X…", plus a rendered hierarchy) when the key is absent, so it
// never returns nil or empty and cannot answer "is there a comment?". Reading the
// key is also the cheaper of the two — measured at ~0.12µs per class, so adding it
// to this existing per-class loop costs nothing noticeable even on a large
// dictionary, and adds no round trip.
export function getClassesWithCategory(
  execute: QueryExecutor,
  dict: number | string,
): ClassCategoryEntry[] {
  const dictExpr = dictLookupExpr(dict);
  const code = `| ws dict |
dict := ${dictExpr}.
dict ifNil: [^ ''].
ws := WriteStream on: String new.
dict keysAndValuesDo: [:k :v |
  v isBehavior ifTrue: [
    | cat cmt |
    cat := [v category] on: Error do: [:e | nil].
    (cat isNil or: [cat isEmpty]) ifTrue: [cat := 'as yet unclassified'].
    cmt := [(v _extraDictAt: #comment) notNil] on: Error do: [:e | false].
    ws nextPutAll: cat asString; tab;
       nextPutAll: (cmt ifTrue: ['1'] ifFalse: ['0']); tab;
       nextPutAll: k; lf]].
ws contents`;
  return splitLines(execute(code)).map((line) => {
    const tab = line.indexOf('\t');
    const tab2 = line.indexOf('\t', tab + 1);
    return {
      category: line.slice(0, tab),
      hasComment: line.slice(tab + 1, tab2) === '1',
      className: line.slice(tab2 + 1),
    };
  });
}
