// Must stay free of `vscode` so the server-plugin scripts in `client/bin/`,
// which run under `tsx` outside the extension host with only a minimal
// `vscode` stub (see `install-server-plugin.mjs`), can import it.

import type { GciError, GciLibrary } from './gciLibrary';
import { GciLibraryError } from './gciLibraryError';
import type { GciOptionalFunctionName } from './gciLibrary/optionalFunctions';
import { GemStoneLogin, gemNrsFor, stoneNrsFor } from './loginTypes';
import type { TransactionMode } from './queries/transactionMode';

const loggedOut = (): never => {
  throw GciLibraryError.withMessage('The GemStone session is logged out.');
};

export class ActiveSession {
  enhancedInspectorAvailable?: boolean;
  /** Whether the server-side refactoring engine (GsRenameInstanceVariableRefactoring)
   *  is resolvable in this session's stone. Drives the `gemstone.rbSupportAvailable`
   *  context key and the Explorer's rename-instance-variable command. Latched at
   *  login (and re-probed after an install) — see refactoringAvailability.ts. */
  rbSupportAvailable?: boolean;
  /** `System myUserProfile symbolList`, memoized on first use — see
   *  `sessionSymbolListOop` in debugQueries.ts, which owns this field. */
  symbolListOop?: bigint;
  /** The session's GemStone transaction mode, as last read from the stone, or
   *  `undefined` when it has not been read (or could not be). Never assumed:
   *  `STN_GEM_INITIAL_TRANSACTION_MODE` lets a stone hand out any of the three
   *  at login. Owned by `SessionManager.refreshTransactionState`. */
  transactionMode?: TransactionMode;
  /** Whether the session was inside a transaction when the state was last read.
   *  This — not the mode — decides whether a commit can land. Owned by
   *  `SessionManager.refreshTransactionState`. */
  inTransaction?: boolean;
  /** Whether `GemAutoServiceSigAbort` has been armed on this session — set only
   *  once arming succeeds, so a failed attempt is retried on the next read that
   *  finds the session in `manualBegin`. Owned by `SessionManager`. */
  sigAbortArmed?: boolean;

  /**
   * Answers the native session handle, or throws a GciLibraryError once a logout has
   * freed it, which a failed logout usually does too (see `logout`). `GciTsLogout`
   * frees the native session, and any GCI call on
   * a freed handle is undefined behavior, SEGV included; a logout swaps this
   * for a thrower, so no call can reach the library with a freed handle.
   *
   * Only one-line pass-throughs call it. Logic that spans several GCI calls
   * goes through those pass-throughs, never a handle read once and kept: a
   * logout during an `await` would free it under the caller.
   */
  private handle: () => unknown;

  // Counts down, so a transient login's id never matches a registered session's
  // (those count up from 1) and per-session state keyed by id stays apart.
  private static nextTransientId = -1;

  constructor(
    public id: number,
    private readonly gci: GciLibrary,
    handle: unknown,
    public login: GemStoneLogin,
    public stoneVersion: string,
  ) {
    this.handle = () => handle;
  }

  /**
   * Open a new GemStone login, as `login` describes, on this session's GCI
   * library. The library outlives its sessions' logouts, so this session may
   * already be logged out.
   *
   * Answers the new session, which has a negative id no other session has and
   * is not registered anywhere, or no session and GemStone's error when the
   * login is refused. The caller owns the new session and must log it out.
   */
  transientLogin(login: GemStoneLogin): { session: ActiveSession | undefined; err: GciError } {
    const result = this.gci.GciTsLogin(
      stoneNrsFor(login),
      login.host_user || null,
      login.host_password || null,
      false,
      gemNrsFor(login),
      login.gs_user,
      login.gs_password,
      0,
      0,
    );
    if (!result.session) return { session: undefined, err: result.err };
    return {
      session: new ActiveSession(
        ActiveSession.nextTransientId--,
        this.gci,
        result.session,
        login,
        this.stoneVersion,
      ),
      err: result.err,
    };
  }

  /**
   * Logs the session out, warning on the console instead of answering
   * GemStone's error. Once the session is gone, every method that needs its
   * handle throws, a second logout included. A failed logout usually frees it
   * too; only a refusal because a call is still in progress leaves it usable.
   *
   * @returns whether the session is gone; false only for that refusal.
   */
  logout(): boolean {
    const { sessionFreed } = this.gci.logout(this.handle());
    if (sessionFreed) this.handle = loggedOut;
    return sessionFreed;
  }

  /**
   * Whether a logout has freed this session. For code that has to tell "the
   * session went away under me" from a real failure — a breakpoint rule that
   * could not be judged because the session is gone has nothing to stop at.
   */
  isLoggedOut(): boolean {
    return this.handle === loggedOut;
  }

  // Each method below is a pass-through to the GciLibrary method of the same
  // name with this session's handle bound in. The contract lives there: the
  // GciTsXxx calls return a GciError, the rest throw GciLibraryError. One
  // exception: after a logout, all of them throw (see `handle`).
  // Availability guards for optional bindings (e.g. GciTsNbPoll) stay with
  // the caller.

