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

// Glob matching the guard-probe classes installed by installGuardProbeClasses.
export const SUNIT_GUARD_PROBE_PATTERN = 'JasperGuardProbe*';

// Install `count` throwaway TestCase subclasses matching SUNIT_GUARD_PROBE_PATTERN.
// Used to trip runFailingTests' MAX_RUN_CLASSES blocking-call guard DETERMINISTICALLY
// — independent of however many TestCase subclasses the live image happens to carry,
// which is what made the old image-size-branching smoke test unfit for CI. The classes
// carry no test methods: the guard fires before any suite runs, so nothing blocks.
// Transient — the harness's per-test abort rolls them back.
export function installGuardProbeClasses(exec: QueryExecutor, count: number): void {
  exec(`1 to: ${count} do: [:i | | nm |
  nm := 'JasperGuardProbe' , i printString.
  (UserGlobals includesKey: nm asSymbol) ifFalse: [
    TestCase
      subclass: nm
      instVarNames: #()
      classVars: #()
      classInstVars: #()
      poolDictionaries: #()
      inDictionary: UserGlobals]].
'ok'`);
}
