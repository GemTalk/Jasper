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
 *
 * A remove the safe-delete guard has already cleared (nothing accesses the variable) can
 * skip the panel entirely — see `autoApply` — because a preview of a change that breaks
 * nothing is a question with only one answer.
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
  BrokenMethod,
} from './instVarRefactorPreview';
import { showInstVarRefactorPanel } from './instVarRefactorPanel';
import { ensureRbSupport, refuse } from './renameAtCursorShared';
import { logInfo, logWarning } from '../gciLog';

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
  /** Apply without opening the preview panel. The safe-delete path sets this once it has
   *  established that no method accesses the variable: there is nothing for a preview to
   *  show, and a panel would be a confirmation the guard just decided was unnecessary.
   *  The engine still has the last word — if it reports methods that will not recompile,
   *  the panel opens after all. On this path the caller reports the outcome (the Explorer
   *  announces the deletion), so no completion message is shown from here. */
  autoApply?: boolean;
}

export interface InstVarRefactorOutcome {
  applied: number;
  committed: boolean;
  /** Methods that could not recompile onto the new version and were dropped. */
  dropped: { className: string; selector: string }[];
  /** True when `autoApply` was honoured and the preview panel never opened, so the caller
   *  knows whether the change went through unattended. An autoApply request that the engine
   *  sent to the panel after all comes back false — the user WAS asked, and a caller that
   *  announces an unasked deletion must not announce that one. */
  autoApplied: boolean;
}

function titleFor(req: InstVarRefactorRequest): string {
  if (req.op === 'add') return `Add ${req.ivarName} to ${req.className}`;
  return `Remove ${req.ivarName} from ${req.className}`;
}

/**
 * List every method the reshape could not recompile onto the new class version, with the
 * compiler's reason for each, in the durable "GemStone GCI" channel.
 *
 * A notification can only carry the count -- it truncates and then vanishes -- and the dropped
 * list is what the user works through to restore them, so the detail goes where it survives.
 * This is what the rename family already does with its recompile failures.
 *
 * Both apply paths report. The auto-apply path runs only when nothing was PREDICTED to fail,
 * but a prediction is not a compile: the whole reason these results are checked at all is that
 * a method can fail to recompile with nothing forecasting it. That case is the one most worth
 * a durable record, since the auto-apply path shows no panel to surface it.
 */
function reportDropped(title: string, dropped: BrokenMethod[]): void {
  if (dropped.length === 0) return;
  logWarning(
    `${title}: ${dropped.length} method(s) did not recompile onto the new class version ` +
      'and were dropped:\n' +
      dropped
        .map((m) => `    \u2022 ${m.className}>>${m.selector}${m.reason ? `: ${m.reason}` : ''}`)
        .join('\n'),
  );
}

/** Preview + apply a fully-specified instance-variable operation. Answers the outcome
 *  when applied, or undefined when cancelled/declined. Surfaces its own messages. */
export async function runInstVarRefactor(
  req: InstVarRefactorRequest,
): Promise<InstVarRefactorOutcome | undefined> {
  const { session, op, className, ivarName, dict, accessorSpecs, autoApply } = req;
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

  // Nothing will break and the caller already decided not to ask: apply the staged change
  // set as it stands (no deselections, and neither committing option), then release the
  // token the panel would otherwise have cleaned up.
  if (autoApply && start.outOfScope.willNotRecompile.length === 0) {
    let result;
    try {
      result = parseApplyResult(
        await queries.applyInstVar(session, token, [], [], false, false, accessorSpecs ?? []),
      );
    } catch (e: unknown) {
      void vscode.window.showErrorMessage(
        `${titleFor(req)} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      safeClear();
      return undefined;
    }
    safeClear();
    const failure = result.error ?? result.failed[0]?.error;
    if (failure !== undefined) {
      void vscode.window.showErrorMessage(`${titleFor(req)} failed: ${failure}`);
      return undefined;
    }
    reportDropped(titleFor(req), result.dropped);
    return {
      applied: result.applied,
      committed: result.committed,
      dropped: result.dropped,
      autoApplied: true,
    };
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

  reportDropped(titleFor(req), result.dropped);
  const droppedNote =
    result.dropped.length > 0
      ? ` ${result.dropped.length} method${result.dropped.length === 1 ? '' : 's'} did not recompile and ${result.dropped.length === 1 ? 'was' : 'were'} dropped. See the GemStone GCI channel for the list.`
      : '';
  const commitNote = result.committed ? ' Committed.' : '';
  void vscode.window.showInformationMessage(`${titleFor(req)}.${droppedNote}${commitNote}`);

  return {
    applied: result.applied,
    committed: result.committed,
    dropped: result.dropped,
    autoApplied: false,
  };
}
