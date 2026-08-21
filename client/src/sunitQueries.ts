import { ActiveSession } from './sessionManager';
import {
  BrowserQueryError,
  defaultQueryExecutorUsing,
  executeFetchStringNb,
} from './browserQueries';

import { discoverTestClasses as sharedDiscoverTestClasses } from './queries/discoverTestClasses';
import { discoverTestMethods as sharedDiscoverTestMethods } from './queries/discoverTestMethods';
import {
  runTestMethod as sharedRunTestMethod,
  runTestMethodCode,
  parseTestMethodResult,
} from './queries/runTestMethod';
import {
  runTestClass as sharedRunTestClass,
  runTestClassCode,
  parseTestClassResults,
} from './queries/runTestClass';
import { runFailingTests as sharedRunFailingTests } from './queries/runFailingTests';
import { describeTestFailure as sharedDescribeTestFailure } from './queries/describeTestFailure';

// Re-export types from the shared layer.
export type { TestClassInfo } from './queries/discoverTestClasses';
export type { TestMethodInfo } from './queries/discoverTestMethods';
export type { TestRunResult } from './queries/runTestMethod';

// Backward compatibility alias — no callers catch this by class, but tests
// reference it in mocks.
export const SunitQueryError = BrowserQueryError;

export function discoverTestClasses(session: ActiveSession) {
  return sharedDiscoverTestClasses(defaultQueryExecutorUsing(session));
}

export function discoverTestMethods(session: ActiveSession, className: string, dictName?: string) {
  return sharedDiscoverTestMethods(defaultQueryExecutorUsing(session), className, dictName);
}

export function runTestMethod(
  session: ActiveSession,
  className: string,
  selector: string,
  dictName?: string,
) {
  return sharedRunTestMethod(defaultQueryExecutorUsing(session), className, selector, dictName);
}

export function runTestClass(session: ActiveSession, className: string, dictName?: string) {
  return sharedRunTestClass(defaultQueryExecutorUsing(session), className, dictName);
}

/**
 * Non-blocking counterparts of the two run queries. A test can run for minutes,
 * and the blocking call freezes the extension host for its whole duration —
 * which is why nothing, not even VS Code's own stop button, could interrupt a
 * run. These poll instead, so the UI stays live and `onStart`'s canceller can
 * break the gem (soft first, hard on a second call).
 */
export function runTestClassNb(
  session: ActiveSession,
  className: string,
  dictName?: string,
  onStart?: (cancel: () => void) => void,
) {
  return executeFetchStringNb(
    session,
    `Run tests: ${className}`,
    runTestClassCode(className, dictName),
    `GemStone: running ${className} tests…`,
    false,
    onStart,
  ).then((data) => parseTestClassResults(data, className));
}

export function runTestMethodNb(
  session: ActiveSession,
  className: string,
  selector: string,
  dictName?: string,
  onStart?: (cancel: () => void) => void,
) {
  return executeFetchStringNb(
    session,
    `Run test: ${className}>>${selector}`,
    runTestMethodCode(className, selector, dictName),
    `GemStone: running ${className}>>${selector}…`,
    false,
    onStart,
  ).then((data) => parseTestMethodResult(data, className, selector));
}

export function runFailingTests(
  session: ActiveSession,
  classNames?: string[],
  classNamePattern?: string,
) {
  return sharedRunFailingTests(defaultQueryExecutorUsing(session), classNames, classNamePattern);
}

export function describeTestFailure(session: ActiveSession, className: string, selector: string) {
  return sharedDescribeTestFailure(defaultQueryExecutorUsing(session), className, selector);
}
