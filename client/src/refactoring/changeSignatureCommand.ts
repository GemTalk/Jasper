/**
 * The Change Method Signature (M5) flow: add, remove, or reorder a method's
 * parameters across its implementors and senders, previewed and applied server-side
 * WITHOUT committing. It generalizes R2 (rename method) so the arity can change.
 *
 * Two entry points share one flow, `beginChangeSignature`:
 *   1. the Explorer's "Change Signature…" command on a method row
 *      (gemstone.explorer.changeSignature), and
 *   2. the method source pane's native Refactor… menu
 *      (gemstone.changeMethodSignature), which targets the EDITED method's own
 *      signature (resolved from the editor URI — no text selection needed).
 *
 * The flow: gate on the engine → save the source editor if dirty → pre-flight
 * analyse (to pre-populate the signature editor) → signature editor → start the
 * paginated preview (refusing to open the panel on a hard collision/decline) →
 * preview panel → server apply (no commit) → reload the edited method + refresh the
 * Explorer (the selector changed).
 */
import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from '../sessionManager';
import { parseUri } from '../gemstoneFileSystemProvider';
import * as queries from '../browserQueries';
import { PREVIEW_PAGE_BYTES } from './queries/previewRenameMethod';
import {
  parseAnalysis,
  parseStartPreview,
  parsePage,
  parseApplyResult,
  validateSignatureParts,
  duplicateArgName,
  isNoOpChange,
  buildSelector,
} from './changeSignaturePreview';
import { showChangeSignatureEditor } from './changeSignatureEditor';
import { showChangeSignaturePanel } from './changeSignaturePanel';
import { logInfo } from '../gciLog';
import { resolveMethodEditor, ensureRbSupport, refuse, saveIfDirty } from './renameAtCursorShared';

/** What the shared change-signature flow needs to start. */
export interface ChangeSignatureTarget {
  className: string;
  selector: string;
  isMeta: boolean;
  dictIndex?: number;
  dictName?: string;
}

export interface ChangeSignatureDeps {
  session: ActiveSession;
  /** The source editor to save (if dirty) before the preview; omitted for the
   *  Explorer entry, which has no editor to save. */
  saveEditor?: vscode.TextEditor;
  /** Called after a successful apply, with the old and new selectors, to reload
   *  affected editors and refresh the Explorer (the selector changed). */
  onApplied: (oldSelector: string, newSelector: string) => void | Promise<void>;
}

/** Run the change-signature flow for a resolved method target. Answers true when the
 *  change was APPLIED, false on any cancel/decline/error path. */
