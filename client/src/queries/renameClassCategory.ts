import { QueryExecutor } from './types';
import { escapeString } from './util';

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
  const dictExpr =
    typeof dict === 'number'
      ? `System myUserProfile symbolList at: ${dict} ifAbsent: [nil]`
      : `System myUserProfile symbolList objectNamed: #'${escapeString(dict)}'`;
  // Categories are compared via Symbol identity (asSymbol ==), never String `=`:
  // on 3.6.x a category can come back as a wide (Unicode) string and `narrow =
  // wide` raises ArgumentError 2718. Interning normalises the width, so `==` on the
  // resulting symbols is Unicode-safe (and every category name is ASCII in practice).
  const code = `| dict oldCat newCat prefix oldSym prefixSym count |
dict := ${dictExpr}.
dict ifNil: [^ 'Dictionary not found'].
oldCat := '${escapeString(oldPath)}'.
newCat := '${escapeString(newPath)}'.
prefix := oldCat , '-'.
oldSym := oldCat asSymbol.
prefixSym := prefix asSymbol.
count := 0.
dict keysAndValuesDo: [:k :v |
  v isBehavior ifTrue: [
    | cat |
    cat := [v category asString] on: Error do: [:e | nil].
    cat ifNotNil: [
      (cat size = oldCat size and: [cat asSymbol == oldSym])
        ifTrue: [v category: newCat. count := count + 1]
        ifFalse: [
          (cat size > prefix size and: [(cat copyFrom: 1 to: prefix size) asSymbol == prefixSym])
            ifTrue: [
              v category: newCat , (cat copyFrom: oldCat size + 1 to: cat size).
              count := count + 1]]]]].
'renamed: ' , count printString`;
  return execute(code);
}
