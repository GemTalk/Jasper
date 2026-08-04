/**
 * The Extract Method (M1) command. Driven from a GemStone METHOD SOURCE EDITOR: the
 * user selects a run of statements (or a single expression) and invokes the
 * command from the editor context menu (or palette). It resolves the
 * class/selector/side from the gemstone: method URI, converts the editor selection
 * to 1-based source offsets, runs a server-side pre-flight (how many arguments the
 * selection needs, whether it can be extracted at all), prompts for the new
 * selector (validating its arity), optionally offers to also replace structurally
 * equivalent code in the hierarchy, previews the change set, applies it server-side
 * (compile the new method + rewrite the original, no commit), then reloads and
 * re-focuses the method editor.
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
  validateNewSelector,
} from './extractMethodPreview';
import { showExtractMethodPanel } from './extractMethodPanel';
import { buildMethodUri } from '../gemstoneFileSystemProvider';
import { logInfo } from '../gciLog';
import {
  resolveMethodEditor,
  ensureRbSupport,
  refuse,
  reloadMethodEditor,
  saveIfDirty,
  codePointsBefore,
} from './renameAtCursorShared';

/** Suggest a starting selector matching the required arity: unary for no args, else
 *  a keyword selector built from the argument names. The user edits it. */
function suggestSelector(argNames: string[]): string {
  if (argNames.length === 0) return 'extractedMethod';
  return argNames.map((n) => `${n}:`).join('');
}

/** Run the extract-method flow for the active method editor. */
export async function extractMethodCommand(sessions: SessionManager): Promise<void> {
  logInfo('[extractMethod] invoked');
  const target = resolveMethodEditor(sessions, undefined, 'the code to extract');
  if (!target) return;
  if (!(await ensureRbSupport(target.session, 'Extracting a method'))) {
    logInfo('[extractMethod] refactoring engine unavailable; user declined install');
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
    refuse('Select the statements (or a single expression) to extract.');
    return;
  }
  // The engine rewrites the STORED source, so save a dirty buffer first — else the
  // offsets computed below would not match what the stone compiled.
  if (!(await saveIfDirty(editor))) return;

  const selStart = codePointsBefore(editor.document, sel.start) + 1;
  const selStop = codePointsBefore(editor.document, sel.end);
  if (selStop < selStart) {
    refuse('Select the statements (or a single expression) to extract.');
    return;
  }

  // Pre-flight: refuse hard declines before prompting; learn the argument count so
  // the selector prompt can validate arity and suggest a default.
  let analysis;
  try {
    analysis = parseAnalysis(
      await queries.analyzeExtractSelection(
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
    title: 'Extract Method',
    prompt:
      analysis.argCount === 0
        ? 'Name for the new (unary) method.'
        : `Selector for the new method (${analysis.argCount} argument${analysis.argCount === 1 ? '' : 's'}: ${analysis.argNames.join(', ')}).`,
    value: suggestSelector(analysis.argNames),
    validateInput: (v) => validateNewSelector(v, analysis.argCount, parsed.selector),
  });
  if (entered === undefined) {
    focusEditor();
    return;
  }
  const newSelector = entered.trim();

  // For a safe void extraction, find structurally-similar sites in the hierarchy and
  // present them in the preview as opt-in (unchecked) rows — so there is no separate
  // up-front dialog; the choice lives in the panel, off by default.
  const replaceSimilar = analysis.safeVoidShape;

  const token = `xtm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const safeClear = (): void => {
    try {
      queries.clearExtractMethodPreview(session, token);
    } catch {
      /* best-effort cleanup */
    }
  };

  let start;
  try {
    start = parseStartPreview(
      await queries.startExtractMethodPreview(
        session,
        parsed.className,
        parsed.selector,
        parsed.isMeta,
        selStart,
        selStop,
        newSelector,
        replaceSimilar,
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

  // A hard decline still blocks; a collision is a SOFT warning shown in the panel
  // banner (the user may proceed).
  if (start.outOfScope.decline) {
    refuse(start.outOfScope.decline);
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

  const result = await showExtractMethodPanel(newSelector, start, {
    loadPage: async (off) =>
      parsePage(await queries.pageExtractMethodPreview(session, token, off, PREVIEW_PAGE_BYTES)),
    apply: async (deselected) =>
      parseApplyResult(await queries.applyExtractMethod(session, token, deselected)),
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

  // The new method + rewritten original were compiled server-side (no commit).
  // Reload the original editor so it shows the rewritten body (now a send to the
  // new method).
  await reloadMethodEditor(editor);

  // Surface the newly-created method: refresh the Explorer so its method tree lists
  // it, then open + focus its source editor (which also lands it in the Explorer's
  // Open Editors pane). The new method carries the source method's category.
  try {
    await vscode.commands.executeCommand('gemstone.explorer.refresh');
  } catch {
    /* the Explorer may not be active; opening the editor still surfaces it */
  }
  try {
    const newUri = buildMethodUri({
      kind: 'method',
      sessionId: parsed.sessionId,
      dictName: parsed.dictName,
      className: parsed.className,
      isMeta: parsed.isMeta,
      category: parsed.category,
      selector: newSelector,
      environmentId: parsed.environmentId,
      dictIndex: parsed.dictIndex,
    });
    await vscode.window.showTextDocument(newUri, { preview: false });
  } catch (e: unknown) {
    logInfo(
      `[extractMethod] could not open the new method editor: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  void vscode.window.setStatusBarMessage(`Extracted ${newSelector}`, 4000);
}
