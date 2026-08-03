/**
 * The add / remove instance-variable (V1) orchestration, driven from the GemStone
 * Explorer. Runs a server-side pre-flight (viable? how many methods will not recompile?),
 * previews the change set (a class-definition edit per edited class + a reparent per
 * affected descendant), and applies it server-side. The structural change never commits;
 * migrating instances / deleting history (chosen in the panel) DO commit, and the panel
 * confirms before either.
 *
 * The caller resolves the new name (for an add) before calling in — this module just
 * previews and applies a fully-specified operation, and reports the outcome so the caller
 * can refresh/reveal.
 */
import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
import * as queries from '../browserQueries';
import { InstVarOp } from './queries/previewInstVar';
import { PREVIEW_PAGE_BYTES } from './queries/previewRenameMethod';
import {
  parseAnalysis,
  parseStartPreview,
  parsePage,
  parseApplyResult,
} from './instVarRefactorPreview';
import { showInstVarRefactorPanel } from './instVarRefactorPanel';
import { ensureRbSupport, refuse } from './renameAtCursorShared';
import { logInfo } from '../gciLog';

export interface InstVarRefactorRequest {
  session: ActiveSession;
  op: InstVarOp;
  /** The class the variable is (or will be) declared in. */
  className: string;
  ivarName: string;
  /** Dict scope for the class lookup (1-based SymbolList index or name). */
  dict?: number | string;
}

export interface InstVarRefactorOutcome {
  applied: number;
  committed: boolean;
  /** Methods that could not recompile onto the new version and were dropped. */
  dropped: { className: string; selector: string }[];
}

function titleFor(req: InstVarRefactorRequest): string {
  if (req.op === 'add') return `Add ${req.ivarName} to ${req.className}`;
  return `Remove ${req.ivarName} from ${req.className}`;
}

/** Preview + apply a fully-specified instance-variable operation. Answers the outcome
 *  when applied, or undefined when cancelled/declined. Surfaces its own messages. */
export async function runInstVarRefactor(
  req: InstVarRefactorRequest,
): Promise<InstVarRefactorOutcome | undefined> {
  const { session, op, className, ivarName, dict } = req;
  logInfo(`[instVar] ${op} ${ivarName} on ${className}`);

  const verb = op === 'add' ? 'Adding' : 'Removing';
  if (!(await ensureRbSupport(session, `${verb} an instance variable`))) {
    logInfo('[instVar] refactoring engine unavailable; user declined install');
    return undefined;
  }

  // Pre-flight: refuse a hard decline before opening the preview.
  let analysis;
  try {
    analysis = parseAnalysis(await queries.analyzeInstVar(session, op, className, ivarName, dict));
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Pre-flight failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return undefined;
  }
  if (analysis.decline) {
    refuse(analysis.decline);
    return undefined;
  }

  const token = `iv_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const safeClear = (): void => {
    try {
      queries.clearInstVarPreview(session, token);
    } catch {
      /* best-effort cleanup */
    }
  };

  let start;
  try {
    start = parseStartPreview(
      await queries.startInstVarPreview(
        session,
        op,
        className,
        ivarName,
        token,
        PREVIEW_PAGE_BYTES,
        dict,
      ),
    );
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Preview failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    safeClear();
    return undefined;
  }

  if (start.outOfScope.decline) {
    refuse(start.outOfScope.decline);
    safeClear();
    return undefined;
  }
  if (start.total === 0) {
    refuse('Nothing to change.');
    safeClear();
    return undefined;
  }

  const result = await showInstVarRefactorPanel(titleFor(req), start, {
    loadPage: async (off) =>
      parsePage(await queries.pageInstVarPreview(session, token, off, PREVIEW_PAGE_BYTES)),
    apply: async (options, migrate, deleteHistory) =>
      parseApplyResult(
        await queries.applyInstVar(session, token, [], options, migrate, deleteHistory),
      ),
    cleanup: safeClear,
  });
  if (!result) return undefined;

  // A whole-apply error — in practice an expired preview token, which the user can reach by
  // sitting on the preview while deciding about the committing checkboxes. It answers
  // `applied:0` with an empty `failed`, so it parses cleanly and would otherwise fall through
  // to the success toast and a refresh/reveal of an unchanged tree. Nothing was applied, so
  // there is deliberately no abort advice here.
  if (result.error) {
    void vscode.window.showErrorMessage(`${titleFor(req)} failed: ${result.error}`);
    return undefined;
  }

  if (result.failed.length > 0) {
    const first = result.failed[0];
    // The engine stops at the first failure and deliberately does NOT abort: aborting rolls back
    // the whole session transaction, including whatever the user had in flight before starting.
    // So the client tells them what is left behind, why, and OFFERS the abort -- their choice.
    // When the engine reports `partiallyApplied`, trust it. An older engine omits it, so fall
    // back to the applied count -- 0 applied is direct evidence that nothing was staged.
    const staged = result.partiallyApplied ?? result.applied > 0;
    const reason = `Failed: ${first.label}: ${first.error}.`;

    if (!staged) {
      // The very first change failed, so nothing is staged and there is nothing to abort.
      void vscode.window.showErrorMessage(`${reason} Nothing was applied.`);
      return undefined;
    }

    const one = result.applied === 1;
    const left =
      `${result.applied} class${one ? '' : 'es'} ${one ? 'was' : 'were'} already versioned and` +
      ` ${one ? 'remains' : 'remain'} in your transaction.`;
    const choice = await vscode.window.showErrorMessage(
      `${reason} ${left} The change is all-or-nothing, so aborting the transaction discards` +
        ` ${one ? 'it' : 'them'}.`,
      'Abort Transaction',
    );
    if (choice !== 'Abort Transaction') return undefined;

    // Abort is destructive beyond this refactoring, so confirm with the cost spelled out --
    // the preview told us whether the session also held work of the user's own.
    const confirmed = await vscode.window.showWarningMessage(
      start.outOfScope.sessionHasUncommittedChanges
        ? 'Abort the transaction? This discards the partial refactoring AND every other' +
            ' uncommitted change in this session.'
        : 'Abort the transaction? This discards the partial refactoring.',
      { modal: true },
      'Abort Transaction',
    );
    if (confirmed !== 'Abort Transaction') return undefined;

    try {
      queries.abortSessionTransaction(session);
      void vscode.window.showInformationMessage(
        'Transaction aborted; nothing from this refactoring remains.',
      );
    } catch (e: unknown) {
      void vscode.window.showErrorMessage(
        `Abort failed: ${e instanceof Error ? e.message : String(e)}. Abort from the session menu.`,
      );
    }
    return undefined;
  }

  // Belt-and-braces: a zero-change apply with no error and no failure reported at all is still
  // not a success — the panel only opens with `total > 0` and every change is required.
  if (result.applied === 0) {
    void vscode.window.showErrorMessage(`${titleFor(req)} failed: nothing was applied.`);
    return undefined;
  }

  const droppedNote =
    result.dropped.length > 0
      ? ` ${result.dropped.length} method${result.dropped.length === 1 ? '' : 's'} did not recompile and ${result.dropped.length === 1 ? 'was' : 'were'} dropped.`
      : '';
  const commitNote = result.committed ? ' Committed.' : '';
  void vscode.window.showInformationMessage(`${titleFor(req)}.${droppedNote}${commitNote}`);

  return { applied: result.applied, committed: result.committed, dropped: result.dropped };
}
