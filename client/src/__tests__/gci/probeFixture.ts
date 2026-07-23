// Throwaway TestCase fixture for the SUnit-family smoke tests.
//
// Creating a real `JasperProbeTest` class once per test file lets the smoke
// tests assert on concrete results (e.g. "running JasperProbeTest reports
// exactly one passed, one failed, one errored") without depending on
// whatever production tests happen to exist on the stone. Cleanup runs in
// an `afterAll` hook so the stone isn't left polluted on test failure.

import { QueryExecutor } from '../../queries/types';

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

const TEARDOWN_SOURCE = `UserGlobals removeKey: #'${PROBE_CLASS_NAME}' ifAbsent: [].
'ok'`;

export const PROBE_TEST_CLASS = PROBE_CLASS_NAME;
export const PROBE_PASSING_SELECTOR = 'testPasses';
export const PROBE_FAILING_SELECTOR = 'testFails';
export const PROBE_ERRORING_SELECTOR = 'testErrors';

export function installProbeFixture(exec: QueryExecutor): void {
  exec(SETUP_SOURCE);
}

export function uninstallProbeFixture(exec: QueryExecutor): void {
  exec(TEARDOWN_SOURCE);
}