  /** See {@link GciLibrary.GciTsAbort}. */
  GciTsAbort() {
    return this.gci.GciTsAbort(this.handle());
  }

  /** See {@link GciLibrary.GciTsBegin}. */
  GciTsBegin() {
    return this.gci.GciTsBegin(this.handle());
  }

  /** See {@link GciLibrary.GciTsBreak}. */
  GciTsBreak(hard: boolean) {
    return this.gci.GciTsBreak(this.handle(), hard);
  }

  /** See {@link GciLibrary.GciTsCallInProgress}. */
  GciTsCallInProgress() {
    return this.gci.GciTsCallInProgress(this.handle());
  }

  /** See {@link GciLibrary.GciTsClearStack}. */
  GciTsClearStack(gsProcess: bigint) {
    return this.gci.GciTsClearStack(this.handle(), gsProcess);
  }

  /** See {@link GciLibrary.GciTsCommit}. */
  GciTsCommit() {
    return this.gci.GciTsCommit(this.handle());
  }

  /** See {@link GciLibrary.GciTsContinueWith}. */
  GciTsContinueWith(
    gsProcess: bigint,
    replaceTopOfStack: bigint,
    continueWithError: GciError | null,
    flags: number,
  ) {
    return this.gci.GciTsContinueWith(
      this.handle(),
      gsProcess,
      replaceTopOfStack,
      continueWithError,
      flags,
    );
  }

  /** See {@link GciLibrary.GciTsContinueWithAsync}. */
  async GciTsContinueWithAsync(
    gsProcess: bigint,
    replaceTopOfStack: bigint,
    continueWithError: GciError | null,
    flags: number,
  ) {
    return await this.gci.GciTsContinueWithAsync(
      this.handle(),
      gsProcess,
      replaceTopOfStack,
      continueWithError,
      flags,
    );
  }

  /** See {@link GciLibrary.GciTsExecute}. */
  GciTsExecute(
    sourceStr: string | null,
    sourceOop: bigint,
    contextObject: bigint,
    symbolList: bigint,
    flags: number,
    environmentId: number,
  ) {
    return this.gci.GciTsExecute(
      this.handle(),
      sourceStr,
      sourceOop,
      contextObject,
      symbolList,
      flags,
      environmentId,
    );
  }

  /** See {@link GciLibrary.GciTsExecuteFetchBytes}. */
  GciTsExecuteFetchBytes(
    sourceStr: string | null,
    sourceSize: number,
    sourceOop: bigint,
    contextObject: bigint,
    symbolList: bigint,
    maxResultSize: number,
  ) {
    return this.gci.GciTsExecuteFetchBytes(
      this.handle(),
      sourceStr,
      sourceSize,
      sourceOop,
      contextObject,
      symbolList,
      maxResultSize,
    );
  }

  /** See {@link GciLibrary.GciTsFetchChars}. */
  GciTsFetchChars(theObject: bigint, startIndex: bigint, maxSize: number) {
    return this.gci.GciTsFetchChars(this.handle(), theObject, startIndex, maxSize);
  }

  /** See {@link GciLibrary.GciTsFetchClass}. */
  GciTsFetchClass(obj: bigint) {
    return this.gci.GciTsFetchClass(this.handle(), obj);
  }

  /** See {@link GciLibrary.GciTsFetchObjInfo}. */
  GciTsFetchObjInfo(objId: bigint, addToExportSet: boolean, bufSize: number) {
    return this.gci.GciTsFetchObjInfo(this.handle(), objId, addToExportSet, bufSize);
  }

  /** See {@link GciLibrary.GciTsFetchOops}. */
  GciTsFetchOops(theObject: bigint, startIndex: bigint, numOops: number) {
    return this.gci.GciTsFetchOops(this.handle(), theObject, startIndex, numOops);
  }

  /** See {@link GciLibrary.GciTsFetchSize}. */
  GciTsFetchSize(obj: bigint) {
    return this.gci.GciTsFetchSize(this.handle(), obj);
  }

  /** See {@link GciLibrary.GciTsFetchUtf8}. */
  GciTsFetchUtf8(obj: bigint, destSize: number) {
    return this.gci.GciTsFetchUtf8(this.handle(), obj, destSize);
  }

  /** See {@link GciLibrary.GciTsFetchVaryingSize}. */
  GciTsFetchVaryingSize(obj: bigint) {
    return this.gci.GciTsFetchVaryingSize(this.handle(), obj);
  }

  /** See {@link GciLibrary.GciTsI64ToOop}. */
  GciTsI64ToOop(arg: bigint) {
    return this.gci.GciTsI64ToOop(this.handle(), arg);
  }

