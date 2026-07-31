/**
 * The Extract Temporary (M3) command. Driven from a GemStone METHOD SOURCE EDITOR:
 * the user selects an expression and invokes the command from the editor context
 * menu (or palette). It resolves the class/selector/side from the gemstone: method
 * URI, converts the editor selection to 1-based source offsets, runs a server-side
 * pre-flight (how many identical occurrences exist, whether it can be extracted at
 * all), prompts for the new temporary name, offers "replace all N occurrences" when
 * more than one is in scope, previews the change, applies it server-side (recompile
 * the one method, no commit), then reloads and re-focuses the method editor.
 *
 * The method is saved first: the engine rewrites the STORED source at the given
 * offsets, so a dirty buffer's offsets would not line up.
 */
import * as vscode from 'vscode';
import { SessionManager } from '../sessionManager';
import * as queries from '../browserQueries';
import { PREVIEW_PAGE_BYTES } from './queries/previewRenameMethod';
import {
  parseAnalysis,
  parseStartPreview,
  parsePage,
  parseApplyResult,
  validateNewTemporaryName,
} from './extractTemporaryPreview';
import { showExtractTemporaryPanel } from './extractTemporaryPanel';
import { logInfo } from '../gciLog';
import {
  resolveMethodEditor,
  ensureRbSupport,
  refuse,
  reloadMethodEditor,
  saveIfDirty,
  codePointsBefore,
} from './renameAtCursorShared';

/** Run the extract-temporary flow for the active method editor. */
export async function extractTemporaryCommand(sessions: SessionManager): Promise<void> {
  logInfo('[extractTemp] invoked');
  const target = resolveMethodEditor(sessions, undefined, 'the expression to extract');
  if (!target) return;
  if (!(await ensureRbSupport(target.session, 'Extracting a temporary'))) {
    logInfo('[extractTemp] refactoring engine unavailable; user declined install');
    return;
  }
  const { editor, parsed, session, dict } = target;

  const focusEditor = (): void => {
    void vscode.window.showTextDocument(editor.document, {
      viewColumn: editor.viewColumn,
      preserveFocus: false,
    });
  };

  const sel = editor.selection;
  if (sel.isEmpty) {
    refuse('Select an expression to extract into a temporary variable.');
    return;
  }
  // The engine rewrites the STORED source, so save a dirty buffer first.
  if (!(await saveIfDirty(editor))) return;

  const selStart = codePointsBefore(editor.document, sel.start) + 1;
  const selStop = codePointsBefore(editor.document, sel.end);
  if (selStop < selStart) {
    refuse('Select an expression to extract into a temporary variable.');
    return;
  }

  // Pre-flight: refuse hard declines before prompting; learn how many occurrences are
  // in scope so we can offer "replace all".
  let analysis;
  try {
    analysis = parseAnalysis(
      await queries.analyzeExtractTemporary(
        session,
        parsed.className,
        parsed.selector,
        parsed.isMeta,
        selStart,
        selStop,
        dict,
      ),
    );
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Extract pre-flight failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    focusEditor();
    return;
  }
  if (analysis.decline) {
    refuse(analysis.decline);
    focusEditor();
    return;
  }

  const entered = await vscode.window.showInputBox({
    title: 'Extract Temporary',
    prompt: `Name for the new temporary variable in ${parsed.className}${parsed.isMeta ? ' class' : ''}>>${parsed.selector}.`,
    value: '',
    validateInput: (v) => validateNewTemporaryName(v),
  });
  if (entered === undefined) {
    focusEditor();
    return;
  }
  const newName = entered.trim();

  // Offer to replace every identical occurrence when more than one is in scope.
  let replaceAll = false;
  if (analysis.occurrenceCount > 1) {
    const ALL = `Replace all ${analysis.occurrenceCount} occurrences`;
    const ONE = 'Replace only the selected occurrence';
    const pick = await vscode.window.showQuickPick([ONE, ALL], {
      title: 'Extract Temporary',
      placeHolder: `The expression appears ${analysis.occurrenceCount} times in this scope.`,
    });
    if (pick === undefined) {
      focusEditor();
      return;
    }
    replaceAll = pick === ALL;
  }

  const token = `xtt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const safeClear = (): void => {
    try {
      queries.clearExtractTemporaryPreview(session, token);
    } catch {
      /* best-effort cleanup */
    }
  };

  let start;
  try {
    start = parseStartPreview(
      await queries.startExtractTemporaryPreview(
        session,
        parsed.className,
        parsed.selector,
        parsed.isMeta,
        selStart,
        selStop,
        newName,
        replaceAll,
        token,
        PREVIEW_PAGE_BYTES,
        dict,
      ),
    );
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Extract preview failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    safeClear();
    focusEditor();
    return;
  }

  // A decline (not an extractable expression) or a collision (the new name is already
  // taken) is refused up front — we never open the panel or apply, so a shadowing
  // extraction cannot slip through.
  if (start.outOfScope.decline) {
    refuse(start.outOfScope.decline);
    safeClear();
    focusEditor();
    return;
  }
  if (start.outOfScope.collision) {
    refuse(`Cannot extract to '${newName}': ${start.outOfScope.collision}.`);
    safeClear();
    focusEditor();
    return;
  }
  if (start.total === 0) {
    refuse('Nothing to extract from the selection.');
    safeClear();
    focusEditor();
    return;
  }

  const result = await showExtractTemporaryPanel(newName, start, replaceAll, {
    loadPage: async (off) =>
      parsePage(await queries.pageExtractTemporaryPreview(session, token, off, PREVIEW_PAGE_BYTES)),
    apply: async () => parseApplyResult(await queries.applyExtractTemporary(session, token)),
    cleanup: safeClear,
  });
  if (!result) {
    focusEditor();
    return;
  }

  // A whole-apply error (an expired preview token) answers `applied:0` with an empty
  // `failed`, so it parses cleanly and would otherwise reach the success path — which
  // reloads the editor as if it had been rewritten. Nothing changed, so no abort advice.
  if (result.error) {
    void vscode.window.showErrorMessage(`Extract failed: ${result.error}`);
    focusEditor();
    return;
  }

  if (result.failed.length > 0) {
    const first = result.failed[0];
    void vscode.window.showErrorMessage(`Extract failed: ${first.label}: ${first.error}`);
    focusEditor();
    return;
  }

  // The method was recompiled server-side (no commit). Reload the editor from the
  // stone so it shows the saved, rewritten source, and re-focus it.
  await reloadMethodEditor(editor);
  void vscode.window.setStatusBarMessage(`Extracted '${newName}'`, 4000);
}
