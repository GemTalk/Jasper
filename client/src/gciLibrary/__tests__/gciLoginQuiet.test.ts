import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GCI_LOGIN_PW_ENCRYPTED, GCI_LOGIN_QUIET } from '../../gciConstants';
import { mockKoffiModule } from '../../__mocks__/koffi';
import { fakeNativeSocketLibrary } from '../../__tests__/support/fakeNativeSocketLibrary';

// One stub per native function, so each login binding's arguments can be
// inspected independently. Keyed by the function name parsed out of the koffi
// signature string. vi.hoisted because the vi.mock factory below is hoisted
// above this module's imports.
const nativeStubs = vi.hoisted(() => new Map<string, ReturnType<typeof vi.fn>>());

vi.mock('koffi', () =>
  mockKoffiModule((signature: string) => {
    // `GciSessionPtr GciTsLogin(const char *, ...)` -> `GciTsLogin`
    const name = /(\w+)\s*\(/.exec(signature)?.[1] ?? signature;
    let stub = nativeStubs.get(name);
    if (!stub) {
      stub = vi.fn();
      nativeStubs.set(name, stub);
    }
    return stub;
  }),
);

import { GciLibrary } from '../../gciLibrary';

// Fixed inputs shared by every wrapper below. Their actual values don't
// matter — only whether `loginFlags` gets the quiet bit ORed in — so a
// single constant keeps that irrelevance obvious at the call site.
const NO_LOGIN_FLAGS = 0;
const NETLDI_NAME = 'netldi';

/**
 * Builds the full positional argument list a login wrapper's native stub is
 * expected to receive. `netldiArg` is the netldi name for wrappers that take
 * one (the `_` variants); omit it for wrappers that don't.
 */
function expectedLoginCall({
  netldiArg,
  loginFlags,
  outParams,
}: {
  netldiArg?: string;
  loginFlags: number;
  outParams: unknown[];
}): unknown[] {
  const netldiArgs = netldiArg === undefined ? [] : [netldiArg];
  return [
    null,
    null,
    null,
    0,
    null,
    'user',
    'password',
    ...netldiArgs,
    loginFlags,
    0,
    ...outParams,
  ];
}

// GciTsLogin/GciTsLogin_ report executedSessionInit and err; the Nb variants
// report only a loginPollSocket.
const BLOCKING_OUT_PARAMS = [[0], {}];
const NON_BLOCKING_OUT_PARAMS = [[0]];

function lastCallTo(name: string): unknown[] {
  const stub = nativeStubs.get(name);
  expect(stub, `no native stub recorded for ${name}`).toBeDefined();
  expect(stub!).toHaveBeenCalledTimes(1);
  return stub!.mock.calls[0];
}

interface LoginWrapperFixture {
  name: string;
  netldiArg?: string;
  outParams: unknown[];
  invoke: (gci: GciLibrary, loginFlags: number) => void;
}

// One entry per raw login wrapper, so both scenarios below (no flags,
// caller-supplied flags) run identically across all four — the plain vs.
// netldi and blocking vs. non-blocking distinctions are declared once here
// instead of duplicated per test.
const WRAPPERS: LoginWrapperFixture[] = [
  {
    name: 'GciTsLogin',
    outParams: BLOCKING_OUT_PARAMS,
    invoke: (gci, loginFlags) =>
      gci.GciTsLogin(null, null, null, false, null, 'user', 'password', loginFlags, 0),
  },
  {
    name: 'GciTsLogin_',
    netldiArg: NETLDI_NAME,
    outParams: BLOCKING_OUT_PARAMS,
    invoke: (gci, loginFlags) =>
      gci.GciTsLogin_(
        null,
        null,
        null,
        false,
        null,
        'user',
        'password',
        NETLDI_NAME,
        loginFlags,
        0,
      ),
  },
  {
    name: 'GciTsNbLogin',
    outParams: NON_BLOCKING_OUT_PARAMS,
    invoke: (gci, loginFlags) =>
      gci.GciTsNbLogin(null, null, null, false, null, 'user', 'password', loginFlags, 0),
  },
  {
    name: 'GciTsNbLogin_',
    netldiArg: NETLDI_NAME,
    outParams: NON_BLOCKING_OUT_PARAMS,
    invoke: (gci, loginFlags) =>
      gci.GciTsNbLogin_(
        null,
        null,
        null,
        false,
        null,
        'user',
        'password',
        NETLDI_NAME,
        loginFlags,
        0,
      ),
  },
];

describe('login wrappers force GCI_LOGIN_QUIET', () => {
  let gci: GciLibrary;

  beforeEach(() => {
    nativeStubs.clear();
    gci = new GciLibrary('/fake/libgcits.dylib', fakeNativeSocketLibrary());
  });

  describe.each(WRAPPERS)('$name', ({ name, netldiArg, outParams, invoke }) => {
    it('passes the quiet bit when the caller asks for no flags', () => {
      invoke(gci, NO_LOGIN_FLAGS);

      expect(lastCallTo(name)).toEqual(
        expectedLoginCall({ netldiArg, loginFlags: GCI_LOGIN_QUIET, outParams }),
      );
    });

    it('adds the quiet bit to caller-supplied flags instead of replacing them', () => {
      invoke(gci, GCI_LOGIN_PW_ENCRYPTED);

      expect(lastCallTo(name)).toEqual(
        expectedLoginCall({
          netldiArg,
          loginFlags: GCI_LOGIN_QUIET | GCI_LOGIN_PW_ENCRYPTED,
          outParams,
        }),
      );
    });
  });
});