export async function beginChangeSignature(
  target: ChangeSignatureTarget,
  deps: ChangeSignatureDeps,
): Promise<boolean> {
  const { session } = deps;
  if (!(await ensureRbSupport(session, 'Changing a method signature'))) {
    logInfo('[changeSignature] refactoring engine unavailable; user declined install');
    return false;
  }

  if (deps.saveEditor && !(await saveIfDirty(deps.saveEditor))) return false;

  const { className, selector: oldSelector, isMeta } = target;
  const dict = target.dictIndex ?? target.dictName;

  // Pre-flight: get the current parts + arg names to pre-populate the editor, and
  // refuse a hard decline (absent / unparseable method) before opening anything.
  let analysis;
  try {
    analysis = parseAnalysis(
      await queries.analyzeChangeSignature(session, className, oldSelector, isMeta, dict),
    );
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Change-signature pre-flight failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
  if (analysis.decline) {
    refuse(analysis.decline);
    return false;
  }

  const edit = await showChangeSignatureEditor({
    className,
    oldSelector,
    isMeta,
    argNames: analysis.argNames,
    dictName: target.dictName,
  });
  if (!edit) return false;

  const partsErr = validateSignatureParts(edit.newParts, oldSelector);
  if (partsErr) {
    void vscode.window.showErrorMessage(`Change signature: ${partsErr}`);
    return false;
  }
  const dupe = duplicateArgName(edit.newArgNames);
  if (dupe) {
    void vscode.window.showErrorMessage(`Change signature: duplicate argument name '${dupe}'.`);
    return false;
  }
  const newSelector = buildSelector(edit.newParts);
  if (isNoOpChange(edit.newParts, edit.permutation, oldSelector)) {
    // Tell the user why nothing happened (the command's "always say why" contract), the
    // same as the total===0 / collision / decline bail-outs below.
    void vscode.window.showInformationMessage(
      `The signature of '${oldSelector}' is unchanged; nothing to do.`,
    );
    return false;
  }

  // A client-generated token keys this preview's server-side state for paging and
  // the eventual apply.
  const token = `csig_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const safeClear = (): void => {
    try {
      queries.clearChangeSignaturePreview(session, token);
    } catch {
      /* best-effort cleanup */
    }
  };

  let start;
  try {
    start = parseStartPreview(
      await queries.startChangeSignaturePreview(
        session,
        className,
        oldSelector,
        edit.newParts,
        edit.permutation,
        edit.newArgNames,
        edit.defaults,
        edit.scope,
        token,
        PREVIEW_PAGE_BYTES,
        isMeta,
        target.dictIndex,
      ),
    );
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Change-signature preview failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    safeClear();
    return false;
  }

  // Both are hard blockers: the new selector already exists on the class (collision),
  // or the change isn't behaviour-preserving (e.g. removing a used parameter).
  if (start.outOfScope.collision) {
    refuse(start.outOfScope.collision);
    safeClear();
    return false;
  }
  if (start.outOfScope.decline) {
    refuse(start.outOfScope.decline);
    safeClear();
    return false;
  }
  if (start.total === 0) {
    safeClear();
    void vscode.window.showInformationMessage(
      `No implementors or senders of '${oldSelector}' were found in the chosen scope; ` +
        'nothing to change.',
    );
    return false;
  }

  const result = await showChangeSignaturePanel(oldSelector, newSelector, start, {
    loadPage: async (offset) =>
      parsePage(
        await queries.pageChangeSignaturePreview(session, token, offset, PREVIEW_PAGE_BYTES),
      ),
    apply: async (deselected) =>
      parseApplyResult(await queries.applyChangeSignature(session, token, deselected)),
    cleanup: safeClear,
  });
  if (!result) return false; // cancelled/closed

  // A whole-apply error (an expired preview token) answers `applied:0` with an empty
  // `failed`, so it parses cleanly. Reported before `onApplied` below: the selector never
  // changed, so refreshing/reopening editors on the new selector would be wrong. Nothing
  // was applied, so no abort advice.
  if (result.error) {
    void vscode.window.showErrorMessage(`Change signature failed: ${result.error}`);
    return false;
  }

  await deps.onApplied(oldSelector, newSelector);

  if (result.failed.length > 0) {
    const first = result.failed[0];
    void vscode.window.showErrorMessage(
      `Change signature applied ${result.applied} change(s); ${result.failed.length} failed: ` +
        `${first.label}: ${first.error}` +
        (result.failed.length > 1 ? ` (+${result.failed.length - 1} more)` : ''),
    );
    return true;
  }
  void vscode.window.showInformationMessage(
    `Changed signature '${oldSelector}' → '${newSelector}' (${result.applied} change` +
      `${result.applied === 1 ? '' : 's'}). Compiled but NOT committed — commit when ready.`,
  );
  return true;
}

/**
 * The method-source-pane entry point (native Refactor… menu). Resolves the edited
 * method straight from the editor URI — no selection, no LSP selector lookup — and
 * runs the shared flow, then reloads the edited editor and refreshes the Explorer via
 * the supplied `refreshAfter` callback (which reopens editors under the new selector).
 */
export async function changeSignatureCommand(
  sessions: SessionManager,
  refreshAfter: (oldSelector: string, newSelector: string) => void | Promise<void>,
  position?: vscode.Position,
): Promise<void> {
  logInfo('[changeSignature] invoked from editor');

  // A never-saved method has no selector in the stone to change: its URI parses as
  // the dedicated new-method kind (or, defensively, as the placeholder selector).
  // resolveMethodEditor would refuse a new-method URI with a generic message, so guard
  // it here with a tailored one before delegating the rest.
  const active = vscode.window.activeTextEditor;
  if (active && active.document.uri.scheme === 'gemstone') {
    let parsed;
    try {
      parsed = parseUri(active.document.uri);
    } catch {
      parsed = undefined;
    }
    if (
      parsed?.kind === 'new-method' ||
      (parsed?.kind === 'method' && parsed.selector === 'new-method')
    ) {
      refuse('Save the new method first, then change its signature.');
      return;
    }
  }

  const target = resolveMethodEditor(sessions, position, 'the method to change');
  if (!target) return;
  const { editor, parsed, session } = target;

  await beginChangeSignature(
    {
      className: parsed.className,
      selector: parsed.selector,
      isMeta: parsed.isMeta,
      dictIndex: parsed.dictIndex,
      dictName: parsed.dictName,
    },
    {
      session,
      saveEditor: editor,
      onApplied: async (oldSelector, newSelector) => {
        await refreshAfter(oldSelector, newSelector);
      },
    },
  );
}
