import { describe, it, expect } from 'vitest';
import { syncClassBuildExpr } from '../syncProtocol';

describe('syncClassBuildExpr', () => {
  // On GemStone 3.6.x every string literal inside a GCI-executed doit compiles to
  // Unicode7, and `String = Unicode7` raises ArgumentError 2718 — so the symbol-list
  // lookup this expression depends on must compare interned Symbols, not strings.
  // Regression guard for issue #399 (class sync/export failed outright on 3.6.x).
  it('resolves the dictionary by interned Symbol, not string (3.6.x Unicode7 safety)', () => {
    const code = syncClassBuildExpr('UserGlobals', 'Object');
    expect(code).toContain("name asSymbol == #'UserGlobals'");
    expect(code).not.toMatch(/name asString = '/);
  });

  it('doubles a quote in the dictionary name inside the Symbol literal', () => {
    const code = syncClassBuildExpr("Od'd", 'Object');
    expect(code).toContain("name asSymbol == #'Od''d'");
  });
});
