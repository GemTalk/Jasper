import { QueryExecutor } from './types';
import { compiledMethodExpr } from './util';

/**
 * Disable — but keep — the breakpoint at `stepPoint`.
 *
 * `GsNMethod >> disableBreakAtStepPoint:` is a no-op when no breakpoint is set
 * there yet, so a disabled breakpoint can only exist as "set, then disabled".
 * Callers that want a disabled breakpoint where there is none must
 * `setBreakAtStepPoint` first; `setBreakAtStepPoint` is also what re-enables one
 * (there is no separate enable primitive — `GsNMethod class >>
 * enableBreakInClass:selector:stepPoint:` just sends `setBreakAtStepPoint:`).
 */
export function disableBreakAtStepPoint(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
  selector: string,
  stepPoint: number,
  environmentId: number = 0,
  dict?: number | string,
): string {
  const method = compiledMethodExpr(className, isMeta, selector, environmentId, dict);
  const code = `${method} disableBreakAtStepPoint: ${stepPoint}. 'ok'`;
  return execute(code);
}
