import { QueryExecutor } from './types';

export interface GlobalEntry {
  name: string;
  className: string;
  value: string;
}

export function getGlobalsForDictionary(execute: QueryExecutor, dictIndex: number): GlobalEntry[] {
  const code = `| ws dict |
dict := System myUserProfile symbolList at: ${dictIndex}.
ws := WriteStream on: Unicode7 new.
dict keysAndValuesDo: [:k :v |
  v isBehavior ifFalse: [
    | ps |
    ps := [v printString] on: Error do: [:e | '<error: ' , e messageText , '>'].
    ps size > 120 ifTrue: [ps := (ps copyFrom: 1 to: 120) , '...'].
    ws nextPutAll: k asString; tab;
       nextPutAll: v class name; tab;
       nextPutAll: ps; lf]].
ws contents`;

  const raw = execute(code);

  const results: GlobalEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const firstTab = line.indexOf('\t');
    if (firstTab < 0) continue;
    const secondTab = line.indexOf('\t', firstTab + 1);
    if (secondTab < 0) continue;
    results.push({
      name: line.substring(0, firstTab),
      className: line.substring(firstTab + 1, secondTab),
      value: line.substring(secondTab + 1),
    });
  }
  return results;
}
