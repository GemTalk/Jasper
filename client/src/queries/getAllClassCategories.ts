import { QueryExecutor } from './types';

export interface ClassCategoryNameEntry {
  dictIndex: number;
  dictName: string;
  category: string;
}

/**
 * Every distinct class-category across the whole symbol list, paired with the dictionary it appears
 * in (a category name can recur in several dictionaries — each is its own navigable spot). Classes
 * with a nil/empty category are bucketed under 'as yet unclassified', matching the Explorer. This is
 * a whole-image scan, so the Categories omni provider loads it lazily (only when the user scopes to
 * Categories), never on every picker open.
 */
export function getAllClassCategories(execute: QueryExecutor): ClassCategoryNameEntry[] {
  const code = `| ws sl seen |
ws := WriteStream on: Unicode7 new.
seen := Set new.
sl := System myUserProfile symbolList.
1 to: sl size do: [:idx |
  | dict |
  dict := sl at: idx.
  dict keysAndValuesDo: [:k :v |
    v isBehavior ifTrue: [
      | cat key |
      cat := [v category] on: Error do: [:e | nil].
      (cat isNil or: [cat isEmpty]) ifTrue: [cat := 'as yet unclassified'].
      key := idx printString , '|' , cat asString.
      (seen includes: key) ifFalse: [
        seen add: key.
        ws nextPutAll: idx printString; tab; nextPutAll: dict name; tab; nextPutAll: cat asString; lf]]]].
ws contents`;

  const raw = execute(code);
  const results: ClassCategoryNameEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    results.push({ dictIndex: parseInt(parts[0], 10), dictName: parts[1], category: parts[2] });
  }
  return results;
}
