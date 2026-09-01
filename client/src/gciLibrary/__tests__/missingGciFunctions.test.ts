import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockKoffiModule } from '../../__mocks__/koffi';
import { GCI_OPTIONAL_FUNCTIONS, GciOptionalFunctionName } from '../optionalFunctions';

/**
 * Proves the `optionalFunc` contract from the library's own side: when *every*
 * optional symbol fails to bind, `GciLibrary` still constructs, each missing
 * binding throws a named error at its call site rather than crashing, and
 * `isAvailable` reports the absence so callers can fall back.
 *
 * A synthetic worst case, not a faithful Windows DLL — a real one is missing
 * only the five `FLG_UNIX` symbols.
 * Background: `docs/explanation/gci-version-compatibility.md`.
 */

/** Every optional binding, straight from the registry; the mock refuses all of them. */
const OPTIONAL_FUNCTIONS = Object.keys(GCI_OPTIONAL_FUNCTIONS) as GciOptionalFunctionName[];

// koffi has to be mocked before GciLibrary is imported, hence the deliberate
// mid-file import below. `lib.func` throws for any signature naming an optional
// symbol, which is how koffi itself reports a symbol the library doesn't export.
vi.mock('koffi', () => {
  const stubFn = vi.fn();
  return mockKoffiModule((signature: string) => {
    for (const name of OPTIONAL_FUNCTIONS) {
      if (signature.includes(name)) {
        throw new Error(`Cannot find function '${name}' in shared library`);
      }
    }
    return stubFn;
  });
});

import { GciLibrary } from '../../gciLibrary';

describe('GciLibrary against a library exporting no optional functions', () => {
  let gci: GciLibrary;

  beforeEach(() => {
    gci = new GciLibrary('C:\\fake\\libgcits-3.7.5-64.dll');
  });

  it('constructs successfully when optional functions are missing', () => {
    expect(gci).toBeDefined();
  });

  // Exhaustive by construction: a new GCI_OPTIONAL_FUNCTIONS entry with no
  // invocation here is a compile error, not a silently unasserted symbol.
  const invoke: Record<GciOptionalFunctionName, () => unknown> = {
    GciTsNbPoll: () => gci.GciTsNbPoll(null, 0),
    GciTsDebugConnectToGem: () => gci.GciTsDebugConnectToGem(12345),
    GciTsDebugStartDebugService: () => gci.GciTsDebugStartDebugService(null, 0n),
    GciTsFetchNamedOops: () => gci.GciTsFetchNamedOops(null, 0n, 0n, 1),
    GciTsFetchVaryingOops: () => gci.GciTsFetchVaryingOops(null, 0n, 0n, 1),
    GciTsStoreNamedOops: () => gci.GciTsStoreNamedOops(null, 0n, 0n, []),
    GciTsStoreIdxOops: () => gci.GciTsStoreIdxOops(null, 0n, 0n, []),
    GciTsAddOopsToNsc: () => gci.GciTsAddOopsToNsc(null, 0n, []),
    GciTsPerformFetchOops: () => gci.GciTsPerformFetchOops(null, 0n, 'foo', [], 1),
    GciTsFetchGbjInfo: () => gci.GciTsFetchGbjInfo(null, 0n, false, 64),
    GciTsNewStringFromUtf16: () => gci.GciTsNewStringFromUtf16(null, [], 0),
    GciTsDirtyExportedObjs: () => gci.GciTsDirtyExportedObjs(null, 1),
    GciTsKeepAliveCount: () => gci.GciTsKeepAliveCount(null),
    GciTsKeyfilePermissions: () => gci.GciTsKeyfilePermissions(null),
    GciTsLogin_: () => gci.GciTsLogin_(null, null, null, false, null, 'user', 'pass', null, 0, 0),
    GciTsNbLogin_: () =>
      gci.GciTsNbLogin_(null, null, null, false, null, 'user', 'pass', null, 0, 0),
    GciTsNbLogin: () => gci.GciTsNbLogin(null, null, null, false, null, 'user', 'pass', 0, 0),
    GciTsNbLoginFinished: () => gci.GciTsNbLoginFinished(null),
    GciTsEncrypt: () => gci.GciTsEncrypt('password'),
  };

  it.each(OPTIONAL_FUNCTIONS)('throws a descriptive error when calling %s', (name) => {
    expect(invoke[name]).toThrow(`${name} is not available in this GCI library`);
  });

  // Regression guard for a real bug: GciTsNbLogin was once bound by a bare
  // try/catch that never recorded it as missing, so isAvailable answered `true`
  // on Windows and the non-blocking login path never fell back.
  it('reports GciTsNbLogin as unavailable', () => {
    expect(gci.isAvailable('GciTsNbLogin')).toBe(false);
  });

  it('reports non-blocking login as unsupported', () => {
    expect(gci.supportsNonBlockingLogin()).toBe(false);
  });
});
