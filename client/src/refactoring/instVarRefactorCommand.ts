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
import { Accessor } from './queries/addAccessors';
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
import { notifyRefactoringApplied } from './refactoringAppliedToast';

export interface InstVarRefactorRequest {
  session: ActiveSession;
  op: InstVarOp;
  /** The class the variable is (or will be) declared in. */
  className: string;
  ivarName: string;
  /** Dict scope for the class lookup (1-based SymbolList index or name). */
  dict?: number | string;
  /** Getter/setter to compile when the user opted into accessors on an add. Compiled by
   *  the engine IN THE SAME transaction as the reshape, so they commit or abort with it
   *  (not a separate fire-and-forget step). Also shown as a preview note. */
  accessorSpecs?: Accessor[];
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
  const { session, op, className, ivarName, dict, accessorSpecs } = req;
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

  const accessorNote =
    accessorSpecs && accessorSpecs.length > 0
      ? `Accessors added with this change: ${accessorSpecs.map((a) => a.selector).join(', ')}`
      : undefined;
  const result = await showInstVarRefactorPanel(
    titleFor(req),
    start,
    {
      loadPage: async (off) =>
        parsePage(await queries.pageInstVarPreview(session, token, off, PREVIEW_PAGE_BYTES)),
      apply: async (options, migrate, deleteHistory) =>
        parseApplyResult(
          await queries.applyInstVar(
            session,
            token,
            [],
            options,
            migrate,
            deleteHistory,
            accessorSpecs ?? [],
          ),
        ),
      // The engine stops at the first failure and never aborts on its own (that would discard the
      // user's other in-flight work). The panel surfaces the failure in place and, when a partial
      // reshape is stranded, offers this abort directly — no toast, no second confirmation.
      abort: () => {
        queries.abortSessionTransaction(session);
      },
      // Live re-probe for the commit-confirmation warning — see the panel handler's doc.
      sessionNeedsCommit: () => queries.sessionNeedsCommit(session),
      cleanup: safeClear,
    },
    accessorNote,
  );
  // The panel resolves a result only on success; every apply failure is shown and handled inside
  // the panel (Abort or Close), which then resolves undefined. So a falsy result means the user
  // cancelled, closed, or hit a failure the panel already reported — nothing more to say here.
  if (!result) return undefined;

  const droppedNote =
    result.dropped.length > 0
      ? ` ${result.dropped.length} method${result.dropped.length === 1 ? '' : 's'} did not recompile and ${result.dropped.length === 1 ? 'was' : 'were'} dropped.`
      : '';
  const commitNote = result.committed ? ' Committed.' : '';

  // Record the reversal: an add is undone by a remove and vice versa, by this same engine
  // (#434). Deliberately NOT recorded when the apply MIGRATED instances or DELETED history --
  // those are the two irreversible options in the family, and a reversal that silently cannot
  // restore moved data or a destroyed history would be a false promise. `committed` is the
  // engine's signal that one of them ran.
  if (!result.committed) {
    try {
      queries.recordReverseRename(
        session,
        op === 'add' ? 'instVarAdd' : 'instVarRemove',
        className,
        ivarName,
        ivarName,
        titleFor(req),
        'GsInstVarRefactoring',
      );
    } catch (e: unknown) {
      logInfo(
        `[undoRefactoring] could not record the reverse instVar op: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
  notifyRefactoringApplied(session, `${titleFor(req)}.${droppedNote}${commitNote}`, 'toast');

  return { applied: result.applied, committed: result.committed, dropped: result.dropped };
}
