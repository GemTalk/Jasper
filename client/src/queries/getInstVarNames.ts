import { QueryExecutor } from './types';
import { splitLines } from './util';

export function getInstVarNames(execute: QueryExecutor, className: string): string[] {
  const code = `| ws |
ws := WriteStream on: String new.
${className} allInstVarNames do: [:each |
  ws nextPutAll: each; lf].
ws contents`;
  return splitLines(execute(code));
}
