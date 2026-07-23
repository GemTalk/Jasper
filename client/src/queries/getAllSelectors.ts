import { QueryExecutor } from './types';
import { splitLines } from './util';

export function getAllSelectors(execute: QueryExecutor, className: string): string[] {
  const code = `| ws |
ws := WriteStream on: Unicode7 new.
${className} allSelectors asSortedCollection do: [:each |
  ws nextPutAll: each; lf].
ws contents`;
  return splitLines(execute(code));
}
