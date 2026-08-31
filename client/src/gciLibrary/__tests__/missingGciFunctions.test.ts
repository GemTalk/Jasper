import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockKoffiModule } from '../../__mocks__/koffi';
import { GCI_OPTIONAL_FUNCTIONS, GciOptionalFunctionName } from '../optionalFunctions';

// Windows client DLLs, and libraries older than a given binding's addedIn
// floor, don't export these — see optionalFunctions.ts for why each one.
const OPTIONAL_FUNCTIONS = Object.keys(GCI_OPTIONAL_FUNCTIONS) as GciOptionalFunctionName[];

// Mock koffi before importing GciLibrary
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

// ── GciLibrary optional function bindings ────────────────

describe('GciLibrary with Windows client DLL (missing optional functions)', () => {
  let gci: GciLibrary;

  beforeEach(() => {
    // Constructor should succeed even though every optional function is missing
    gci = new GciLibrary('C:\\fake\\libgcits-3.7.5-64.dll');
  });

  it('constructs successfully when optional functions are missing', () => {
    expect(gci).toBeDefined();
  });

  // A Record makes this exhaustive: adding an entry to GCI_OPTIONAL_FUNCTIONS
  // without adding its invocation here is a compile error.
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

  // The one fix this whole test file exists to verify: on a real Windows
  // client DLL, GciTsNbLogin is absent, so isAvailable must say so and the
  // non-blocking login path must know to fall back.
  it('reports GciTsNbLogin as unavailable', () => {
    expect(gci.isAvailable('GciTsNbLogin')).toBe(false);
  });

  it('reports non-blocking login as unsupported', () => {
    expect(gci.supportsNonBlockingLogin()).toBe(false);
  });
});
