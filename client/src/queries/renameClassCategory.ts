import { QueryExecutor } from './types';
import { escapeString, dictLookupExpr } from './util';

// Rename a class category within one dictionary: reassign every class whose
// category is `oldPath` -- or lives under it in the dash-segmented category tree
// (`oldPath-...`) -- so the whole subtree moves consistently, mirroring how the
// Explorer selects a category by prefix. Renaming onto an existing category name
// simply merges the classes into it (categories are labels, not bindings, so a
// merge is well-defined). Uses Class>>category:, which recompiles nothing and
// commits nothing. Answers `renamed: <n>`.
//
// `dict` is a 1-based symbol-list index (canonical) or a dictionary name.
export function renameClassCategory(
  execute: QueryExecutor,
  dict: number | string,
  oldPath: string,
  newPath: string,
): string {
  const dictExpr = dictLookupExpr(dict);
  // The emitted Smalltalk is kept ASCII-only (no comments/em-dashes in the doit): a
  // non-ASCII char in doit source trips the 3.6.x compiler (ComStrmSetCursor, err 1001).
  //
  // Notes on the doit below:
  // - Categories are compared via Symbol identity (asSymbol ==), never String `=`: on
  //   3.6.x a category can come back as a wide (Unicode) string and `narrow = wide`
  //   raises ArgumentError 2718; interning normalises the width so `==` is Unicode-safe.
  // - A class whose category can't be read increments `skipped` (not silently ignored),
  //   surfaced in the payload so a partial rename doesn't look complete (LOW-2).
  // - The subtree test uses `>=` (not `>`): a category named exactly `<old>-` has
  //   size = prefix size, so `>=` treats it as a subtree member (suffix `-`) rather
  //   than matching neither branch and being left behind (LOW-1).
  const code = `| dict oldCat newCat prefix oldSym prefixSym count skipped |
dict := ${dictExpr}.
dict ifNil: [^ 'Dictionary not found'].
oldCat := '${escapeString(oldPath)}'.
newCat := '${escapeString(newPath)}'.
prefix := oldCat , '-'.
oldSym := oldCat asSymbol.
prefixSym := prefix asSymbol.
count := 0.
skipped := 0.
dict keysAndValuesDo: [:k :v |
  v isBehavior ifTrue: [
    | cat |
    cat := [v category asString] on: Error do: [:e | skipped := skipped + 1. nil].
    cat ifNotNil: [
      (cat size = oldCat size and: [cat asSymbol == oldSym])
        ifTrue: [v category: newCat. count := count + 1]
        ifFalse: [
          (cat size >= prefix size and: [(cat copyFrom: 1 to: prefix size) asSymbol == prefixSym])
            ifTrue: [
              v category: newCat , (cat copyFrom: oldCat size + 1 to: cat size).
              count := count + 1]]]]].
skipped = 0
  ifTrue: ['renamed: ' , count printString]
  ifFalse: ['renamed: ' , count printString , ' skipped: ' , skipped printString]`;
  return execute(code);
}
