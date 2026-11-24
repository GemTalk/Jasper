import { compareNames } from '../methodOrder';
import { QueryExecutor } from './types';
import { splitLines } from './util';

export function getAllSelectors(execute: QueryExecutor, className: string): string[] {
  const code = `| ws |
ws := WriteStream on: Unicode7 new.
${className} allSelectors do: [:each |
  ws nextPutAll: each; lf].
ws contents`;
  return splitLines(execute(code)).sort(compareNames);
}
