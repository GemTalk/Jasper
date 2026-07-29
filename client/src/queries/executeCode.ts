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

export function wrapExecuteCode(code: string): string {
  return `[[[${code}] value printString]
  on: AlmostOutOfStack do: [:e | 'Error: AlmostOutOfStack - user code exhausted the call stack']]
  on: AbstractException do: [:e | 'Error: ', e class name asString, ' - ', e messageText asString]`;
}
