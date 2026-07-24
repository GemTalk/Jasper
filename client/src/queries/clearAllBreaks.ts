import { QueryExecutor } from './types';
import { compiledMethodExpr } from './util';

export function clearAllBreaks(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
  selector: string,
  environmentId: number = 0,
  dict?: number | string,
): string {
  const method = compiledMethodExpr(className, isMeta, selector, environmentId, dict);
  const code = `${method} clearAllBreaks. 'ok'`;
  return execute(code);
}
