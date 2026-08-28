// Bulk throwaway TestCase fixture for runFailingTests' MAX_RUN_CLASSES guard.
//
// The guard is a pure count check on the resolved class selection, so the only
// way to assert it end-to-end is to make the selection large — and it must be
// large by construction, not by whatever the live stone happens to contain
// (CI's bare vendor extent has 7 kernel SUnit classes; a developer's image has
// hundreds). Creating the classes here makes the assertion identical on every
// matrix cell.
//
// One doit for the whole batch, so cost is flat in `count` — ~4ms for 100 on
// 3.6.2. Installed inside the caller's transaction, so the harness's per-test
// abort reclaims them; no teardown.

import { QueryExecutor } from '../types';

const PROBE_CLASS_PREFIX = 'JasperRunLimitProbe';

/** Names of the classes {@link installRunLimitProbeClasses} creates, in order. */
export function runLimitProbeClassNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${PROBE_CLASS_PREFIX}${i + 1}`);
}

/**
 * Creates `count` trivial TestCase subclasses in UserGlobals, each with one
 * passing and one failing test, and returns their names.
 */
export function installRunLimitProbeClasses(exec: QueryExecutor, count: number): string[] {
  exec(`[| c |
1 to: ${count} do: [:i |
  c := TestCase subclass: '${PROBE_CLASS_PREFIX}', i printString
    instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #()
    inDictionary: UserGlobals.
  c compileMethod: 'testPasses  self assert: true'
    dictionaries: System myUserProfile symbolList category: 'tests'.
  c compileMethod: 'testFails  self assert: 1 = 2'
    dictionaries: System myUserProfile symbolList category: 'tests'].
'ok'] value`);
  return runLimitProbeClassNames(count);
}
