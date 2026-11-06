/**
 * Turning auto-commit on and off, and what to do when a commit fails (issue #254): the
 * prompts over a dirty transaction and after a refused commit. See
 * docs/explanation/auto-commit.md.
 */
import * as vscode from 'vscode';
import { ActiveSession, SessionManager } from '../sessionManager';
import * as queries from '../browserQueries';
import { getGciLog, logInfo } from '../gciLog';
import { conflictReport, hasConflictDetail } from '../queries/transactionConflicts';
import {
  AUTO_COMMIT_NEEDS_AUTO_BEGIN,
  autoCommitBlockedByMode,
  forgetSessionAutoCommit,
  getAutoCommitStatus,
  registerSessionAutoCommit,
  setAutoCommitStatus,
} from './autoCommitState';
import { AutoCommitFailureKind } from './autoCommitRunner';
import { modeLabel } from '../queries/transactionMode';

export const TOGGLE_AUTO_COMMIT_COMMAND = 'gemstone.autoCommit.toggle';

/** The window-wide seed for new sessions. */
export const AUTO_COMMIT_DEFAULT_SETTING = 'autoCommit.enableForNewSessions';

/** What a new session should start at. */
export function autoCommitDefaultForNewSessions(): boolean {
  return vscode.workspace
    .getConfiguration('gemstone')
    .get<boolean>(AUTO_COMMIT_DEFAULT_SETTING, false);
}

const SWITCH_TO_AUTO_BEGIN = 'Switch to Auto-Begin and Turn On…';

/**
 * Say why auto-commit cannot run in this session's mode, and offer to switch the mode and
 * then turn auto-commit on — what the user was asking for in the first place.
 */
async function explainNeedsAutoBegin(session: ActiveSession, lead: string): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    `${lead} ${AUTO_COMMIT_NEEDS_AUTO_BEGIN}`,
    SWITCH_TO_AUTO_BEGIN,
  );
  if (choice !== SWITCH_TO_AUTO_BEGIN) return;
  // The ordinary mode switch, which asks before the abort it costs.
  await vscode.commands.executeCommand(
    'gemstone.setTransactionMode',
    { activeSession: session },
    'autoBegin',
  );
  // Declined, or refused by the stone: the mode says which, and only Auto-Begin may arm.
  if (session.transactionMode !== 'autoBegin') return;
  if (getAutoCommitStatus(session.id) === 'off') await armAutoCommit(session);
}

/**
 * Seed each new session from the default, drop a logged-out one, and turn auto-commit off when a
 * session leaves Auto-Begin. Seeded on `onDidAddSession`, which fires AFTER the post-login abort:
 * arming before it would commit the login's own spurious uncommitted state as the first act.
 */
export function registerAutoCommitSessionHooks(
  sessionManager: Pick<
    SessionManager,
    'onDidAddSession' | 'onDidRemoveSession' | 'onDidChangeTransactionState' | 'getSession'
  >,
): vscode.Disposable[] {
  return [
    sessionManager.onDidAddSession((id: number) => {
      const mode = sessionManager.getSession(id)?.transactionMode;
      const wanted = autoCommitDefaultForNewSessions();
      registerSessionAutoCommit(id, wanted && !autoCommitBlockedByMode(mode));
      if (wanted && autoCommitBlockedByMode(mode)) {
        logInfo(`[autoCommit] session ${id}: left off — logged in to ${modeLabel(mode)} mode`);
      }
    }),
    sessionManager.onDidRemoveSession((id: number) => forgetSessionAutoCommit(id)),
    sessionManager.onDidChangeTransactionState((id: number) => {
      const session = sessionManager.getSession(id);
      if (session) autoCommitTransactionModeChanged(session);
    }),
  ];
}

/**
 * The session's mode moved out of Auto-Begin (a mode switch, or code that set it), so an
 * armed auto-commit is turned off rather than left to fail on its next commit.
 */
