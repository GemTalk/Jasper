import { QueryExecutor } from './types';
import { compiledMethodExpr } from './util';

export function setBreakAtStepPoint(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
  selector: string,
  stepPoint: number,
  environmentId: number = 0,
  dict?: number | string,
): string {
  const method = compiledMethodExpr(className, isMeta, selector, environmentId, dict);
  const code = `${method} setBreakAtStepPoint: ${stepPoint}. 'ok'`;
  return execute(code);
}
