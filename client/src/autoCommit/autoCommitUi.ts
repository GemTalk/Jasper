/**
 * Turning auto-commit on and off, and what to do when it fails (issue #254).
 *
 * The switch is deliberately not only a setting. #254 asks for exactly that: "it would be
 * nice if that on/off switch was not buried in a settings tool as the only means of
 * changing it". So the status-bar indicator IS the switch — one click — and the palette
 * entry and the session row's context menu reach the same command. The setting
 * (`gemstone.autoCommit.enableForNewSessions`) only decides where a NEW session starts.
 *
 * Two moments here are worth more than a toggle:
 *
 *  - **Turning it on over a dirty transaction.** The next write would commit not just
 *    itself but everything already staged in the session, which the user staged while
 *    intending to decide about it later. So the prompt says how much is at stake and lets
 *    them commit it deliberately, arm anyway, or back out.
 *  - **A failed commit.** Almost always a conflict with another session. Auto-commit stops
 *    trying — retrying on every keystroke would fail every time and bury the message — and
 *    the user gets the three things they can actually do: abort, look at the conflicts, or
 *    turn it off. This follows Jadeite's auto-commit failure dialog, which offers the same
 *    abort-or-see-the-conflicts choice.
 */
import * as vscode from 'vscode';
import { ActiveSession, SessionManager } from '../sessionManager';
import * as queries from '../browserQueries';
import { getGciLog, logInfo } from '../gciLog';
import { getAutoCommitStatus, setAutoCommitStatus } from './autoCommitState';

export const TOGGLE_AUTO_COMMIT_COMMAND = 'gemstone.autoCommit.toggle';

/** The window-wide seed for new sessions. */
export const AUTO_COMMIT_DEFAULT_SETTING = 'autoCommit.enableForNewSessions';

/** What a new session should start at. */
export function autoCommitDefaultForNewSessions(): boolean {
  return vscode.workspace
    .getConfiguration('gemstone')
    .get<boolean>(AUTO_COMMIT_DEFAULT_SETTING, false);
}

const ARM_ANYWAY = 'Turn On Anyway';
const COMMIT_FIRST = 'Commit Now, Then Turn On';
const MAKE_DEFAULT = 'Make This the Default';

/**
 * Turn auto-commit on for a session, asking first when the transaction already holds
 * uncommitted work. Answers whether it ended up armed.
 */
async function armAutoCommit(session: ActiveSession): Promise<boolean> {
  // `undefined` means the probe itself failed, and it asks the same question: the point of
  // the prompt is that the user cannot see what is staged, and a failed probe leaves them
  // no better off than a positive one. Silence here would be the one wrong answer.
  const needsCommit = queries.sessionNeedsCommit(session);
  if (needsCommit !== false) {
    const preamble =
      needsCommit === true
        ? `Session ${session.id} already has uncommitted changes.`
        : `Session ${session.id} may have uncommitted changes (the commit state could not be checked).`;
    const choice = await vscode.window.showWarningMessage(
      `${preamble} With auto-commit on, the next change you make commits those too — the ` +
        'whole transaction goes in together.',
      { modal: true },
      COMMIT_FIRST,
      ARM_ANYWAY,
    );
    if (choice !== COMMIT_FIRST && choice !== ARM_ANYWAY) return false;
    if (choice === COMMIT_FIRST) {
      const { success, err } = session.gci.GciTsCommit(session.handle);
      if (!success) {
        void vscode.window.showErrorMessage(
          `Session ${session.id}: that commit failed — ${err.message || `error ${err.number}`}. ` +
            'Auto-commit was left off.',
        );
        return false;
      }
    }
  }

  setAutoCommitStatus(session.id, 'on');
  logInfo(`[autoCommit] session ${session.id}: armed`);
  void (async () => {
    const choice = await vscode.window.showInformationMessage(
      `Auto-commit is ON for session ${session.id}. Every change is committed as it is made, ` +
        'and Abort will no longer take one back.',
      MAKE_DEFAULT,
    );
    if (choice !== MAKE_DEFAULT) return;
    await vscode.workspace
      .getConfiguration('gemstone')
      .update(AUTO_COMMIT_DEFAULT_SETTING, true, vscode.ConfigurationTarget.Global);
  })();
  return true;
}

