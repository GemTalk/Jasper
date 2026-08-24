import { QueryExecutor } from './types';
import { splitLines } from './util';

export interface TestClassInfo {
  dictName: string;
  className: string;
  // 1-based SymbolList index of the dictionary the class was found in. Carried
  // so callers can build the same `?dict=N`-scoped gemstone:// URIs the editor
  // opens — a test item whose URI differs from the opened document's by so much
  // as the query string is not recognised as that document's test. undefined
  // when the stone returned an unparseable index.
  dictIndex?: number;
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

// SymbolList indexes are 1-based, so 0 and negatives are as invalid as NaN.
// undefined means "unknown" — callers then fall back to dictionary-name lookup.
function parseDictIndex(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}

export function discoverTestClasses(execute: QueryExecutor): TestClassInfo[] {
  // Walk the symbol list by index rather than with `do:` so each class carries
  // the 1-based index of the dictionary it was found in. `(classDict includesKey:)`
  // keeps the first dictionary that defines a class — the same one bare-name
  // lookup would resolve to — so the recorded index always matches the class we
  // report.
  const code = `| ws sl classDict |
sl := System myUserProfile symbolList.
classDict := IdentityDictionary new.
1 to: sl size do: [:i |
  (sl at: i) keysAndValuesDo: [:k :v |
    (v isBehavior
      and: [(v isSubclassOf: TestCase)
      and: [v ~~ TestCase
      and: [(classDict includesKey: v) not]]])
        ifTrue: [classDict at: v put: (Array with: (sl at: i) name with: i)]]].
ws := WriteStream on: Unicode7 new.
classDict keysAndValuesDo: [:cls :dictInfo |
  ws nextPutAll: (dictInfo at: 1); tab;
    nextPutAll: cls name; tab;
    nextPutAll: cls testSelectors size printString; tab;
    nextPutAll: (dictInfo at: 2) printString; lf].
ws contents`;
  const data = execute(code);
  return splitLines(data).map((line) => {
    const [dictName, className, count, dictIndex] = line.split('\t');
    return {
      dictName,
      className,
      testCount: parseTestCount(count),
      dictIndex: parseDictIndex(dictIndex),
    };
  });
}
