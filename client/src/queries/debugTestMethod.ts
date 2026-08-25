import { classLookupOrRaiseExpr, escapeString } from './util';

/**
 * Smalltalk that runs ONE test the way a debugger needs it run: setUp, the test
 * itself, then tearDown — with no exception handler anywhere.
 *
 * This is why a debug run cannot reuse runTestMethod / runTestClass. Both of
 * those (like SUnit's own TestCase>>run) wrap the test in a handler that
 * records "this failed" and discards the exception, which is exactly what makes
 * a failing test undebuggable. Without a handler, a raise suspends the GemStone
 * process instead, and the debugger gets the live stack.
 *
 * setUp AND the test run inside the `ensure:`, matching GemStone's own
 * TestCase>>runCase, so tearDown still runs when a suspended — then terminated —
 * test unwinds, and also when setUp itself raises (the case a debug run exists
 * for). tearDown is only attempted, not guaranteed to complete: a tearDown that
 * touches state a failed setUp never initialised can raise in turn — same as the
 * framework.
 *
 * Answers 'passed' when nothing raised: the caller otherwise has no way to tell
 * "the test finished" from "a debugger took the process".
 */
export function debugTestMethodCode(
  className: string,
  selector: string,
  dictName?: string,
): string {
  const sel = escapeString(selector);
  return `| cls tc |
${classLookupOrRaiseExpr(className, dictName)}
tc := cls selector: #'${sel}'.
[tc setUp. tc perform: #'${sel}'] ensure: [tc tearDown].
'passed'`;
}
