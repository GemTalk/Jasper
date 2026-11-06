// Wrap arbitrary user code (Smalltalk expression or statement sequence) so a
// runaway block doesn't take the gem down.
//
// Two guard layers:
//   - `on: AlmostOutOfStack` runs first (innermost) because GemStone signals
//     it *before* the stack hard-fails — gives us a chance to unwind cleanly
//     with very little stack room remaining. Handler must be minimal (no
//     stream construction, no concatenation): just return a fixed literal.
//   - `on: AbstractException` is the outer net for everything else
//     (DNU, ZeroDivide, runtime errors) — these have stack room to build a
//     proper error string.
//
// Both handlers return a String, matching the printString result the caller
// expects, so the wrapper is shape-stable across success/error.

const ERROR_TEXT = `'Error: ', e class name asString, ' - ', e messageText asString`;

function wrap(code: string, onException: string): string {
  return `[[[${code}] value printString]
  on: AlmostOutOfStack do: [:e | 'Error: AlmostOutOfStack - user code exhausted the call stack']]
  on: AbstractException do: [:e | ${onException}]`;
}

export function wrapExecuteCode(code: string): string {
  return wrap(code, ERROR_TEXT);
}

/**
 * A notebook cell's wrapper. Cells run with debugging on, so a halt is passed on
 * to the debugger; resumed, it carries on to the cell's printString result.
 * `Halt` is a ControlInterrupt, not an Error, and the net still has to catch the
 * soft break a cell's stop sends, so it can't simply be narrowed to `Error`.
 */
export function wrapCellCode(code: string): string {
  return wrap(code, `(e isKindOf: Halt) ifTrue: [e pass] ifFalse: [${ERROR_TEXT}]`);
}