export function autoCommitTransactionModeChanged(session: ActiveSession): void {
  if (getAutoCommitStatus(session.id) === 'off') return;
  if (!autoCommitBlockedByMode(session.transactionMode)) return;
  setAutoCommitStatus(session.id, 'off');
  logInfo(
    `[autoCommit] session ${session.id}: turned off — ${modeLabel(session.transactionMode)} mode`,
  );
  void vscode.window.showInformationMessage(
    `Auto-commit is OFF for session ${session.id}, now in ${modeLabel(session.transactionMode)} ` +
      `mode. ${AUTO_COMMIT_NEEDS_AUTO_BEGIN}`,
  );
}

const ARM_ANYWAY = 'Turn On Anyway';
const COMMIT_FIRST = 'Commit Now, Then Turn On';
const MAKE_DEFAULT = 'Make This the Default';

/**
 * Turn auto-commit on for a session, asking first when the transaction already holds
 * uncommitted work. Answers whether it ended up armed.
 */
async function armAutoCommit(session: ActiveSession): Promise<boolean> {
  if (autoCommitBlockedByMode(session.transactionMode)) {
    await explainNeedsAutoBegin(
      session,
      `Session ${session.id} is in ${modeLabel(session.transactionMode)} mode.`,
    );
    return false;
  }
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
    if (choice === COMMIT_FIRST && !(await commitFirst(session))) {
      void vscode.window.showErrorMessage(
        `Session ${session.id}: that commit did not land, so auto-commit was left off.`,
      );
      return false;
    }
  }

  setAutoCommitStatus(session.id, 'on');
  logInfo(`[autoCommit] session ${session.id}: armed`);
  void announceAutoCommit(
    `Auto-commit is ON for session ${session.id}. Every change is committed as it is made, ` +
      'and Abort will no longer take one back.',
    true,
  );
  return true;
}

/** Turn auto-commit off. Whatever is uncommitted stays uncommitted, as it would have. */
function disarmAutoCommit(session: ActiveSession): void {
  const wasFailed = getAutoCommitStatus(session.id) === 'failed';
  setAutoCommitStatus(session.id, 'off');
  logInfo(`[autoCommit] session ${session.id}: turned off`);
  // Turning it off does not clear the conflict: GemStone refuses to commit that transaction
  // until it is aborted, so a user who expects to commit by hand next needs telling.
  const after = wasFailed
    ? 'The transaction still conflicts with another session, so a commit will be refused ' +
      'until you abort, which discards those changes.'
    : 'Changes now stay in the transaction until you commit.';
  void announceAutoCommit(`Auto-commit is OFF for session ${session.id}. ${after}`, false);
}

/**
 * The notice after turning auto-commit on or off. It offers to make that the default for
 * new sessions only when the default says otherwise, since otherwise the button does nothing.
 */
async function announceAutoCommit(message: string, on: boolean): Promise<void> {
  if (autoCommitDefaultForNewSessions() === on) {
    await vscode.window.showInformationMessage(message);
    return;
  }
  const choice = await vscode.window.showInformationMessage(message, MAKE_DEFAULT);
  if (choice !== MAKE_DEFAULT) return;
  await vscode.workspace
    .getConfiguration('gemstone')
    .update(AUTO_COMMIT_DEFAULT_SETTING, on, vscode.ConfigurationTarget.Global);
}

function targetSession(
  sessionManager: SessionManager,
  session: ActiveSession | undefined,
): ActiveSession | undefined {
  const target = session ?? sessionManager.getSelectedSession();
  if (!target) void vscode.window.showWarningMessage('Select a GemStone session first.');
  return target;
}

/**
 * The command behind the session row's context menu, its on/off button and the palette entry.
 * From `failed` it turns auto-commit off, as its name says; the ways to resolve the failure are
 * the separate {@link recoverAutoCommit}, so a "toggle" never answers with a prompt whose own
 * choices include the toggle the user just asked for.
 */
