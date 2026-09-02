// Bulk throwaway TestCase fixture for runFailingTests' MAX_RUN_CLASSES guard.
//
// The guard is a pure count check on the resolved class selection, so the only
// way to assert it end-to-end is to make the selection large — and it must be
// large by construction, not by whatever the live stone happens to contain
// (CI's bare vendor extent has 7 kernel SUnit classes; a developer's image has
// hundreds). Creating the classes here makes the assertion identical on every
// matrix cell.
//
// One doit for the whole batch, so cost is flat in `count`: installing 100
// classes measures ~3.3-3.4ms on both 3.6.2 and 3.7.5 (~21us/class), and
// running all 100 suites through runFailingTests ~4.1ms on 3.7.5 / ~4.5ms on
// 3.6.2 (~31us/class). These probes are deliberately trivial, so they exercise
// the guard's counting, not the blocking cost it exists to bound — see
// MAX_RUN_CLASSES for that. Installed inside the caller's transaction, so the
// harness's per-test abort reclaims them; no teardown.

import { GciLibrary } from '../../gciLibrary';
import { QueryExecutor } from '../types';

const PROBE_CLASS_PREFIX = 'JasperRunLimitProbe';

// Created by every probe's `testPasses`, and removed at install time. Its
// presence is proof that at least one probe suite actually ran (see
// {@link anyRunLimitProbeSuiteRan}).
const PROBE_RAN_MARKER_KEY = '#JasperRunLimitProbeSuiteRan';

/** Names of the classes {@link installRunLimitProbeClasses} creates, in order. */
function runLimitProbeClassNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${PROBE_CLASS_PREFIX}${i + 1}`);
}

/**
 * Creates `count` trivial TestCase subclasses in UserGlobals, each with one
 * passing and one failing test, and returns their names.
 *
 * The names are generated once here and interpolated into the doit, so the
 * classes created in the stone and the names returned cannot drift apart.
 */
export function installRunLimitProbeClasses(exec: QueryExecutor, count: number): string[] {
  const names = runLimitProbeClassNames(count);
  exec(`[| c sl |
sl := System myUserProfile symbolList.
UserGlobals removeKey: ${PROBE_RAN_MARKER_KEY} ifAbsent: [nil].
#(${names.map((n) => `'${n}'`).join(' ')}) do: [:name |
  c := UserGlobals at: name asSymbol ifAbsent: [
    TestCase subclass: name
      instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #()
      inDictionary: UserGlobals].
  c compileMethod: 'testPasses  UserGlobals at: ${PROBE_RAN_MARKER_KEY} put: true. self assert: true'
    dictionaries: sl category: 'tests'.
  c compileMethod: 'testFails  self assert: 1 = 2'
    dictionaries: sl category: 'tests'].
'ok'] value`);
  return names;
}

/**
 * Whether any probe class's suite has run since the last
 * {@link installRunLimitProbeClasses} — i.e. whether the marker global its
 * `testPasses` writes exists.
 */
export function anyRunLimitProbeSuiteRan(gci: GciLibrary, session: unknown): boolean {
  return gci.isIncludedInUserGlobals(session, PROBE_RAN_MARKER_KEY);
}