/** Turn auto-commit off. Whatever is uncommitted stays uncommitted, as it would have. */
function disarmAutoCommit(session: ActiveSession): void {
  setAutoCommitStatus(session.id, 'off');
  logInfo(`[autoCommit] session ${session.id}: turned off`);
  void vscode.window.showInformationMessage(
    `Auto-commit is OFF for session ${session.id}. Changes now stay in the transaction until ` +
      'you commit.',
  );
}

/**
 * The one command behind the status-bar click, the palette entry and the session row.
 * From the `failed` state it opens the recovery choices instead of flipping, because
 * "off" is only one of three things the user might want there and the other two are the
 * ones that save their work.
 */
export async function toggleAutoCommit(
  sessionManager: SessionManager,
  session?: ActiveSession,
): Promise<void> {
  const target = session ?? sessionManager.getSelectedSession();
  if (!target) {
    void vscode.window.showWarningMessage('Select a GemStone session first.');
    return;
  }
  const status = getAutoCommitStatus(target.id);
  if (status === 'failed') {
    await offerAutoCommitRecovery(target, undefined, abortHandler);
    return;
  }
  if (status === 'on') disarmAutoCommit(target);
  else await armAutoCommit(target);
}

// ── Failure and recovery ───────────────────────────────────────────────────

const ABORT_NOW = 'Abort and Discard';
const SHOW_CONFLICTS = 'Show Conflicts';
const TURN_OFF = 'Turn Auto-Commit Off';

/**
 * How the recovery prompt aborts. Registered by the extension so this module reaches the
 * SAME abort the Abort button runs — the one that refreshes the exported files, the
 * Explorer and GemStone Search, and clears the undo stack, which an abort must do because
 * every recorded entry now describes a state the stone was rewound past.
 */
export type AutoCommitAbort = (session: ActiveSession) => Promise<void>;

let abortHandler: AutoCommitAbort | undefined;

export function setAutoCommitAbortHandler(handler: AutoCommitAbort | undefined): void {
  abortHandler = handler;
}

/** Print what the failed commit conflicted on into the GemStone channel, and show it. */
function showConflicts(session: ActiveSession): void {
  const channel = getGciLog();
  let report: string;
  try {
    report = queries.transactionConflicts(session);
  } catch (e: unknown) {
    report = `Could not read the conflict report: ${e instanceof Error ? e.message : String(e)}`;
  }
  channel.appendLine(`[Session ${session.id}] Auto-commit conflict report:`);
  channel.appendLine(report);
  channel.show(true);
}

/**
 * Offer the ways out of a failed auto-commit. Also reached by clicking the red indicator,
 * so a user who dismissed the toast can still get here.
 */
export async function offerAutoCommitRecovery(
  session: ActiveSession,
  reason: string | undefined,
  abort: AutoCommitAbort | undefined,
): Promise<void> {
  const detail = reason ? ` — ${reason}` : '';
  const choice = await vscode.window.showWarningMessage(
    `Session ${session.id}: auto-commit could not commit${detail}. Your changes are NOT in the ` +
      'repository and auto-commit has stopped trying. This is almost always a conflict with ' +
      'another session.',
    ABORT_NOW,
    SHOW_CONFLICTS,
    TURN_OFF,
  );
  if (choice === ABORT_NOW) {
    if (!abort) {
      void vscode.window.showErrorMessage('Abort is unavailable; use the Abort button.');
      return;
    }
    // Whether that puts auto-commit back to armed is decided by the abort itself, through
    // `autoCommitTransactionSettled` — it only settles the transaction if it actually ran.
    // Setting it here would arm a session over an abort the user backed out of at its own
    // "unsaved exported .gs files" question, or one the stone refused.
    await abort(session);
    return;
  }
  if (choice === SHOW_CONFLICTS) {
    showConflicts(session);
    return;
  }
  if (choice === TURN_OFF) disarmAutoCommit(session);
}

/** The handler installed on the runner: report the failure and offer the way out. */
export function reportAutoCommitFailure(session: ActiveSession, reason: string): void {
  void offerAutoCommitRecovery(session, reason, abortHandler);
}

/**
 * A manual commit or abort that succeeded has settled the transaction the auto-commit
 * failure was stuck on, so auto-commit resumes. Called from the Commit and Abort commands.
 */
export function autoCommitTransactionSettled(sessionId: number): void {
  if (getAutoCommitStatus(sessionId) !== 'failed') return;
  setAutoCommitStatus(sessionId, 'on');
  logInfo(`[autoCommit] session ${sessionId}: transaction settled, auto-commit resumed`);
}