  /** See {@link GciLibrary.GciTsNbExecute}. */
  GciTsNbExecute(
    sourceStr: string | null,
    sourceOop: bigint,
    contextObject: bigint,
    symbolList: bigint,
    flags: number,
    environmentId: number,
  ) {
    return this.gci.GciTsNbExecute(
      this.handle(),
      sourceStr,
      sourceOop,
      contextObject,
      symbolList,
      flags,
      environmentId,
    );
  }

  /** See {@link GciLibrary.GciTsNbPerform}. */
  GciTsNbPerform(
    receiver: bigint,
    selector: bigint,
    selectorStr: string | null,
    args: bigint[],
    flags: number,
    environmentId: number,
  ) {
    return this.gci.GciTsNbPerform(
      this.handle(),
      receiver,
      selector,
      selectorStr,
      args,
      flags,
      environmentId,
    );
  }

  /** See {@link GciLibrary.GciTsNbPoll}. */
  GciTsNbPoll(timeoutMs: number) {
    // eslint-disable-next-line no-restricted-syntax -- a pass-through; each caller keeps its own availability guard
    return this.gci.GciTsNbPoll(this.handle(), timeoutMs);
  }

  /** See {@link GciLibrary.GciTsNbResult}. */
  GciTsNbResult() {
    return this.gci.GciTsNbResult(this.handle());
  }

  /** See {@link GciLibrary.GciTsNewString}. */
  GciTsNewString(cString: string) {
    return this.gci.GciTsNewString(this.handle(), cString);
  }

  /** See {@link GciLibrary.GciTsNewSymbol}. */
  GciTsNewSymbol(cString: string) {
    return this.gci.GciTsNewSymbol(this.handle(), cString);
  }

  /** See {@link GciLibrary.GciTsObjExists}. */
  GciTsObjExists(obj: bigint) {
    return this.gci.GciTsObjExists(this.handle(), obj);
  }

  /** See {@link GciLibrary.GciTsOopToI64}. */
  GciTsOopToI64(oop: bigint) {
    return this.gci.GciTsOopToI64(this.handle(), oop);
  }

  /** See {@link GciLibrary.GciTsPerform}. */
  GciTsPerform(
    receiver: bigint,
    selector: bigint,
    selectorStr: string | null,
    args: bigint[],
    flags: number,
    environmentId: number,
  ) {
    return this.gci.GciTsPerform(
      this.handle(),
      receiver,
      selector,
      selectorStr,
      args,
      flags,
      environmentId,
    );
  }

  /** See {@link GciLibrary.GciTsPerformAsync}. */
  async GciTsPerformAsync(
    receiver: bigint,
    selector: bigint,
    selectorStr: string | null,
    args: bigint[],
    flags: number,
    environmentId: number,
  ) {
    return await this.gci.GciTsPerformAsync(
      this.handle(),
      receiver,
      selector,
      selectorStr,
      args,
      flags,
      environmentId,
    );
  }

  /** See {@link GciLibrary.GciTsPerformFetchBytes}. */
  GciTsPerformFetchBytes(
    receiver: bigint,
    selectorStr: string,
    args: bigint[],
    maxResultSize: number,
  ) {
    return this.gci.GciTsPerformFetchBytes(
      this.handle(),
      receiver,
      selectorStr,
      args,
      maxResultSize,
    );
  }

  /** See {@link GciLibrary.GciTsReleaseObjs}. */
  GciTsReleaseObjs(oops: bigint[]) {
    return this.gci.GciTsReleaseObjs(this.handle(), oops);
  }

  /** See {@link GciLibrary.GciTsSaveObjs}. */
  GciTsSaveObjs(oops: bigint[]) {
    return this.gci.GciTsSaveObjs(this.handle(), oops);
  }

  /** See {@link GciLibrary.GciTsSocket}. */
  GciTsSocket() {
    return this.gci.GciTsSocket(this.handle());
  }

  /** See {@link GciLibrary.executeAndFetchString}. */
  executeAndFetchString(code: string) {
    return this.gci.executeAndFetchString(this.handle(), code);
  }

  /** See {@link GciLibrary.oopToInteger}. */
  oopToInteger(oop: bigint) {
    return this.gci.oopToInteger(this.handle(), oop);
  }

  /** See {@link GciLibrary.resolveSymbol}. */
  resolveSymbol(symbolName: string) {
    return this.gci.resolveSymbol(this.handle(), symbolName);
  }

  /** See {@link GciLibrary.utf8ClassOop}. */
  utf8ClassOop() {
    return this.gci.utf8ClassOop(this.handle());
  }

  // Library-level: these never touch the session handle, so they stay valid
  // after logout.

  /** See {@link GciLibrary.GciTsOopIsSpecial}. */
  GciTsOopIsSpecial(oop: bigint) {
    return this.gci.GciTsOopIsSpecial(oop);
  }

  /** See {@link GciLibrary.GciTsVersion}. */
  GciTsVersion() {
    return this.gci.GciTsVersion();
  }

  /** See {@link GciLibrary.isAvailable}. */
  isAvailable(name: GciOptionalFunctionName) {
    return this.gci.isAvailable(name);
  }
}
