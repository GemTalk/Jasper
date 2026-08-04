/**
 * The Inline Method (M2) command. Driven from a GemStone METHOD SOURCE EDITOR: the
 * user places the caret on a self/super message send and invokes the command from
 * the editor context menu (or palette). It resolves the class/selector/side from
 * the gemstone: method URI, converts the caret to a 1-based source offset, runs a
 * server-side pre-flight (which method the send resolves to, whether it can be
 * inlined at all, whether this is the target's last sender), previews the change
 * set (the rewritten caller + an offered removal when last-sender), applies it
 * server-side (recompile the caller + optionally delete the target, no commit),
 * then reloads and re-focuses the method editor.
 *
 * The method is saved first: the engine rewrites the STORED source at the caret
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
} from './inlineMethodPreview';
import { showInlineMethodPanel } from './inlineMethodPanel';
import { logInfo } from '../gciLog';
import {
  resolveMethodEditor,
  ensureRbSupport,
  refuse,
  reloadMethodEditor,
  saveIfDirty,
  codePointsBefore,
} from './renameAtCursorShared';

/** Run the inline-method flow for the active method editor at the caret. */
export async function inlineMethodCommand(
  sessions: SessionManager,
  position?: vscode.Position,
): Promise<void> {
  logInfo('[inlineMethod] invoked');
  const target = resolveMethodEditor(sessions, position, 'the message send to inline');
  if (!target) return;
  if (!(await ensureRbSupport(target.session, 'Inlining a method'))) {
    logInfo('[inlineMethod] refactoring engine unavailable; user declined install');
    return;
  }
  const { editor, parsed, session, dict, at } = target;

  const focusEditor = (): void => {
    void vscode.window.showTextDocument(editor.document, {
      viewColumn: editor.viewColumn,
      preserveFocus: false,
    });
  };

  // The engine rewrites the STORED source, so save a dirty buffer first — else the
  // offset computed below would not match what the stone compiled.
  if (!(await saveIfDirty(editor))) return;

  const offset = codePointsBefore(editor.document, at) + 1;

  // Pre-flight: refuse a hard decline before opening the preview.
  let analysis;
  try {
    analysis = parseAnalysis(
      await queries.analyzeInlineSend(
        session,
        parsed.className,
        parsed.selector,
        parsed.isMeta,
        offset,
        dict,
      ),
    );
  } catch (e: unknown) {
    void vscode.window.showErrorMessage(
      `Inline pre-flight failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    focusEditor();
    return;
  }
  if (analysis.decline) {
    refuse(analysis.decline);
    focusEditor();
    return;
  }

  const token = `iln_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const safeClear = (): void => {
    try {
      queries.clearInlineMethodPreview(session, token);
    } catch {
      /* best-effort cleanup */
    }
  };

  let start;
  try {
    start = parseStartPreview(
      await queries.startInlineMethodPreview(
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
    refuse('Nothing to inline at the cursor.');
    safeClear();
    focusEditor();
    return;
  }

  const targetLabel = start.targetSelector ?? analysis.targetSelector ?? parsed.selector;
  const result = await showInlineMethodPanel(targetLabel, start, {
    loadPage: async (off) =>
      parsePage(await queries.pageInlineMethodPreview(session, token, off, PREVIEW_PAGE_BYTES)),
    apply: async (deselected) =>
      parseApplyResult(await queries.applyInlineMethod(session, token, deselected)),
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

  // The caller was recompiled server-side (no commit). Reload its editor so it shows
  // the inlined body.
  await reloadMethodEditor(editor);

  // When a removal was offered, refresh the Explorer so a deleted target drops from
  // its method tree (harmless when the removal was unticked).
  if (start.lastSender) {
    try {
      await vscode.commands.executeCommand('gemstone.explorer.refresh');
    } catch {
      /* the Explorer may not be active */
    }
  }
  void vscode.window.setStatusBarMessage(`Inlined ${targetLabel}`, 4000);
}
