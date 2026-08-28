/**
 * The single source of truth for which `GciTs*` bindings may be absent from a
 * loaded library, and why. Every field here is machine-verified against
 * `vendor/gci-headers/` by `optionalFunctions.headers.test.ts` — this module
 * itself makes no claim that isn't checked there.
 */

export type GciAbsenceReason = {
  /** Earliest vendored revision declaring the symbol; absent on every earlier release. */
  addedIn?: string;
  /** The declaration sits inside `#if defined(FLG_UNIX)` — absent from the Windows client DLL. */
  absentOn?: 'win32';
  /** Gone from this release onward. The one field the header snapshot can't check going forward. */
  removedIn?: '4.0';
  /** Prose context; the only field no test can check. */
  note?: string;
};

export const GCI_OPTIONAL_FUNCTIONS = {
  GciTsNbPoll: { addedIn: '3.7.0' },
  GciTsDebugConnectToGem: { addedIn: '3.7.0', absentOn: 'win32' },
  GciTsDebugStartDebugService: { addedIn: '3.7.0', absentOn: 'win32' },
  GciTsFetchNamedOops: { addedIn: '3.7.1' },
  GciTsFetchVaryingOops: { addedIn: '3.7.1' },
  GciTsStoreNamedOops: { addedIn: '3.7.1' },
  GciTsStoreIdxOops: { addedIn: '3.7.1' },
  GciTsAddOopsToNsc: { addedIn: '3.7.1' },
  GciTsPerformFetchOops: { addedIn: '3.7.2' },
  GciTsFetchGbjInfo: { addedIn: '3.7.2' },
  GciTsNewStringFromUtf16: { addedIn: '3.7.2' },
  GciTsDirtyExportedObjs: { addedIn: '3.7.2' },
  GciTsKeepAliveCount: { addedIn: '3.7.2' },
  GciTsKeyfilePermissions: { addedIn: '3.7.2' },
  GciTsLogin_: { addedIn: '3.7.4.1', note: 'the login path uses GciTsLogin' },
  GciTsNbLogin_: { addedIn: '3.7.4.1', absentOn: 'win32' },
  GciTsNbLogin: { absentOn: 'win32' },
  GciTsNbLoginFinished: { absentOn: 'win32' },
  GciTsEncrypt: {
    removedIn: '4.0',
    note:
      '4.0 is not vendored (pre-GA private build) but declaration and comment block was deleted from gcits.hf, ' +
      'so this is exempted rather than verified in optionalFunctions.headers.test.ts.',
  },
} as const satisfies Record<string, GciAbsenceReason>;

export type GciOptionalFunctionName = keyof typeof GCI_OPTIONAL_FUNCTIONS;
