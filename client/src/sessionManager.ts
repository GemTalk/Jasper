import * as vscode from 'vscode';
import { GciLibrary, GciError } from './gciLibrary';
import { OOP_NIL } from './gciConstants';
import { GemStoneLogin, gemNrsFor, loginLabel, stoneNrsFor } from './loginTypes';
import { logInfo } from './gciLog';
import { wrapWithEnhancedInspectorPerfProxy } from './enhancedInspector/enhancedInspectorPerfTracker';
import { installTranscriptSink } from './transcriptSink';
import { installMethodHistory } from './methodHistory/methodHistoryServer';

// How often the non-blocking login path polls GciTsNbLoginFinished. Small enough
// that connect latency is imperceptible, large enough not to busy-spin while the
// background login thread works.
const LOGIN_POLL_INTERVAL_MS = 25;

export interface ActiveSession {
  id: number;
  gci: GciLibrary;
  handle: unknown;
  login: GemStoneLogin;
  stoneVersion: string;
  enhancedInspectorAvailable?: boolean;
  /** Whether the server-side refactoring engine (GsRenameInstanceVariableRefactoring)
   *  is resolvable in this session's stone. Drives the `gemstone.rbSupportAvailable`
   *  context key and the Explorer's rename-instance-variable command. Latched at
   *  login (and re-probed after an install) — see refactoringAvailability.ts. */
  rbSupportAvailable?: boolean;
}

/**
 * Decide whether a new login may proceed given the current session count.
 * Returns an error message to show the user, or null when the login is allowed.
 *
 * Pure (no VS Code / GCI dependencies) so the policy can be unit-tested directly.
 * Single mode (the default) caps the extension at one session; multiple mode
 * still blocks a second session when a custom export path lacks {session}, since
 * concurrent sessions would otherwise overwrite each other's exported files.
 */
export function evaluateLoginPolicy(
  mode: string,
  existingCount: number,
  exportPath: string,
): string | null {
  if (existingCount === 0) return null;
  if (mode !== 'multiple') {
    return (
      'Only one GemStone session is allowed at a time. Log out of the current session before ' +
      'logging in again. (Set "gemstone.sessionMode": "multiple" to enable concurrent sessions.)'
    );
  }
  if (exportPath && !exportPath.includes('{session}')) {
    return (
      'Only one session is allowed when the export path does not include {session}. ' +
      'Log out of the current session before logging in again, or add {session} to your export path.'
    );
  }
  return null;
}

export class SessionManager {
  private sessions = new Map<number, ActiveSession>();
  private gciInstances = new Map<string, GciLibrary>();
  private nextId = 1;
  // Logins started but not yet registered as sessions (the async window of
  // loginAsync). Counted alongside sessions for the single-session policy.
  private pendingLogins = 0;

  private _selectedId: number | null = null;
  private _onDidChangeSelection = new vscode.EventEmitter<number | null>();
  readonly onDidChangeSelection = this._onDidChangeSelection.event;

  // Fires with a session id whenever a session leaves the manager (logout or
  // shutdown), regardless of whether it was the selected one. Unlike
  // onDidChangeSelection (which only fires for the selected session), this lets
  // listeners — e.g. the stale-tab reaper — react to *any* session going away.
  private _onDidRemoveSession = new vscode.EventEmitter<number>();
  readonly onDidRemoveSession = this._onDidRemoveSession.event;

  // Fires with a session id whenever a session joins the manager. There was no
  // such signal: onDidChangeSelection is the only thing a new session fired, and
  // finalizeSession auto-selects only the *first* one — so a second login was
  // silent, and anything drawing session state (the panel's login rows) went on
  // showing "Log in" for a login that was already connected.
  private _onDidAddSession = new vscode.EventEmitter<number>();
  readonly onDidAddSession = this._onDidAddSession.event;

  get selectedId(): number | null {
    return this._selectedId;
  }

  selectSession(id: number): void {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Session not found');
    this._selectedId = id;
    this._onDidChangeSelection.fire(id);
    vscode.commands.executeCommand('setContext', 'gemstone.hasActiveSession', true);
  }

