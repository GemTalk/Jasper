import { QueryExecutor } from './types';
import { escapeString, receiver } from './util';

export function getMethodSource(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
  selector: string,
  environmentId: number = 0,
  dict?: number | string,
): string {
  const recv = receiver(className, isMeta, dict);
  const code =
    environmentId === 0
      ? `(${recv} compiledMethodAt: #'${escapeString(selector)}') sourceString`
      : `(${recv} compiledMethodAt: #'${escapeString(selector)}' environmentId: ${environmentId}) sourceString`;
  return execute(code);
}
