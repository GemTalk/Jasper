import { QueryExecutor } from '../../queries/types';
import { compiledMethodExpr } from '../../queries/util';

export function clearBreakAtStepPoint(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
  selector: string,
  stepPoint: number,
  environmentId: number = 0,
  dict?: number | string,
): string {
  const method = compiledMethodExpr(className, isMeta, selector, environmentId, dict);
  const code = `${method} clearBreakAtStepPoint: ${stepPoint}. 'ok'`;
  return execute(code);
}
