/*
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced from the vendored GCI headers by
 * `npm run generate:gci-optional-functions`. CI reruns that script and fails
 * on any diff, so an edit here is reverted rather than kept.
 *
 * A symbol lands here when the headers themselves gate it: declared in only a
 * suffix of the vendored revisions (`addedIn`, its oldest declaring revision),
 * or declared inside `#if defined(FLG_UNIX)` (`absentOn: 'win32'`). One
 * declared unconditionally in every revision is required, not optional, and is
 * omitted. Removal is not derivable — every vendored snapshot predates it — so
 * `removedIn` entries are hand-written in `optionalFunctions.ts`.
 *
 * Derived from 10 vendored revision(s), 3.6.2 through 3.7.5.
 */

export const HEADER_DERIVED_OPTIONAL_FUNCTIONS = {
  // Declared in every vendored revision, inside `#if defined(FLG_UNIX)`.
  GciTsNbLogin: { absentOn: 'win32' },
  GciTsNbLoginFinished: { absentOn: 'win32' },

  // Added in 3.7.0.
  GciTsDebugConnectToGem: { addedIn: '3.7.0', absentOn: 'win32' },
  GciTsDebugStartDebugService: { addedIn: '3.7.0', absentOn: 'win32' },
  GciTsNbPoll: { addedIn: '3.7.0' },

  // Added in 3.7.1.
  GciTsAddOopsToNsc: { addedIn: '3.7.1' },
  GciTsFetchNamedOops: { addedIn: '3.7.1' },
  GciTsFetchVaryingOops: { addedIn: '3.7.1' },
  GciTsStoreIdxOops: { addedIn: '3.7.1' },
  GciTsStoreNamedOops: { addedIn: '3.7.1' },

  // Added in 3.7.2.
  GciTsDirtyExportedObjs: { addedIn: '3.7.2' },
  GciTsFetchGbjInfo: { addedIn: '3.7.2' },
  GciTsKeepAliveCount: { addedIn: '3.7.2' },
  GciTsKeyfilePermissions: { addedIn: '3.7.2' },
  GciTsNewStringFromUtf16: { addedIn: '3.7.2' },
  GciTsPerformFetchOops: { addedIn: '3.7.2' },

  // Added in 3.7.4.1.
  GciTsLogin_: { addedIn: '3.7.4.1' },
  GciTsNbLogin_: { addedIn: '3.7.4.1', absentOn: 'win32' },
} as const;
