import { describe, it, expect } from 'vitest';
import { syncClassBuildExpr } from '../syncProtocol';

describe('syncClassBuildExpr', () => {
  // On GemStone 3.6.x every string literal inside a GCI-executed doit compiles to
  // Unicode7, and `String = Unicode7` raises ArgumentError 2718 — so the symbol-list
  // lookup this expression depends on must compare interned Symbols, not strings.
  // Regression guard for issue #399 (class sync/export failed outright on 3.6.x).
  it('resolves the dictionary by interned Symbol, not string (3.6.x Unicode7 safety)', () => {
    const code = syncClassBuildExpr('UserGlobals', 'Object');
    expect(code).toContain("name asString asSymbol == #'UserGlobals'");
    expect(code).not.toMatch(/name asString = '/);
  });

  it('doubles a quote in the dictionary name inside the Symbol literal', () => {
    const code = syncClassBuildExpr("Od'd", 'Object');
    expect(code).toContain("name asString asSymbol == #'Od''d'");
  });

  // A dictionary in the symbol list can have a nil name — `SymbolDictionary new` produces one, and
  // the loop scans every dictionary until it matches, so one unnamed dictionary ahead of the target
  // is enough. Verified in-stone: `nil asSymbol` is a doesNotUnderstand (2010) that would kill the
  // whole scan, while `nil asString asSymbol` answers #nil and simply doesn't match. So the idiom
  // must be `name asString asSymbol`, never a bare `name asSymbol`. Regression guard for that.
  it('goes through asString so a nil-named dictionary does not doesNotUnderstand the scan', () => {
    const code = syncClassBuildExpr('UserGlobals', 'Object');
    expect(code).toContain('name asString asSymbol ==');
    expect(code).not.toMatch(/name asSymbol ==/);
  });
});
