import { QueryExecutor } from './types';
import { splitLines, dictLookupExpr } from './util';
import { hasRealCommentExpr } from './classCommentPresence';

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
// Explorer can withhold the comment button on classes that have none
// ([#387](https://github.com/GemTalk/Jasper/issues/387)). The rule itself lives
// in {@link hasRealCommentExpr} — reading the
// `#comment` extra-dict key rather than `Class>>comment`, and counting
// present-but-blank as none — because the file-system provider has to apply the
// same rule when it decides what a comment document opens on. Reading the key is
// also the cheaper of the two: measured at ~0.12µs per class, so adding it to
// this existing per-class loop costs nothing noticeable even on a large
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
    cmt := ${hasRealCommentExpr('v')}.
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
