import { describe, it, expect, vi } from 'vitest';
import { mockKoffiModule } from '../../__mocks__/koffi';
import { GciOptionalFunctionName } from '../optionalFunctions';

/**
 * Pins the guard in `optionalFunc` that ties the symbol name to the koffi
 * prototype it is bound with. Each entry in `gciLibrary.ts`'s `_optional`
 * literal writes the symbol three times — as the key, as the `name` argument
 * and inside the signature string — and only the first two are related by the
 * `__gciOptional` brand. A copy-pasted entry naming a neighbouring symbol
 * would bind the wrong native function while `_missing` and `isAvailable`
 * reported the one it was keyed by, and `optionalFunc`'s catch would hide it.
 *
 * Background: `docs/explanation/gci-version-compatibility.md`.
 */

/**
 * Stands in for a library that exports everything except
 * `GciTsNbLoginFinished` — the shape that makes the guard's placement
 * observable, since a mismatched signature naming it is exactly what the
 * catch would otherwise swallow.
 */
vi.mock('koffi', () => {
  const stubFn = vi.fn();
  return mockKoffiModule((signature: string) => {
    if (signature.includes('GciTsNbLoginFinished')) {
      throw new Error(`Cannot find function 'GciTsNbLoginFinished' in shared library`);
    }
    return stubFn;
  });
});

import { GciLibrary } from '../../gciLibrary';

/** Reaches the private `optionalFunc` so a bad entry can be simulated without editing the literal. */
type OptionalFuncAccess = {
  optionalFunc(name: GciOptionalFunctionName, signature: string): unknown;
};

function optionalFuncOf(gci: GciLibrary) {
  return (gci as unknown as OptionalFuncAccess).optionalFunc.bind(gci);
}

/** The real `GciTsNbLoginFinished` prototype, as `gciLibrary.ts` binds it. */
const NB_LOGIN_FINISHED = `int GciTsNbLoginFinished(GciSessionPtr, _Out_ int *, _Out_ GciErrSType *)`;

describe('optionalFunc rejects a signature that declares a different symbol', () => {
  const gci = new GciLibrary('C:\\fake\\libgcits-3.7.5-64.dll');

  it('constructs, so every real entry declares the symbol it is keyed by', () => {
    expect(gci).toBeDefined();
  });

  it('throws when the signature declares a different symbol', () => {
    expect(() => optionalFuncOf(gci)('GciTsNbLogin', NB_LOGIN_FINISHED)).toThrow(
      /optionalFunc\('GciTsNbLogin'\) was given a signature declaring 'GciTsNbLoginFinished'/,
    );
  });

  it('compares the whole symbol, not a substring — `GciTsNbLogin` is a prefix of two other names', () => {
    // A `signature.includes(name)` guard would accept both of these.
    expect(() => optionalFuncOf(gci)('GciTsNbLogin', NB_LOGIN_FINISHED)).toThrow(/declaring/);
    expect(() =>
      optionalFuncOf(gci)(
        'GciTsNbLogin',
        `GciSessionPtr GciTsNbLogin_(const char *, _Out_ GciErrSType *)`,
      ),
    ).toThrow(/declaring 'GciTsNbLogin_'/);
  });

  it('throws rather than recording the wrong name as missing', () => {
    // The mismatched symbol is one koffi refuses, so a guard *inside* the try
    // would be swallowed by the catch: `optionalFunc` would return a stub and
    // quietly add `GciTsNbLogin` to `_missing`, flipping `isAvailable` for a
    // symbol the library actually exports.
    expect(() => optionalFuncOf(gci)('GciTsNbLogin', NB_LOGIN_FINISHED)).toThrow();
    expect(gci.isAvailable('GciTsNbLogin')).toBe(true);
  });

  it('accepts a signature that declares the symbol it is keyed by', () => {
    expect(() =>
      optionalFuncOf(gci)('GciTsNbLogin', `GciSessionPtr GciTsNbLogin(const char *, _Out_ int *)`),
    ).not.toThrow();
  });
});
