import { QueryExecutor } from './types';
import { escapeString } from './util';

export interface ClassNameEntry {
  dictIndex: number;
  dictName: string;
  className: string;
}

export function getAllClassNames(execute: QueryExecutor): ClassNameEntry[] {
  // List EVERY (dictionary, key) pair whose value is a class. A class object can
  // be registered under more than one key/dictionary (e.g. Globals>Object and
  // Python>object, or OrderedCollection aliased as Python>list); each such alias
  // is a distinct, legitimate lookup, so it gets its own entry. (An earlier
  // version de-duplicated by object identity, which hid every alias but the
  // first one encountered while scanning dictionaries.)
  const code = `| ws sl |
ws := WriteStream on: Unicode7 new.
sl := System myUserProfile symbolList.
1 to: sl size do: [:idx |
  | dict |
  dict := sl at: idx.
  dict keysAndValuesDo: [:k :v |
    v isBehavior ifTrue: [
      ws nextPutAll: idx printString; tab; nextPutAll: dict name; tab; nextPutAll: k; lf]]].
ws contents`;

  const raw = execute(code);
  const results: ClassNameEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    results.push({
      dictIndex: parseInt(parts[0], 10),
      dictName: parts[1],
      className: parts[2],
    });
  }
  return results;
}

/**
 * The `ClassNameEntry` rows for a SINGLE class name — every dictionary that registers that name
 * under a class value. Used to fold a freshly compiled class into the GemStone Search cache without
 * re-enumerating the whole image (`getAllClassNames`). Looks the name up as an interned Symbol key
 * (`dict at: #'Name'`), which is O(dictionaries) and sidesteps the 3.6.x Unicode7 literal-compare
 * gotcha (see `util.ts`) — never a `= 'name'` against an image value.
 */
export function getClassNameEntriesFor(
  execute: QueryExecutor,
  className: string,
): ClassNameEntry[] {
  const esc = escapeString(className);
  const code = `| ws sl target |
ws := WriteStream on: Unicode7 new.
sl := System myUserProfile symbolList.
target := #'${esc}'.
1 to: sl size do: [:idx |
  | dict v |
  dict := sl at: idx.
  v := dict at: target otherwise: nil.
  (v ~~ nil and: [v isBehavior]) ifTrue: [
    ws nextPutAll: idx printString; tab; nextPutAll: dict name; tab; nextPutAll: target; lf]].
ws contents`;

  const raw = execute(code);
  const results: ClassNameEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    results.push({
      dictIndex: parseInt(parts[0], 10),
      dictName: parts[1],
      className: parts[2],
    });
  }
  return results;
}
