import { QueryExecutor } from './types';
import { splitLines } from './util';

export async function getDictionaryNames(execute: QueryExecutor): Promise<string[]> {
  const code = `| ws |
ws := WriteStream on: String new.
System myUserProfile symbolList names do: [:each |
  ws nextPutAll: each; lf].
ws contents`;
  return splitLines(await execute(code));
}
