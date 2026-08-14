import { QueryExecutor } from './types';

export interface GlobalNameEntry {
  dictIndex: number;
  dictName: string;
  name: string;
  /** The class name of the global's value — used to jump to that class when the global is picked. */
  className: string;
}

/**
 * Every (dictionary, key) pair in the symbol list whose value is NOT a class — the globals/variables
 * (Transcript, AllUsers, SessionTemps, named constants, …). The class-valued keys are `getAllClassNames`'s
 * job; together they cover "search any name." Like that query, a name registered under more than one
 * dictionary/key yields one entry per registration. Each row also carries `v class name` so picking a
 * global can jump to the class of its value.
 */
export function getAllGlobalNames(execute: QueryExecutor): GlobalNameEntry[] {
  const code = `| ws sl |
ws := WriteStream on: Unicode7 new.
sl := System myUserProfile symbolList.
1 to: sl size do: [:idx |
  | dict |
  dict := sl at: idx.
  dict keysAndValuesDo: [:k :v |
    v isBehavior ifFalse: [
      ws nextPutAll: idx printString; tab; nextPutAll: dict name; tab;
         nextPutAll: k asString; tab; nextPutAll: v class name; lf]]].
ws contents`;

  const raw = execute(code);
  const results: GlobalNameEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    results.push({
      dictIndex: parseInt(parts[0], 10),
      dictName: parts[1],
      name: parts[2],
      className: parts[3],
    });
  }
  return results;
}
