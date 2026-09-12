import { QueryExecutor } from './types';

/**
 * A readable report of what the last failed commit conflicted on.
 *
 * `System transactionConflicts` answers a SymbolDictionary keyed by conflict CATEGORY
 * (`#'Read-Write'`, `#'Write-Write'`, `#'Write-Dependency'`, `#'Rc-Write-Write'` and the
 * rest), each holding the objects that clashed. Printed here as one line per category
 * followed by its objects, because the raw `printString` of the whole dictionary is a
 * single unreadable run and the category is the part that says what to do about it.
 *
 * Empty categories are dropped: GemStone answers every key it knows, most of them empty,
 * and listing them all buries the one that matters.
 */
export function transactionConflicts(execute: QueryExecutor): string {
  return execute(
    `| conflicts ws |
conflicts := System transactionConflicts.
ws := WriteStream on: String new.
conflicts keys asSortedCollection do: [:key |
  | objects |
  objects := conflicts at: key.
  objects isEmpty ifFalse: [
    ws nextPutAll: key asString; nextPutAll: ' ('; print: objects size; nextPutAll: '):'; lf.
    objects do: [:each |
      ws nextPutAll: '    '.
      [ws nextPutAll: each printString] on: Error do: [:ex | ws nextPutAll: 'an unprintable object'].
      ws lf]]].
ws contents isEmpty
  ifTrue: ['The stone reports no conflicting objects. The commit may have failed for another reason — see the error above.']
  ifFalse: [ws contents]`,
  );
}
