/**
 * The split-class refactoring (V8 / extract class), driven from the Explorer class row. The user
 * picks a set of the source's OWN instance variables to extract; the engine creates a new component
 * class holding those ivars and the methods that use them, and leaves the source with a lazy
 * accessor and a delegating stub per moved method. The flow is:
 *
 *   1. Gate on RB engine availability.
 *   2. List the source's own instance variables (candidatesForSplitClass). If none, say so.
 *   3. Multi-select which ivars to extract.
 *   4. Prompt for the new component class's name (a capitalised identifier).
 *   5. Pre-flight (analyzeSplitClass): a decline blocks the panel; otherwise open the preview.
 *   6. Paginated preview → apply (server-side, all-or-nothing, never commits).
 *
 * The apply creates a new class + new source-class version server-side and never commits (existing
 * instances keep their prior version, and are NOT migrated) — the user commits explicitly. Returns
 * the new class name on success so the caller can reveal it.
 */
import * as vscode from 'vscode';
import { ActiveSession } from '../sessionManager';
import * as queries from '../browserQueries';
import { PREVIEW_PAGE_BYTES } from './queries/previewRenameMethod';
import {
  parseAnalysis,
  parseCandidates,
  parseStartPreview,
  parsePage,
  parseApplyResult,
} from './splitClassPreview';
import { showSplitClassPanel } from './splitClassPanel';
import { ensureRbSupport, refuse } from './renameAtCursorShared';
import { logInfo } from '../gciLog';

export interface SplitClassContext {
  session: ActiveSession;
  className: string;
  dict?: number | string;
}

export interface SplitClassResult {
  newClass: string;
  applied: number;
}

/** A valid GemStone class name: a capitalised identifier. Returns an error string or null. */
function validateClassName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Enter a class name.';
  if (!/^[A-Z][A-Za-z0-9_]*$/.test(trimmed)) {
    return 'A class name must start with an uppercase letter and contain only letters, digits, or underscores.';
  }
  return null;
}

/** Save any open GemStone method editors with unsaved edits, so the engine reads their CURRENT
 *  source rather than the stale stored version. Split-class is Explorer-driven with no single
 *  active editor, so flush every dirty `gemstone:`-scheme buffer. Returns false (and refuses) if
 *  one will not save — e.g. it does not compile — leaving the user to fix it before retrying. */
async function flushDirtyMethodBuffers(): Promise<boolean> {
  const dirty = vscode.workspace.textDocuments.filter(
    (d) => d.isDirty && d.uri.scheme === 'gemstone',
  );
  for (const doc of dirty) {
    if (!(await doc.save())) {
      refuse('Save your open method edits before splitting the class.');
      return false;
    }
  }
  return true;
}

async function promptNewClassName(source: string): Promise<string | undefined> {
  const name = await vscode.window.showInputBox({
    title: `New component class extracted from ${source}`,
    prompt: 'Name of the new class to hold the extracted instance variables',
    placeHolder: 'e.g. Address',
    ignoreFocusOut: true,
    validateInput: (v) => validateClassName(v) ?? undefined,
  });
  return name?.trim();
}

/** V8: extract a chosen set of the source's own instance variables (and the methods that use them)
 *  into a new component class, leaving the source with a lazy accessor + delegators. */
