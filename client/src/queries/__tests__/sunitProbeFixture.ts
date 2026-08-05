// Throwaway TestCase fixture for the SUnit-family integration tests.
//
// Creating a real `JasperProbeTest` class once per test lets the
// tests assert on concrete results (e.g. "running JasperProbeTest reports
// exactly one passed, one failed, one errored") without depending on
// whatever production tests happen to exist on the stone. Installed inside
// each test's own transaction, so the harness's per-test abort cleans it up
// automatically — no explicit teardown needed.

import { QueryExecutor } from '../types';

const PROBE_CLASS_NAME = 'JasperProbeTest';

const SETUP_SOURCE = `[| probe |
probe := UserGlobals at: #'${PROBE_CLASS_NAME}' ifAbsent: [
  TestCase
    subclass: '${PROBE_CLASS_NAME}'
    instVarNames: #()
    classVars: #()
    classInstVars: #()
    poolDictionaries: #()
    inDictionary: UserGlobals].
probe
  compileMethod: 'testPasses  self assert: 1 = 1'
  dictionaries: System myUserProfile symbolList
  category: 'tests'.
probe
  compileMethod: 'testFails  self assert: 1 = 2'
  dictionaries: System myUserProfile symbolList
  category: 'tests'.
probe
  compileMethod: 'testErrors  ^ Object doesNotUnderstandWHATEVER'
  dictionaries: System myUserProfile symbolList
  category: 'tests'.
'ok'] value`;

export const SUNIT_PROBE_TEST_CLASS = PROBE_CLASS_NAME;
export const SUNIT_PROBE_PASSING_SELECTOR = 'testPasses';
export const SUNIT_PROBE_FAILING_SELECTOR = 'testFails';
export const SUNIT_PROBE_ERRORING_SELECTOR = 'testErrors';

export function installSunitProbeFixture(exec: QueryExecutor): void {
  exec(SETUP_SOURCE);
}
