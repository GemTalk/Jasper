/**
 * The add / remove / move instance-variable (V1 + V4) orchestration, driven from the
 * GemStone Explorer. Runs a server-side pre-flight (viable? how many methods will not
 * recompile?), previews the change set (a class-definition edit per edited class + a
 * reparent per affected descendant), and applies it server-side. The structural change
 * never commits; migrating instances / deleting history (chosen in the panel) DO commit,
 * and the panel confirms before either.
 *
 * The caller resolves the target class (for a move) and the new name (for an add) before
 * calling in — this module just previews and applies a fully-specified operation, and
 * reports the outcome so the caller can refresh/reveal.
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
  /** The class the variable is (or will be) declared in — the source for a move. */
  className: string;
  ivarName: string;
  /** Dict scope for the source-class lookup (1-based SymbolList index or name). */
  dict?: number | string;
  /** The move target class name (op === 'move' only). */
  targetName?: string;
}

export interface InstVarRefactorOutcome {
  applied: number;
  committed: boolean;
  /** Methods that could not recompile onto the new version and were dropped. */
  dropped: { className: string; selector: string }[];
}

function titleFor(req: InstVarRefactorRequest): string {
  if (req.op === 'add') return `Add ${req.ivarName} to ${req.className}`;
  if (req.op === 'remove') return `Remove ${req.ivarName} from ${req.className}`;
  return `Move ${req.ivarName} from ${req.className} to ${req.targetName ?? '?'}`;
}

/** Preview + apply a fully-specified instance-variable operation. Answers the outcome
 *  when applied, or undefined when cancelled/declined. Surfaces its own messages. */
export async function runInstVarRefactor(
  req: InstVarRefactorRequest,
): Promise<InstVarRefactorOutcome | undefined> {
  const { session, op, className, ivarName, dict, targetName } = req;
  logInfo(`[instVar] ${op} ${ivarName} on ${className}${targetName ? ` -> ${targetName}` : ''}`);

  const verb = op === 'add' ? 'Adding' : op === 'remove' ? 'Removing' : 'Moving';
  if (!(await ensureRbSupport(session, `${verb} an instance variable`))) {
    logInfo('[instVar] refactoring engine unavailable; user declined install');
    return undefined;
  }

  // Pre-flight: refuse a hard decline before opening the preview.
  let analysis;
  try {
    analysis = parseAnalysis(
      await queries.analyzeInstVar(session, op, className, ivarName, dict, targetName),
    );
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
        targetName,
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

  if (result.failed.length > 0) {
    const first = result.failed[0];
    void vscode.window.showErrorMessage(`Failed: ${first.label}: ${first.error}`);
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
