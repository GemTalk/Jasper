import { QueryExecutor } from './types';

export interface MethodEntry {
  isMeta: boolean;
  category: string;
  selector: string;
}

export function getMethodList(execute: QueryExecutor, className: string): MethodEntry[] {
  const code = `| ws class |
ws := WriteStream on: Unicode7 new.
class := ${className}.
{ class. class class } doWithIndex: [:cls :idx |
  | isMeta |
  isMeta := idx = 2.
  cls categoryNames asSortedCollection do: [:cat |
    (cls sortedSelectorsIn: cat) do: [:sel |
      ws
        nextPutAll: (isMeta ifTrue: ['1'] ifFalse: ['0']); tab;
        nextPutAll: cat; tab;
        nextPutAll: sel; lf]]].
ws contents`;
  const raw = execute(code);
  const results: MethodEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    results.push({
      isMeta: parts[0] === '1',
      category: parts[1],
      selector: parts[2],
    });
  }
  return results;
}
