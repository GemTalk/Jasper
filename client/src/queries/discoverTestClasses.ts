import { QueryExecutor } from './types';
import { splitLines } from './util';

export interface TestClassInfo {
  dictName: string;
  className: string;
  // Number of test methods (testSelectors) — shown in the Test Explorer and
  // used to sanity-check counts without expanding the class. A non-negative
  // integer, or null when the stone returned an unparseable/invalid value
  // (so callers can distinguish a genuine "0 tests" from "unknown").
  testCount: number | null;
}

// Parse the count field defensively. The stone sends `testSelectors size`
// (always a non-negative integer), but a truncated/garbled response must not
// surface as a negative number or NaN. Returns null for anything that isn't a
// clean non-negative integer so the display can show it's unknown rather than
// fake a "0".
function parseTestCount(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function discoverTestClasses(execute: QueryExecutor): TestClassInfo[] {
  const code = `| ws sl classDict |
sl := System myUserProfile symbolList.
classDict := IdentityDictionary new.
sl do: [:dict |
  dict keysAndValuesDo: [:k :v |
    (v isBehavior
      and: [(v isSubclassOf: TestCase)
      and: [v ~~ TestCase
      and: [(classDict includesKey: v) not]]])
        ifTrue: [classDict at: v put: dict name]]].
ws := WriteStream on: Unicode7 new.
classDict keysAndValuesDo: [:cls :dictName |
  ws nextPutAll: dictName; tab;
    nextPutAll: cls name; tab;
    nextPutAll: cls testSelectors size printString; lf].
ws contents`;
  const data = execute(code);
  return splitLines(data).map((line) => {
    const [dictName, className, count] = line.split('\t');
    return { dictName, className, testCount: parseTestCount(count) };
  });
}
