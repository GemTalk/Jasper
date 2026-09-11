/**
 * The Move Method (M6) orchestration, driven from the GemStone Explorer: move one OR
 * MORE methods from a source class/side to a different class and/or the other side.
 * Runs a server-side pre-flight (which selectors can move, and why the rest can't),
 * previews the change set (a methodAdd on the target + a methodRemove on the source,
 * per movable selector), applies it server-side (no commit), then refreshes the
 * Explorer so both the source and target method lists update.
 *
 * The copy-vs-move choice and target-class selection happen at the call site (the
 * Explorer's drop QuickPick / right-click command) — this module just previews and
 * applies a fully-specified move. Nothing is ever committed; the user commits
 * explicitly, exactly like the rest of the refactoring family.
 */
import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
import * as queries from '../browserQueries';
import { PREVIEW_PAGE_BYTES } from './queries/previewRenameMethod';
import { parseAnalysis, parseStartPreview, parsePage, parseApplyResult } from './moveMethodPreview';
import { showMoveMethodPanel } from './moveMethodPanel';
import { ensureRbSupport, refuse } from './renameAtCursorShared';
import { logInfo } from '../gciLog';
import { notifyRefactoringApplied } from './refactoringAppliedToast';

export interface MoveMethodRequest {
  session: ActiveSession;
  /** The class the methods currently live in. */
  sourceClass: string;
  /** The selectors to move (one or many). */
  selectors: string[];
  /** The source side: true = class side (metaclass), false = instance side. */
  isMeta: boolean;
  /** The class to move them to (may equal sourceClass for a side flip). */
  targetName: string;
  /** The target side. */
  toMeta: boolean;
  /** Dict scope for the source-class lookup (1-based SymbolList index or name). */
  dict?: number | string;
}

/** The result of a completed, applied move — so the caller can reveal the methods in
 *  their new home. */
export interface MoveOutcome {
  applied: number;
  /** The selectors that actually moved (the movable subset). */
  moved: string[];
  targetClass: string;
  toMeta: boolean;
}

/** Preview + apply a fully-specified move. Answers the outcome when changes were
 *  applied, or undefined when cancelled, declined, or nothing was movable. Surfaces its
 *  own user-facing messages; the CALLER reveals the moved methods in the target. */
export async function moveMethod(req: MoveMethodRequest): Promise<MoveOutcome | undefined> {
  const { session, sourceClass, selectors, isMeta, targetName, toMeta, dict } = req;
  logInfo(`[moveMethod] ${sourceClass} ${selectors.length} selector(s) -> ${targetName}`);

  if (selectors.length === 0) return undefined;
  if (!(await ensureRbSupport(session, 'Moving a method'))) {
    logInfo('[moveMethod] refactoring engine unavailable; user declined install');
    return undefined;
  }

  // Pre-flight: refuse a global decline (or a nothing-movable move) before opening the
  // preview, and explain why.
  let analysis;
  try {
    analysis = parseAnalysis(
      await queries.analyzeMoveMethod(
        session,
        sourceClass,
        selectors,
        isMeta,
        targetName,
        toMeta,
        dict,
      ),
    );
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Move pre-flight failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return undefined;
  }
  if (analysis.globalDecline) {
    refuse(analysis.globalDecline);
    return undefined;
  }
  if (analysis.movableCount === 0) {
    // Lead with the engine's reason (it already starts "Cannot move #sel: …"), so the
    // actionable part is visible up front in the toast; list a count when several fail.
    const declined = analysis.selectors.filter((s) => s.decline);
    refuse(
      declined.length <= 1
        ? (declined[0]?.decline ?? 'None of the selected methods can move to that class.')
        : `${declined.length} methods cannot move. ${declined[0].decline}`,
    );
    return undefined;
  }

  const token = `mvm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const safeClear = (): void => {
    try {
      queries.clearMoveMethodPreview(session, token);
    } catch {
      /* best-effort cleanup */
    }
  };

  let start;
  try {
    start = parseStartPreview(
      await queries.startMoveMethodPreview(
        session,
        sourceClass,
        selectors,
        isMeta,
        targetName,
        toMeta,
        token,
        PREVIEW_PAGE_BYTES,
        dict,
      ),
    );
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Move preview failed: ${e instanceof Error ? e.message : String(e)}`,
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
    refuse('Nothing to move.');
    safeClear();
    return undefined;
  }

  const targetLabel = start.targetClass ?? analysis.targetClass ?? targetName;
  const result = await showMoveMethodPanel(targetLabel, start, {
    loadPage: async (off) =>
      parsePage(await queries.pageMoveMethodPreview(session, token, off, PREVIEW_PAGE_BYTES)),
    apply: async (deselected) =>
      parseApplyResult(
        await queries.applyMoveMethod(
          session,
          token,
          deselected,
          selectors.length === 1
            ? `Move #${selectors[0]} to ${targetLabel}`
            : `Move ${selectors.length} methods to ${targetLabel}`,
        ),
      ),
    cleanup: safeClear,
  });
  if (!result) return undefined;

  // A whole-apply error (an expired preview token) answers `applied:0` with an empty
  // `failed`, so it parses cleanly and would otherwise reach the success toast. Nothing
  // changed, so no abort advice.
  if (result.error) {
    void vscode.window.showErrorMessage(`Move failed: ${result.error}`);
    return undefined;
  }

  if (result.failed.length > 0) {
    const first = result.failed[0];
    void vscode.window.showErrorMessage(`Move failed: ${first.label}: ${first.error}`);
    return undefined;
  }

  const moved = analysis.selectors.filter((s) => !s.decline).map((s) => s.selector);
  const n = moved.length;
  notifyRefactoringApplied(
    session,
    n === 1 ? `Moved #${moved[0]} to ${targetLabel}.` : `Moved ${n} methods to ${targetLabel}.`,
    'toast',
  );
  // The methods were relocated server-side (no commit). The CALLER reveals them in the
  // target class (which reloads the Explorer), so a plain refresh here is unnecessary.
  return { applied: result.applied, moved, targetClass: targetLabel, toMeta };
}
