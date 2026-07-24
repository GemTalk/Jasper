import { QueryExecutor } from './types';
import { classLookupOrRaiseExpr, splitLines } from './util';

export interface TestMethodInfo {
  selector: string;
  category: string;
}

export function discoverTestMethods(
  execute: QueryExecutor,
  className: string,
  dictName?: string,
): TestMethodInfo[] {
  // Resolve dictionary-scoped so we list the methods of the specific class
  // the caller means, not whichever same-named class wins bare-name lookup.
  const code = `| cls ws |
${classLookupOrRaiseExpr(className, dictName)}
ws := WriteStream on: Unicode7 new.
cls testSelectors asSortedCollection do: [:each |
  ws nextPutAll: each;
    tab;
    nextPutAll: ((cls categoryOfSelector: each environmentId: 0) ifNil: ['']);
    lf].
ws contents`;
  const data = execute(code);
  return splitLines(data).map((line) => {
    const [selector, category] = line.split('\t');
    return { selector, category: category || '' };
  });
}
