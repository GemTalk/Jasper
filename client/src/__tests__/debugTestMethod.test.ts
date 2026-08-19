import { describe, it, expect } from 'vitest';

import { debugTestMethodCode } from '../queries/debugTestMethod';

describe('debugTestMethodCode', () => {
  // The whole reason a debug run can't reuse the ordinary run queries is that
  // those install an exception handler. If one ever appears here, a failing
  // test silently stops being debuggable — hence the explicit assertions.
  it('installs no exception handler around the test', () => {
    const code = debugTestMethodCode('MyTestCase', 'testAdd', 'UserGlobals');
    expect(code).not.toContain('on: AbstractException');
    expect(code).not.toContain('TestFailure');
  });

  it('runs setUp, the test, and tearDown', () => {
    const code = debugTestMethodCode('MyTestCase', 'testAdd', 'UserGlobals');
    expect(code).toContain('tc setUp');
    expect(code).toContain("tc perform: #'testAdd'");
    expect(code).toContain('ensure: [tc tearDown]');
  });

  it('resolves the class in the dictionary it was found in', () => {
    const code = debugTestMethodCode('MyTestCase', 'testAdd', 'UserGlobals');
    expect(code).toContain('UserGlobals');
  });

  it('answers a value when nothing raised, so a pass is distinguishable', () => {
    const code = debugTestMethodCode('MyTestCase', 'testAdd', 'UserGlobals');
    expect(code.trimEnd().endsWith("'passed'")).toBe(true);
  });

  it('escapes a quote in the selector rather than breaking the literal', () => {
    const code = debugTestMethodCode('MyTestCase', "test'Odd", 'UserGlobals');
    expect(code).toContain("#'test''Odd'");
  });
});
