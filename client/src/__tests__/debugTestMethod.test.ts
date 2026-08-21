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

  it('runs setUp inside the ensure block, so tearDown runs even when setUp raises', () => {
    // Regression: setUp used to sit as a bare statement before the ensure:, so a
    // setUp that raised skipped tearDown — the exact case a debug run exists for.
    // Wrapping setUp too matches GemStone's own TestCase>>runCase.
    const code = debugTestMethodCode('MyTestCase', 'testAdd', 'UserGlobals');
    expect(code).toContain("[tc setUp. tc perform: #'testAdd'] ensure: [tc tearDown]");
    // And never the old, unprotected shape.
    expect(code).not.toMatch(/tc setUp\.\s*\n\s*\[tc perform/);
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
