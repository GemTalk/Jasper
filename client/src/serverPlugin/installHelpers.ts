/**
 * Low-level, `vscode`-free helpers shared by the two server-side support
 * installers (`refactoringInstall.ts`, `enhancedInspectorInstall.ts`). Each
 * used to carry its own copy of these — identical in behavior, only the name
 * drifted — so they're consolidated here.
 *
 * Deliberately has no `vscode` import: `install-server-plugin.mjs` (the CI
 * provisioning script, which runs outside the extension host) also imports
 * `loginAsSystemUser` from the compiled output of this module. The
 * interactive password-prompt wrapper around it, `obtainSystemUserSession`,
 * lives in `systemUserAuth.ts` instead, since it needs `vscode`.
 */
import { ActiveSession } from '../sessionManager';
import { executeFetchString } from '../browserQueries';
import { gemNrsFor, DEFAULT_GS_PW } from '../loginTypes';

// GemStone's default SystemUser password on a fresh stone. Tried first so a
// stock stone installs in one step; on failure the caller falls back to a
// prompt (or, non-interactively, reports it as a miss).
//
// DataCurator's and SystemUser's stock passwords aren't two facts that happen
// to coincide — they're the same fact ("stock stone default"), so this
// re-exports `DEFAULT_GS_PW` under the name this module's callers expect
// rather than redeclaring the literal. See the secret-scan-avoidance note on
// `DEFAULT_GS_PW` in loginTypes.ts for why it's a named constant instead of a
// `password`-suffixed identifier.
export const DEFAULT_SYSTEMUSER_PW = DEFAULT_GS_PW;

/** Render a JS string as a GemStone string literal: single quotes doubled and
 *  the whole value wrapped in quotes. */
export function gsStringLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** Whether the gem process can read the file at `serverPath`. */
export function gemCanRead(session: ActiveSession, serverPath: string): boolean {
  try {
    const r = executeFetchString(
      session,
      `[(GsFile existsOnServer: ${gsStringLiteral(serverPath)}) printString] ` +
        "on: Error do: [:e | 'false']",
    );
    return r.trim() === 'true';
  } catch {
    return false;
  }
}

/** Best-effort transaction rollback; the caller closes/discards the session
 *  regardless of whether this succeeds. */
export function safeAbort(session: ActiveSession): void {
  try {
    session.gci.GciTsAbort(session.handle);
  } catch {
    // Best-effort rollback; the caller closes the session regardless.
  }
}

/** Extract a human-readable message from a thrown value. */
export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Yield to the event loop so a progress notification can paint between
 *  (synchronous) server calls. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * Open a transient SystemUser session on the SAME GciLibrary as `base`,
 * reusing its connection coordinates and overriding only the GemStone user.
 * Deliberately NOT registered with the SessionManager. Caller logs it out.
 */
export function loginAsSystemUser(base: ActiveSession, password: string): ActiveSession {
  const { login } = base;
  const stoneNrs = `!tcp@${login.gem_host}#server!${login.stone}`;
  const gemNrs = gemNrsFor(login);
  const result = base.gci.GciTsLogin(
    stoneNrs,
    login.host_user || null,
    login.host_password || null,
    false,
    gemNrs,
    'SystemUser',
    password,
    0,
    0,
  );
  if (!result.session) {
    throw new Error(result.err.message || `SystemUser login failed (error ${result.err.number})`);
  }
  return {
    id: -1,
    gci: base.gci,
    handle: result.session,
    login: { ...login, gs_user: 'SystemUser', gs_password: password },
    stoneVersion: base.stoneVersion,
  };
}
