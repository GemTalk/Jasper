/**
 * The Rename Temporary/Argument (R5) command. Unlike the tree-triggered rename
 * refactorings, R5 is driven from the METHOD SOURCE EDITOR: the user puts the
 * cursor on a temporary or argument and invokes the command. It resolves the
 * class/selector/side from the gemstone: method URI, the name + source offset from
 * the cursor, previews the (single-method) rename server-side, shows the standard
 * preview panel, applies (recompile in the stone, no commit), then reloads and
 * re-focuses the method editor so it shows the saved, recompiled source.
 *
 * The method must be saved first: the engine rewrites the STORED source at the
 * given offset, so a dirty buffer's offsets would not line up. A dirty editor is
 * saved (its own normal recompile-on-save) before the rename runs.
 */
import * as vscode from 'vscode';
import { SessionManager } from '../sessionManager';
import * as queries from '../browserQueries';
import { PREVIEW_PAGE_BYTES } from './queries/previewRenameMethod';
import {
  parseStartPreview,
  parsePage,
  parseApplyResult,
  validateNewTemporaryName,
} from './renameTemporaryPreview';
import { showRenameTemporaryPanel } from './renameTemporaryPanel';
import { logInfo } from '../gciLog';
import {
  resolveMethodEditor,
  wordAt,
  ensureRbSupport,
  refuse,
  reloadMethodEditor,
  saveIfDirty,
} from './renameAtCursorShared';

/** Run the rename-temporary flow for the active method editor. When invoked from
 *  the "Refactor…" code action, `position` is the exact spot the action was offered
 *  at; the palette command passes none and falls back to the editor cursor. */
export async function renameTemporaryCommand(
  sessions: SessionManager,
  position?: vscode.Position,
): Promise<void> {
  logInfo('[renameTemp] invoked');
  const target = resolveMethodEditor(sessions, position, 'a temporary or argument');
  if (!target) return;
  if (!(await ensureRbSupport(target.session, 'Renaming a temporary'))) {
    logInfo('[renameTemp] refactoring engine unavailable; user declined install');
    return;
  }

  const word = wordAt(target, 'a temporary or argument');
  if (!word) return;
  const { editor, parsed, session, dict } = target;
  const oldName = word.name;
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

  // Refuse up front, with a specific reason, if the cursor is not on a renamable
  // temporary/argument (an instance variable, an inherited one, a class variable,
  // a global, a pseudo-variable, or a message selector) — so the user is told why
  // before being asked for a new name. Offsets match the just-saved stored source.
  logInfo(
    `[renameTemp] pre-check '${oldName}' @${offset} in ${parsed.className}>>${parsed.selector}`,
  );
  try {
    const reason = (
      await queries.renameTemporaryDeclineReason(
        session,
        parsed.className,
        parsed.selector,
        parsed.isMeta,
        oldName,
        offset,
        dict,
      )
    ).trim();
    if (reason.length > 0) {
      refuse(reason);
      focusEditor();
      return;
    }
  } catch (e: unknown) {
    // Non-fatal: fall through — startPreview still guards decline/collision.
    logInfo(
      `[renameTemp] pre-check failed (falling through): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  logInfo('[renameTemp] pre-check passed; prompting for new name');

  const entered = await vscode.window.showInputBox({
    title: 'Rename Temporary/Argument',
    prompt: `Rename '${oldName}' in ${parsed.className}${parsed.isMeta ? ' class' : ''}>>${parsed.selector}.`,
    value: oldName,
    valueSelection: [0, oldName.length],
    validateInput: (v) => validateNewTemporaryName(v, oldName),
  });
  if (entered === undefined) {
    focusEditor();
    return;
  }
  const newName = entered.trim();
  if (newName === oldName) {
    focusEditor();
    return;
  }

  const token = `rtmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const safeClear = (): void => {
    try {
      queries.clearRenameTemporaryPreview(session, token);
    } catch {
      /* best-effort cleanup */
    }
  };

  let start;
  try {
    const json = await queries.startRenameTemporaryPreview(
      session,
      parsed.className,
      parsed.selector,
      parsed.isMeta,
      oldName,
      newName,
      offset,
      token,
      PREVIEW_PAGE_BYTES,
      dict,
    );
    start = parseStartPreview(json);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    void vscode.window.showErrorMessage(`Rename preview failed: ${msg}`);
    safeClear();
    focusEditor();
    return;
  }

  // A decline (the target is not a renamable local) or a collision (the new name
  // is already taken) is refused up front — we never open the panel or apply, so a
  // shadowing rename cannot slip through.
  if (start.outOfScope.decline) {
    refuse(start.outOfScope.decline);
    safeClear();
    focusEditor();
    return;
  }
  if (start.outOfScope.collision) {
    refuse(`Cannot rename to '${newName}': ${start.outOfScope.collision}.`);
    safeClear();
    focusEditor();
    return;
  }
  if (start.total === 0) {
    refuse(`No occurrences of '${oldName}' to rename.`);
    safeClear();
    focusEditor();
    return;
  }

  const result = await showRenameTemporaryPanel(oldName, newName, start, {
    loadPage: async (off) =>
      parsePage(await queries.pageRenameTemporaryPreview(session, token, off, PREVIEW_PAGE_BYTES)),
    apply: async () => parseApplyResult(await queries.applyRenameTemporary(session, token)),
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
    void vscode.window.showErrorMessage(`Rename failed: ${result.error}`);
    focusEditor();
    return;
  }

  if (result.failed.length > 0) {
    const first = result.failed[0];
    void vscode.window.showErrorMessage(`Rename failed: ${first.label}: ${first.error}`);
    focusEditor();
    return;
  }

  // The method was recompiled server-side (no commit). Reload the editor from the
  // stone so it shows the saved, renamed source, and re-focus it (Eric: the method
  // is selected after the refactoring).
  await reloadMethodEditor(editor);
  void vscode.window.setStatusBarMessage(`Renamed '${oldName}' → '${newName}'`, 4000);
}