export async function splitClassCommand(
  ctx: SplitClassContext,
): Promise<SplitClassResult | undefined> {
  const { session, className, dict } = ctx;
  logInfo(`[splitClass] ${className}`);
  if (!(await ensureRbSupport(session, 'Split Class'))) return undefined;

  // 1. Which of the source's own instance variables can be extracted?
  let candidates;
  try {
    candidates = parseCandidates(await queries.candidatesForSplitClass(session, className, dict));
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Could not read instance variables: ${e instanceof Error ? e.message : String(e)}`,
    );
    return undefined;
  }
  if (candidates.instVars.length === 0) {
    void vscode.window.showInformationMessage(
      `${className} has no own instance variables to extract into a new class.`,
    );
    return undefined;
  }

  // 2. Multi-select the extract set (none pre-picked).
  const chosen = await vscode.window.showQuickPick(
    candidates.instVars.map((v) => v.name),
    {
      title: `Split ${className} — which instance variables to extract?`,
      placeHolder: 'Select the instance variables to move into the new class',
      canPickMany: true,
      ignoreFocusOut: true,
    },
  );
  if (chosen === undefined) return undefined; // Escape / cancelled — stay silent
  if (chosen.length === 0) {
    // Confirmed the pick with nothing checked: say why nothing happened, so it doesn't read as a
    // crash (an Escape is a deliberate back-out and stays silent above).
    void vscode.window.showInformationMessage(
      `Split ${className}: no instance variables selected — nothing to extract.`,
    );
    return undefined;
  }

  // 3. Name the new component class.
  const newName = await promptNewClassName(className);
  if (!newName) return undefined;

  // The engine moves methods by reading each method's STORED source, so flush any unsaved method
  // edits first — otherwise a dirty editor's method would move at its stale saved version.
  if (!(await flushDirtyMethodBuffers())) return undefined;

  // 4. Pre-flight.
  let analysis;
  try {
    analysis = parseAnalysis(
      await queries.analyzeSplitClass(session, className, newName, chosen, dict),
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

  // 5. Paginated preview + apply.
  const heading = `Split ${className} — extract ${newName}`;
  const token = `split_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const safeClear = (): void => {
    try {
      queries.clearSplitClassPreview(session, token);
    } catch {
      /* best-effort cleanup */
    }
  };

  let start;
  try {
    start = parseStartPreview(
      await queries.startSplitClassPreview(
        session,
        className,
        newName,
        chosen,
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

  // #434: snapshot the subtree BEFORE the reshape so it can be put back. The capture is held
  // PENDING and only becomes an undo entry once the apply is known to have landed, so every path
  // that does not get there drops it -- a partial reshape leaves the stone in a state the capture
  // does not describe, and must never have an undo offered against it.
  const discardCapture = (): void => {
    try {
      queries.discardPendingCapture(session);
    } catch {
      /* best-effort */
    }
  };
  try {
    queries.captureClassHistory(session, className);
  } catch {
    /* best-effort: a reshape must not fail because its undo bookkeeping did */
  }
  const result = await showSplitClassPanel(heading, start, {
    loadPage: async (off) =>
      parsePage(await queries.pageSplitClassPreview(session, token, off, PREVIEW_PAGE_BYTES)),
    apply: async () => parseApplyResult(await queries.applySplitClass(session, token)),
    cleanup: safeClear,
  });
  if (!result) {
    discardCapture();
    return undefined;
  }

  if (result.error) {
    discardCapture();
    void vscode.window.showErrorMessage(`${heading} failed: ${result.error}`);
    return undefined;
  }
  if (result.failed.length > 0) {
    const first = result.failed[0];
    discardCapture();
    void vscode.window.showErrorMessage(
      `Change failed: ${first.label}: ${first.error}. Earlier changes may have been applied — abort the transaction to discard them.`,
    );
    return undefined;
  }
  // Defensive: the preview was non-empty (guarded above) and the apply is all-or-nothing, so
  // zero changes applied without an error/failure is an impossible-in-practice state — but do not
  // claim success for it (the "no false success" rule).
  if (result.applied === 0) {
    discardCapture();
    void vscode.window.showErrorMessage(`${heading} applied no changes.`);
    return undefined;
  }

  // The reversal also has to UNBIND the class this created: it is brand new, so there is no
  // earlier version to revert it to.
  // #434 HELD BACK, deliberately. The engine side of this reversal is implemented and unit-tested,
  // but end-to-end testing found that GsClassHistory>>revertClassNamed:toIndex: does NOT restore a
  // class's own SUPERCLASS -- it restores shape and methods and re-parents SUBCLASSES, but leaves
  // the class itself under whatever parent it has now. For a refactoring that inserted a parent,
  // reverting and then unbinding that parent would leave the class pointing at an unbound class.
  // Until the reversal re-parents from the captured definition, no undo is offered here: the
  // capture is taken (harmless) and then dropped.
  discardCapture();
  void vscode.window.showInformationMessage(
    `${heading} — applied ${result.applied} change(s). Existing instances keep their prior version and are not migrated; commit to persist.`,
  );
  return { newClass: newName, applied: result.applied };
}
