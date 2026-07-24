import { QueryExecutor } from './types';
import { compiledMethodExpr, splitLines } from './util';

export function getSourceOffsets(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
  selector: string,
  environmentId: number = 0,
  dict?: number | string,
): number[] {
  const method = compiledMethodExpr(className, isMeta, selector, environmentId, dict);
  const code = `| ws |
ws := WriteStream on: String new.
${method} _sourceOffsets do: [:each |
  ws nextPutAll: each printString; lf].
ws contents`;
  return splitLines(execute(code)).map((s) => parseInt(s, 10));
}