export async function toggleAutoCommit(
  sessionManager: SessionManager,
  session?: ActiveSession,
): Promise<void> {
  const target = targetSession(sessionManager, session);
  if (!target) return;
  // Re-read so a mode changed by code since the last read cannot slip past the mode check.
  if (getAutoCommitStatus(target.id) === 'off') {
    sessionManager.refreshTransactionState(target.id);
    await armAutoCommit(target);
  } else disarmAutoCommit(target);
}

/** The failed row's error button: the ways to resolve the failure. */
export async function recoverAutoCommit(
  sessionManager: SessionManager,
  session?: ActiveSession,
): Promise<void> {
  const target = targetSession(sessionManager, session);
  if (!target) return;
  if (getAutoCommitStatus(target.id) !== 'failed') {
    void vscode.window.showInformationMessage(
      `Auto-commit has not failed for session ${target.id}; there is nothing to resolve.`,
    );
    return;
  }
  await offerAutoCommitRecovery(target, undefined, abortHandler);
}

/**
 * How "Commit Now, Then Turn On" commits. Registered by the extension so it is the SAME commit
 * the Commit button runs — the one that reports conflicts and refreshes the exported files,
 * the ClassOrganizer and GemStone Search. Answers whether the commit landed; it reports a
 * failure itself.
 */
export type AutoCommitCommit = (session: ActiveSession) => Promise<boolean>;

let commitHandler: AutoCommitCommit | undefined;

export function setAutoCommitCommitHandler(handler: AutoCommitCommit | undefined): void {
  commitHandler = handler;
}

async function commitFirst(session: ActiveSession): Promise<boolean> {
  if (commitHandler) return await commitHandler(session);
  try {
    return session.GciTsCommit().success;
  } catch {
    // A busy or dead session throws rather than answering.
    return false;
  }
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

/**
 * Print what the failed commit conflicted on into the GemStone channel, and show it — the
 * same report a refused manual commit writes there, so the two read alike.
 */
function showConflicts(session: ActiveSession): void {
  const channel = getGciLog();
  const conflicts = queries.transactionConflicts(session);
  let report: string;
  if (!conflicts) {
    report = 'Could not read the conflict report.';
  } else if (!hasConflictDetail(conflicts)) {
    report =
      'The stone reports no conflicting objects. The commit may have failed for another ' +
      'reason — see the error above.';
  } else {
    report = conflictReport(conflicts);
  }
  channel.appendLine(`[Session ${session.id}] Auto-commit conflict report:`);
  channel.appendLine(report);
  channel.show(true);
}

/**
 * Offer the ways to resolve a failed auto-commit. Also reached by clicking the row's error button,
 * so a user who dismissed the toast can still get here.
 */
export async function offerAutoCommitRecovery(
  session: ActiveSession,
  reason: string | undefined,
  abort: AutoCommitAbort | undefined,
  kind: AutoCommitFailureKind = 'refused',
): Promise<void> {
  const detail = reason ? ` — ${reason}` : '';
  const cause =
    kind === 'threw'
      ? 'The commit got no answer, so the session may be busy or no longer connected.'
      : 'This is almost always a conflict with another session.';
  const choices = kind === 'threw' ? [ABORT_NOW, TURN_OFF] : [ABORT_NOW, SHOW_CONFLICTS, TURN_OFF];
  const choice = await vscode.window.showWarningMessage(
    `Session ${session.id}: auto-commit could not commit${detail}. Your changes are NOT in the ` +
      `repository and auto-commit has stopped trying. ${cause}`,
    ...choices,
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
export function reportAutoCommitFailure(
  session: ActiveSession,
  reason: string,
  kind: AutoCommitFailureKind,
): void {
  if (kind === 'notInTransaction') {
    // Not a conflict, so the conflict prompt would mislead; the runner has turned it off.
    void explainNeedsAutoBegin(
      session,
      `Session ${session.id}: auto-commit could not commit because the session is not in a ` +
        'transaction, and has been turned off. Your changes are NOT in the repository.',
    );
    return;
  }
  void offerAutoCommitRecovery(session, reason, abortHandler, kind);
}
