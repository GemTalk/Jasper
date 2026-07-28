/**
 * The Push Up / Push Down Method (M7 / M8) orchestration, driven from the GemStone
 * Explorer: push one OR MORE methods from a source class to its immediate SUPERCLASS
 * (up) or into its immediate SUBCLASSES (down), same side. Runs a server-side pre-flight
 * (which selectors can move, and why the rest can't), previews the change set (a
 * methodAdd on each target + a methodRemove on the source), applies it server-side (no
 * commit), then lets the caller refresh/reveal the Explorer.
 *
 * The direction and target(s) are resolved by the engine — this module just previews
 * and applies a fully-specified push. Nothing is ever committed; the user commits
 * explicitly, exactly like the rest of the refactoring family.
 */
import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
import * as queries from '../browserQueries';
import { PREVIEW_PAGE_BYTES } from './queries/previewRenameMethod';
import { PushDirection } from './queries/previewPushMethod';
import { parseAnalysis, parseStartPreview, parsePage, parseApplyResult } from './pushMethodPreview';
import { showPushMethodPanel } from './pushMethodPanel';
import { ensureRbSupport, refuse } from './renameAtCursorShared';
import { logInfo } from '../gciLog';

export interface PushMethodRequest {
  session: ActiveSession;
  /** Push up (to the superclass) or down (into the subclasses). */
  direction: PushDirection;
  /** The class the methods currently live in. */
  sourceClass: string;
  /** The selectors to push (one or many). */
  selectors: string[];
  /** The source side: true = class side (metaclass), false = instance side. */
  isMeta: boolean;
  /** Dict scope for the source-class lookup (1-based SymbolList index or name). */
  dict?: number | string;
}

/** The result of a completed, applied push — so the caller can reveal the methods in
 *  their new home. */
export interface PushOutcome {
  applied: number;
  /** The selectors that actually moved (the movable subset). */
  moved: string[];
  /** The superclass a push-up landed in; null for push-down (many subclasses). */
  targetClass: string | null;
  isMeta: boolean;
}

const VERB: Record<PushDirection, string> = { up: 'Push up', down: 'Push down' };

/** Preview + apply a fully-specified push. Answers the outcome when changes were
 *  applied, or undefined when cancelled, declined, or nothing was movable. Surfaces its
 *  own user-facing messages; the CALLER reveals/refreshes the affected classes. */
export async function pushMethod(req: PushMethodRequest): Promise<PushOutcome | undefined> {
  const { session, direction, sourceClass, selectors, isMeta, dict } = req;
  logInfo(`[pushMethod:${direction}] ${sourceClass} ${selectors.length} selector(s)`);

  if (selectors.length === 0) return undefined;
  if (!(await ensureRbSupport(session, `${VERB[direction]} of a method`))) {
    logInfo(`[pushMethod:${direction}] refactoring engine unavailable; user declined install`);
    return undefined;
  }

  // Pre-flight: refuse a global decline (or a nothing-movable push) before opening the
  // preview, and explain why.
  let analysis;
  try {
    analysis = parseAnalysis(
      await queries.analyzePushMethod(session, direction, sourceClass, selectors, isMeta, dict),
    );
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Push pre-flight failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return undefined;
  }
  if (analysis.globalDecline) {
    refuse(analysis.globalDecline);
    return undefined;
  }
  if (analysis.movableCount === 0) {
    // Lead with the engine's reason (it already starts "Cannot push … #sel: …"), so the
    // actionable part is visible up front in the toast; list a count when several fail.
    const declined = analysis.selectors.filter((s) => s.decline);
    refuse(
      declined.length <= 1
        ? (declined[0]?.decline ?? 'None of the selected methods can be pushed.')
        : `${declined.length} methods cannot be pushed. ${declined[0].decline}`,
    );
    return undefined;
  }

  const token = `push_${direction}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const safeClear = (): void => {
    try {
      queries.clearPushMethodPreview(session, direction, token);
    } catch {
      /* best-effort cleanup */
    }
  };

  let start;
  try {
    start = parseStartPreview(
      await queries.startPushMethodPreview(
        session,
        direction,
        sourceClass,
        selectors,
        isMeta,
        token,
        PREVIEW_PAGE_BYTES,
        dict,
      ),
    );
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Push preview failed: ${e instanceof Error ? e.message : String(e)}`,
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
    refuse('Nothing to push.');
    safeClear();
    return undefined;
  }

  const heading =
    direction === 'up'
      ? `Push up to ${start.targetClass ?? analysis.targetClass ?? 'superclass'}`
      : `Push down into subclasses of ${sourceClass}`;
  const result = await showPushMethodPanel(heading, start, {
    loadPage: async (off) =>
      parsePage(
        await queries.pagePushMethodPreview(session, direction, token, off, PREVIEW_PAGE_BYTES),
      ),
    apply: async (deselected) =>
      parseApplyResult(await queries.applyPushMethod(session, direction, token, deselected)),
    cleanup: safeClear,
  });
  if (!result) return undefined;

  if (result.failed.length > 0) {
    const first = result.failed[0];
    void vscode.window.showErrorMessage(`Push failed: ${first.label}: ${first.error}`);
    return undefined;
  }

  const moved = analysis.selectors.filter((s) => !s.decline).map((s) => s.selector);
  const n = moved.length;
  const where =
    direction === 'up' ? `to ${start.targetClass ?? 'the superclass'}` : 'to the subclasses';
  void vscode.window.showInformationMessage(
    n === 1
      ? `Pushed #${moved[0]} ${direction} ${where}.`
      : `Pushed ${n} methods ${direction} ${where}.`,
  );
  return {
    applied: result.applied,
    moved,
    targetClass: direction === 'up' ? (start.targetClass ?? analysis.targetClass) : null,
    isMeta,
  };
}