  getSession(id: number): ActiveSession | undefined {
    return this.sessions.get(id);
  }

  getSelectedSession(): ActiveSession | undefined {
    if (this._selectedId !== null) {
      return this.sessions.get(this._selectedId);
    }
    return undefined;
  }

  async resolveSession(): Promise<ActiveSession | undefined> {
    const selected = this.getSelectedSession();
    if (selected) return selected;

    const sessions = this.getSessions();
    if (sessions.length === 0) {
      vscode.window.showErrorMessage('No GemStone sessions are active. Please log in first.');
      return undefined;
    }
    if (sessions.length === 1) {
      this.selectSession(sessions[0].id);
      return sessions[0];
    }

    const items = sessions.map((s) => ({
      label: loginLabel(s.login),
      description: `Session ${s.id}`,
      session: s,
    }));
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a GemStone session for code execution',
    });
    if (!pick) return undefined;
    this.selectSession(pick.session.id);
    return pick.session;
  }

  private getGciLibrary(libraryPath: string): GciLibrary {
    let gci = this.gciInstances.get(libraryPath);
    if (!gci) {
      gci = wrapWithEnhancedInspectorPerfProxy(new GciLibrary(libraryPath));
      this.gciInstances.set(libraryPath, gci);
    }
    return gci;
  }

  // Blocking login: GciTsLogin holds the calling thread until the handshake
  // completes, so a slow connect freezes the extension host. Prefer loginAsync
  // for interactive connects; this stays for the synchronous callers (and is the
  // fallback loginAsync uses on Windows / older libraries).
  login(login: GemStoneLogin, libraryPath: string): ActiveSession {
    const { gci, stoneNrs, gemNrs } = this.prepareLogin(login, libraryPath);
    const handle = this.blockingLoginHandle(gci, stoneNrs, gemNrs, login);
    return this.finalizeSession(gci, login, handle);
  }

  /**
   * Like {@link login}, but uses the non-blocking GciTsNbLogin path when the
   * library supports it (non-Windows builds since 3.6.2): the handshake runs on
   * a background thread while this polls GciTsNbLoginFinished, yielding to the
   * event loop between polls so the extension host — and any progress UI — stay
   * responsive during a slow connect. Falls back to the blocking GciTsLogin on
   * Windows / older libraries.
   */
  async loginAsync(login: GemStoneLogin, libraryPath: string): Promise<ActiveSession> {
    const { gci, stoneNrs, gemNrs } = this.prepareLogin(login, libraryPath);

    // Count this attempt while it is in flight so a concurrent login (e.g. to a
    // different stone) sees it in the single-session policy check — a guarantee
    // the blocking path got for free by completing atomically.
    this.pendingLogins++;
    try {
      // Yield once so the caller's progress notification paints before we touch
      // the GCI — and, on the blocking fallback, before GciTsLogin freezes the
      // extension-host thread.
      await this.sleep(0);

      const handle = gci.supportsNonBlockingLogin()
        ? await this.nonBlockingLoginHandle(gci, stoneNrs, gemNrs, login)
        : this.blockingLoginHandle(gci, stoneNrs, gemNrs, login);

      return this.finalizeSession(gci, login, handle);
    } finally {
      this.pendingLogins--;
    }
  }

  // Validate the session policy and resolve the shared connect parameters (the
  // GCI library plus the stone/gem NRS strings). Throws with a user-facing
  // message when the single-session / export-path policy forbids another login.
  private prepareLogin(
    login: GemStoneLogin,
    libraryPath: string,
  ): { gci: GciLibrary; stoneNrs: string; gemNrs: string } {
    // Single mode (the default) allows one session at a time; multiple mode still
    // guards against export-path conflicts. See evaluateLoginPolicy. Pending
    // logins count toward the total so the cap holds during loginAsync's window.
    const config = vscode.workspace.getConfiguration('gemstone');
    const mode = config.get<string>('sessionMode', 'single');
    const customPath = config.get<string>('exportPath', '').trim();
    const policyError = evaluateLoginPolicy(
      mode,
      this.sessions.size + this.pendingLogins,
      customPath,
    );
    if (policyError) {
      throw new Error(policyError);
    }

    const gci = this.getGciLibrary(libraryPath);
    const stoneNrs = stoneNrsFor(login);
    const gemNrs = gemNrsFor(login);
    return { gci, stoneNrs, gemNrs };
  }

  // Run GciTsLogin (blocking) and return the session handle, or throw with the
  // GCI error message when no session was created.
  private blockingLoginHandle(
    gci: GciLibrary,
    stoneNrs: string,
    gemNrs: string,
    login: GemStoneLogin,
  ): unknown {
    const result = gci.GciTsLogin(
      stoneNrs,
      login.host_user || null,
      login.host_password || null,
      false,
      gemNrs,
      login.gs_user,
      login.gs_password,
      0,
      0,
    );
    if (!result.session) {
      throw new Error(result.err.message || `Login failed (error ${result.err.number})`);
    }
    return result.session;
  }

  // Start GciTsNbLogin (returns a handle immediately, logs in on a background
  // thread) and poll GciTsNbLoginFinished — 0 pending, 1 done, -1 failed —
  // yielding to the event loop between checks. Only GciTsNbLoginFinished may be
  // called while a login is in progress, so the shared setup waits for "done".
  private async nonBlockingLoginHandle(
    gci: GciLibrary,
    stoneNrs: string,
    gemNrs: string,
    login: GemStoneLogin,
  ): Promise<unknown> {
    const { session } = gci.GciTsNbLogin(
      stoneNrs,
      login.host_user || null,
      login.host_password || null,
      false,
      gemNrs,
      login.gs_user,
      login.gs_password,
      0,
      0,
    );
    if (!session) {
      throw new Error('Login failed: could not start a non-blocking login');
    }

    for (;;) {
      const { result, err } = gci.GciTsNbLoginFinished(session);
      if (result === 1) {
        return session;
      }
      if (result === -1) {
        throw new Error(err.message || `Login failed (error ${err.number})`);
      }
      await this.sleep(LOGIN_POLL_INTERVAL_MS);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Shared post-login setup for both the blocking and non-blocking paths:
  // records the session, installs the Transcript sink, drops the fresh session's
  // spurious uncommitted state, and auto-selects a lone session.
  private finalizeSession(gci: GciLibrary, login: GemStoneLogin, handle: unknown): ActiveSession {
    const { version } = gci.GciTsVersion();

    const session: ActiveSession = {
      id: this.nextId++,
      gci,
      handle,
      login,
      stoneVersion: version,
      enhancedInspectorAvailable: false,
      rbSupportAvailable: false,
    };

    this.sessions.set(session.id, session);
    logInfo(
      `[Session ${session.id}] Logged in: ${login.gs_user}@${login.gem_host}/${login.stone} (${version})`,
    );

    // Jade-style server-side Transcript sink: compiled into the session at
    // login, kept alive via SessionTemps, never committed. Non-fatal on
    // failure — the session simply has no Transcript display.
    installTranscriptSink(session);

    // Per-method history helper, installed the same way (SessionTemps, no commit,
    // no plugin) so method history works on a bare stone. Non-fatal on failure —
    // capture is soft-guarded, so the session simply records no history.
    installMethodHistory(session);

    // Clear the spurious "uncommitted changes" a fresh login carries. Beginning
    // the login transaction rebuilds the session-method dictionary, which bumps a
    // change-counter on the *persistent* singleton
    // `SessionMethodTransactionBoundaryPolicy current` — so a session that only
    // browsed shows uncommitted work at logout, and two concurrent committers
    // false-conflict on that kernel object. The session methods themselves (and
    // the Transcript sink above) are transient and survive abort, and the
    // counter's cross-session cache invalidation is driven by the *committed*
    // value, so aborting only drops the noise. Safe here because a just-logged-in
    // session has no user-authored work to lose. (A kernel-side fix — not bumping
    // the counter during a session-local rebuild — remains the proper fix.)
    try {
      const { success, err } = session.gci.GciTsAbort(session.handle);
      if (!success) {
        logInfo(
          `[Session ${session.id}] Post-login abort failed (error ${err.number}); leaving spurious uncommitted state`,
        );
      }
    } catch (e: unknown) {
      logInfo(
        `[Session ${session.id}] Post-login abort threw: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    // Auto-select when this is the only session
    if (this.sessions.size === 1) {
      this.selectSession(session.id);
    }

    // Announced after any auto-select, so a listener that reads the selection
    // sees the settled state rather than the moment in between.
    this._onDidAddSession.fire(session.id);

    return session;
  }

  // A transient, unregistered login for destructive admin flows (e.g. logical
  // restore) that log in and out repeatedly across a stone stop/start cycle. It
  // does NOT create an interactive session — no Transcript sink, no Sessions-view
  // entry, no single-session-mode gating, no auto-select — so it never disturbs
  // the user's session state. Reuses an existing GciLibrary (typically the
  // initiating session's, which survives that session's logout). The caller MUST
  // log out via the returned `logout`.
  loginTransient(
    login: GemStoneLogin,
    gci: GciLibrary,
  ): { session: ActiveSession; logout: () => void } {
    const stoneNrs = stoneNrsFor(login);
    const gemNrs = gemNrsFor(login);

    const result = gci.GciTsLogin(
      stoneNrs,
      login.host_user || null,
      login.host_password || null,
      false,
      gemNrs,
      login.gs_user,
      login.gs_password,
      0,
      0,
    );

    if (!result.session) {
      throw new Error(result.err.message || `Login failed (error ${result.err.number})`);
    }

    const { version } = gci.GciTsVersion();
    const session: ActiveSession = {
      id: -1,
      gci,
      handle: result.session,
      login,
      stoneVersion: version,
      enhancedInspectorAvailable: false,
      rbSupportAvailable: false,
    };
    return {
      session,
      logout: () => {
        try {
          gci.GciTsLogout(result.session);
        } catch {
          /* already gone */
        }
      },
    };
  }

  logout(id: number): void {
    const s = this.sessions.get(id);
    if (!s) return;
    logInfo(`[Session ${id}] Logging out: ${s.login.gs_user}@${s.login.gem_host}/${s.login.stone}`);
    try {
      s.gci.GciTsLogout(s.handle);
    } catch {
      // Session may already be dead — remove it regardless
    }
    this.sessions.delete(id);
    // Signal removal unconditionally so listeners reap even when a *background*
    // (non-selected) session is logged out — onDidChangeSelection below only
    // fires for the selected session.
    this._onDidRemoveSession.fire(id);

    if (this._selectedId === id) {
      this._selectedId = null;
      if (this.sessions.size === 1) {
        const remaining = this.sessions.values().next().value!;
        this.selectSession(remaining.id);
      } else {
        this._onDidChangeSelection.fire(null);
        vscode.commands.executeCommand(
          'setContext',
          'gemstone.hasActiveSession',
          this.sessions.size > 0,
        );
      }
    }
  }

  commit(id: number): { success: boolean; err: GciError } {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Session not found');
    return s.gci.GciTsCommit(s.handle);
  }

  abort(id: number): { success: boolean; err: GciError } {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Session not found');
    return s.gci.GciTsAbort(s.handle);
  }

  /**
   * Confirm the session is alive and responsive by forcing a round-trip to the
   * gem without compiling or executing Smalltalk: fetch the instVar count of
   * nil (a low-level GCI call). Returns cleanly when the session responds.
   */
  ping(id: number): { success: boolean; err: GciError } {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Session not found');
    const { err } = s.gci.GciTsFetchSize(s.handle, OOP_NIL);
    return { success: err.number === 0, err };
  }

  getSessions(): ActiveSession[] {
    return Array.from(this.sessions.values());
  }

  dispose(): void {
    for (const s of this.sessions.values()) {
      try {
        s.gci.GciTsLogout(s.handle);
      } catch {
        /* ignore */
      }
    }
    this.sessions.clear();
    for (const gci of this.gciInstances.values()) {
      try {
        gci.close();
      } catch {
        /* ignore */
      }
    }
    this.gciInstances.clear();
    this._onDidChangeSelection.dispose();
    this._onDidRemoveSession.dispose();
  }
}
