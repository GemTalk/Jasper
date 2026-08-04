/**
 * The Inline Temporary (M4) command. Driven from a GemStone METHOD SOURCE EDITOR: the
 * user puts the cursor on a temporary and invokes the command from the editor context
 * menu (or palette). It resolves the class/selector/side from the gemstone: method
 * URI, the source offset from the cursor, runs a server-side pre-flight (is this an
 * inlinable temporary?), previews the (single-method) inline, shows the standard
 * preview panel, applies it server-side (recompile the one method, no commit), then
 * reloads and re-focuses the method editor.
 *
 * The method is saved first: the engine rewrites the STORED source at the given
 * offset, so a dirty buffer's offset would not line up.
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
} from './inlineTemporaryPreview';
import { showInlineTemporaryPanel } from './inlineTemporaryPanel';
import { logInfo } from '../gciLog';
import {
  resolveMethodEditor,
  wordAt,
  ensureRbSupport,
  refuse,
  reloadMethodEditor,
  saveIfDirty,
} from './renameAtCursorShared';

/** Run the inline-temporary flow for the active method editor. When invoked from the
 *  "Refactor…" code action, `position` is the exact spot; the palette command passes
 *  none and falls back to the editor cursor. */
export async function inlineTemporaryCommand(
  sessions: SessionManager,
  position?: vscode.Position,
): Promise<void> {
  logInfo('[inlineTemp] invoked');
  const target = resolveMethodEditor(sessions, position, 'the temporary to inline');
  if (!target) return;
  if (!(await ensureRbSupport(target.session, 'Inlining a temporary'))) {
    logInfo('[inlineTemp] refactoring engine unavailable; user declined install');
    return;
  }

  const word = wordAt(target, 'the temporary');
  if (!word) return;
  const { editor, parsed, session, dict } = target;
  const offset = word.offset;

  const focusEditor = (): void => {
    void vscode.window.showTextDocument(editor.document, {
      viewColumn: editor.viewColumn,
      preserveFocus: false,
    });
  };

  // The engine rewrites the STORED method source, so a dirty buffer must be saved
  // first or the offset would not match what the stone compiled.
  if (!(await saveIfDirty(editor))) return;

  // Pre-flight: refuse up front with a specific reason if the cursor is not on an
  // inlinable temporary (an argument, an instance/class variable, a global, or a
  // temporary that is assigned more than once / never / read before assignment).
  try {
    const analysis = parseAnalysis(
      await queries.analyzeInlineTemporary(
        session,
        parsed.className,
        parsed.selector,
        parsed.isMeta,
        offset,
        dict,
      ),
    );
    if (analysis.decline) {
      refuse(analysis.decline);
      focusEditor();
      return;
    }
  } catch (e: unknown) {
    // Non-fatal: fall through — startPreview still guards decline.
    logInfo(
      `[inlineTemp] pre-check failed (falling through): ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const token = `itt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const safeClear = (): void => {
    try {
      queries.clearInlineTemporaryPreview(session, token);
    } catch {
      /* best-effort cleanup */
    }
  };

  let start;
  try {
    start = parseStartPreview(
      await queries.startInlineTemporaryPreview(
        session,
        parsed.className,
        parsed.selector,
        parsed.isMeta,
        offset,
        token,
        PREVIEW_PAGE_BYTES,
        dict,
      ),
    );
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Inline preview failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    safeClear();
    focusEditor();
    return;
  }

  if (start.outOfScope.decline) {
    refuse(start.outOfScope.decline);
    safeClear();
    focusEditor();
    return;
  }
  if (start.total === 0) {
    refuse('Nothing to inline.');
    safeClear();
    focusEditor();
    return;
  }

  const result = await showInlineTemporaryPanel(start.name, start, {
    loadPage: async (off) =>
      parsePage(await queries.pageInlineTemporaryPreview(session, token, off, PREVIEW_PAGE_BYTES)),
    apply: async () => parseApplyResult(await queries.applyInlineTemporary(session, token)),
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
    void vscode.window.showErrorMessage(`Inline failed: ${result.error}`);
    focusEditor();
    return;
  }

  if (result.failed.length > 0) {
    const first = result.failed[0];
    void vscode.window.showErrorMessage(`Inline failed: ${first.label}: ${first.error}`);
    focusEditor();
    return;
  }

  // The method was recompiled server-side (no commit). Reload the editor from the
  // stone so it shows the saved, rewritten source, and re-focus it.
  await reloadMethodEditor(editor);
  void vscode.window.setStatusBarMessage(`Inlined '${start.name}'`, 4000);
}
