// Must stay free of `vscode` so the server-plugin scripts in `client/bin/`,
// which run under `tsx` outside the extension host with only a minimal
// `vscode` stub (see `install-server-plugin.mjs`), can import it.

import { GCI_ERR_OP_IN_PROGRESS } from './gciConstants';
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
   * freed it, which a failed logout usually does too (see `logout`). A logout
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

  // GciTsCallInProgress can't answer for non-blocking calls (it answers 0 even
  // while one runs, a libgcits bug confirmed by GemTalk), so the session keeps
  // its own count of what GemStone would refuse a call for. See `isBusy`.
  // The same count keeps the non-blocking poll and read off a session a worker
  // owns, where they crash the process instead: see `handleUnlessAWorkerOwnsIt`.
  private hasUncollectedNonBlockingCall = false;
  private workerCallsInProgress = 0;

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
   * A non-blocking call whose result is not collected yet does not stop the
   * logout, but it can outlive it: a gem whose run has resumed a soft break
   * keeps running after its session logs out. To end such a run, ask whether
   * the session is busy before logging out, and stop the run first; once the
   * session is gone, that question throws.
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

  /**
   * Whether GemStone would refuse a call on this session right now because
   * another one is outstanding: a non-blocking call that has started and whose
   * result is not collected yet, whether the gem is still running it or has
   * finished, or a call running on a worker thread. Answers without a native
   * call.
   *
   * Only calls made through this object count: a second ActiveSession built
   * around the same native session does not see them. Throws once a logout has
   * freed the session, so a caller reports that rather than a busy session.
   */
  isBusy(): boolean {
    this.handle();
    return this.hasUncollectedNonBlockingCall || this.workerCallsInProgress > 0;
  }

  /**
   * Stop counting a non-blocking call whose result nobody will read, because
   * collecting it kept failing (a broken connection, say). Without this,
   * `isBusy` would answer true until logout and every caller would be told to
   * wait for a session that will never answer; with it, their calls reach
   * GemStone and report the session as it is.
   */
  forgetUncollectedCall(): void {
    this.handle();
    this.hasUncollectedNonBlockingCall = false;
  }

  // Each method below is a pass-through to the GciLibrary method of the same
  // name with this session's handle bound in. The contract lives there: the
  // GciTsXxx calls return a GciError, the rest throw GciLibraryError. Two
  // exceptions: after a logout, all of them throw (see `handle`), and the
  // non-blocking poll and collect also throw while a call on a worker thread
  // owns the session (see `handleUnlessAWorkerOwnsIt`).
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

  /** See {@link GciLibrary.GciTsClearStackAsync}. */
  async GciTsClearStackAsync(gsProcess: bigint) {
    return await this.trackWorkerCall((handle) => this.gci.GciTsClearStackAsync(handle, gsProcess));
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
  GciTsContinueWithAsync(
    gsProcess: bigint,
    replaceTopOfStack: bigint,
    continueWithError: GciError | null,
    flags: number,
  ) {
    return this.trackWorkerCall((handle) =>
      this.gci.GciTsContinueWithAsync(
        handle,
        gsProcess,
        replaceTopOfStack,
        continueWithError,
        flags,
      ),
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
    return this.trackNonBlockingCall((handle) =>
      this.gci.GciTsNbExecute(
        handle,
        sourceStr,
        sourceOop,
        contextObject,
        symbolList,
        flags,
        environmentId,
      ),
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
    return this.trackNonBlockingCall((handle) =>
      this.gci.GciTsNbPerform(handle, receiver, selector, selectorStr, args, flags, environmentId),
    );
  }

  /**
   * See {@link GciLibrary.GciTsNbPoll}.
   *
   * Refuses while a call on another thread owns the session: there, GemStone
   * 3.7.x crashes the whole process (SIGSEGV) instead of answering an error,
   * which takes down every extension sharing the host.
   *
   * @throws {GciLibraryError} If a call on another thread owns the session, or
   *   the session is logged out. Either way the library is not called.
   */
  GciTsNbPoll(timeoutMs: number) {
    // eslint-disable-next-line no-restricted-syntax -- guards only the session's ownership; each caller keeps its own availability guard
    return this.gci.GciTsNbPoll(this.handleUnlessAWorkerOwnsIt(), timeoutMs);
  }

  /**
   * See {@link GciLibrary.GciTsNbResult}.
   *
   * Refuses while a call on another thread owns the session: there, GemStone
   * 3.6.2 crashes the whole process (SIGSEGV) instead of answering an error,
   * which takes down every extension sharing the host.
   *
   * @throws {GciLibraryError} If a call on another thread owns the session, or
   *   the session is logged out. Either way the library is not called.
   */
  GciTsNbResult() {
    const collected = this.gci.GciTsNbResult(this.handleUnlessAWorkerOwnsIt());
    // Any other answer, a Smalltalk error included, means the call is over.
    // Only defensive: reading before the result is ready blocks until it is,
    // rather than answering GCI_ERR_OP_IN_PROGRESS (seen on 3.6.2).
    if (collected.err.number !== GCI_ERR_OP_IN_PROGRESS) this.hasUncollectedNonBlockingCall = false;
    return collected;
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
  GciTsPerformAsync(
    receiver: bigint,
    selector: bigint,
    selectorStr: string | null,
    args: bigint[],
    flags: number,
    environmentId: number,
  ) {
    return this.trackWorkerCall((handle) =>
      this.gci.GciTsPerformAsync(
        handle,
        receiver,
        selector,
        selectorStr,
        args,
        flags,
        environmentId,
      ),
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

  // Bookkeeping for `isBusy` and the worker guard. Unlike the library-level calls above, these need
  // the session.

  /** Runs `call` on this session's handle, counting it as a worker call until it settles. */
  private async trackWorkerCall<T>(call: (handle: unknown) => Promise<T>): Promise<T> {
    const handle = this.handle();
    this.workerCallsInProgress++;
    try {
      return await call(handle);
    } finally {
      this.workerCallsInProgress--;
    }
  }

  /**
   * Guards the native session for calls that crash the process, rather than
   * being refused, while a call on a worker thread owns the session.
   *
   * While a non-blocking call is uncollected, no worker call can own the
   * session: GemStone refuses to start the non-blocking call while a worker
   * call owns it, and a worker call that starts later is either refused or
   * gets the session only after the collect. So the guard lets the outstanding call be polled and read
   * whatever worker calls are in flight, and applies again once it is
   * collected, when a later worker call may take the session.
   *
   * @returns The native session handle.
   * @throws {GciLibraryError} If a worker call may own the session, or the
   *   session is logged out.
   */
  private handleUnlessAWorkerOwnsIt(): unknown {
    const handle = this.handle();
    if (this.workerCallsInProgress > 0 && !this.hasUncollectedNonBlockingCall) {
      throw GciLibraryError.withMessage(
        'A call is running on another thread for this GemStone session, and polling for or ' +
          'reading a non-blocking result now would crash the GCI library.',
      );
    }
    return handle;
  }

  /** Runs `start` on this session's handle, counting the call as uncollected once it has started. */
  private trackNonBlockingCall<T extends { success: boolean }>(start: (handle: unknown) => T): T {
    const started = start(this.handle());
    if (started.success) this.hasUncollectedNonBlockingCall = true;
    return started;
  }
}
