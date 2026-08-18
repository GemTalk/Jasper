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
//
// Present-but-blank counts as NO comment. Emptying the editor and saving stores
// `''` rather than removing the key, so a bare nil test kept offering a button that
// opened an empty document — the very promise item 11 set out to stop making. The
// test is "any non-whitespace character", not `isEmpty not`, because a save can
// leave a lone newline behind (VS Code's insert-final-newline) and a comment of
// pure whitespace is no more readable than none.
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
    cmt := [(v _extraDictAt: #comment)
              ifNil: [false]
              ifNotNil: [:c | (c detect: [:ch | ch isSeparator not] ifNone: [nil]) notNil]]
            on: Error do: [:e | false].
    ws nextPutAll: cat asString; tab;
       nextPutAll: (cmt ifTrue: ['1'] ifFalse: ['0']); tab;
       nextPutAll: k; lf]].
ws contents`;
  // Parsed from the RIGHT. A class name cannot contain a tab, but a class category
  // is free text and conceivably could, so anchoring on the first two tabs would let
  // one category shift the flag and the name a field over. The last tab always ends
  // the flag, the one before it always ends the category.
  return splitLines(execute(code)).map((line) => {
    const nameTab = line.lastIndexOf('\t');
    const flagTab = line.lastIndexOf('\t', nameTab - 1);
    return {
      category: line.slice(0, flagTab),
      hasComment: line.slice(flagTab + 1, nameTab) === '1',
      className: line.slice(nameTab + 1),
    };
  });
}
