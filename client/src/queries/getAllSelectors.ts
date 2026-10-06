import { QueryExecutor } from './types';
import { splitLines } from './util';

export async function getAllSelectors(
  execute: QueryExecutor,
  className: string,
): Promise<string[]> {
  const code = `| ws |
ws := WriteStream on: Unicode7 new.
${className} allSelectors asSortedCollection do: [:each |
  ws nextPutAll: each; lf].
ws contents`;
  return splitLines(await execute(code));
}
