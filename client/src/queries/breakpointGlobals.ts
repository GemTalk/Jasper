import { QueryExecutor } from './types';

/**
 * Session-wide breakpoint operations — the "global functions" of the breakpoint
 * manager. Each acts on every method breakpoint the gem holds, including ones
 * Jasper did not set.
 *
 * These reach for the `GsNMethod class` primitives rather than looping over
 * Jasper's own model on purpose: the gem is the only thing that knows about
 * breakpoints set outside Jasper, and "disable all" has to mean all of them.
 */

/** Re-enable every breakpoint in the gem, disabled ones included. */
export function enableAllBreakpoints(execute: QueryExecutor): string {
  return execute(`GsNMethod _enableAllBreaks. 'ok'`);
}

/** Disable every breakpoint in the gem, but keep them so they can be re-enabled. */
export function disableAllBreakpoints(execute: QueryExecutor): string {
  return execute(`GsNMethod _disableAllBreaks. 'ok'`);
}

/** Remove every breakpoint in the gem outright. */
export function removeAllBreakpoints(execute: QueryExecutor): string {
  return execute(`GsNMethod _deleteAllBreaks. 'ok'`);
}

/** Whether the gem currently holds any method breakpoint at all. */
export function hasBreakpoints(execute: QueryExecutor): boolean {
  return execute(`GsNMethod _hasBreakpoints printString`).trim() === 'true';
}

/**
 * Operate on a breakpoint in a method we can only name by OOP — a doit's
 * "executed code", or a method whose class has since been renamed out from
 * under the breakpoint. `op` is the `GsNMethod` selector to send.
 */
export function breakpointByOop(
  execute: QueryExecutor,
  methodOop: string,
  op: 'setBreakAtStepPoint:' | 'disableBreakAtStepPoint:' | 'clearBreakAtStepPoint:',
  stepPoint: number,
): string {
  return execute(`(Object _objectForOop: ${methodOop}) ${op} ${stepPoint}. 'ok'`);
}
