/**
 * Shared plumbing for the "rename at cursor" family (temp/arg, instance variable,
 * class variable, method) driven from a GemStone method source editor via the
 * native Refactor… menu / command palette. Each command differs only in what it
 * renames; the editor→target resolution, engine gating, and refusal feedback are
 * identical, so they live here (one copy, not five) — which is also what keeps the
 * commands from diverging on dict-scope and gating order.
 */
import * as vscode from 'vscode';
import { SessionManager, ActiveSession } from '../sessionManager';
import { parseUri, ParsedUri } from '../gemstoneFileSystemProvider';
import { logInfo } from '../gciLog';

// A Smalltalk identifier at the cursor: letter/underscore then word chars. (Also
// matches inside a string/comment — harmless: the engine renames only real
// references, and the membership pre-checks resolve what the word actually is.)
const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/;

type ParsedMethodUri = Extract<ParsedUri, { kind: 'method' }>;

/** A refusal the user should see: a warning toast, breadcrumbed to the GemStone
 *  GCI output channel. (With Do Not Disturb filtering this extension, VS Code
 *  routes the toast silently to the notification center — it still lands there and
 *  in the log.) */
export function refuse(message: string): void {
  logInfo(`[renameAtCursor] refused: ${message}`);
  void vscode.window.showWarningMessage(message);
}

/** Gate on the refactoring engine being loaded; offer to install it if not.
 *  Answers true when it is (now) available. Shared so all the refactoring commands
 *  gate identically, BEFORE any engine-dependent query.
 *
 *  Takes the live session (not a boolean snapshot) so that, after the install
 *  command runs, it RE-CHECKS `session.rbSupportAvailable` and answers the actual
 *  outcome — if the install failed (wrong password, missing payload) or the user
 *  declined the post-install "Refresh this session?" prompt, this returns false and
 *  the caller cleanly refuses, instead of proceeding to send Smalltalk referencing
 *  refactoring classes that do not exist yet (a cryptic compile/DNU error). Mirrors
 *  gemstoneExplorer's private gate. */
export async function ensureRbSupport(
  session: ActiveSession | undefined,
  action: string,
): Promise<boolean> {
  if (!session) return false;
  // Read freshly each call: the install command below flips rbSupportAvailable, a
  // side effect TS's control-flow narrowing cannot see, so a direct property re-read
  // would be narrowed away.
  const available = (): boolean => session.rbSupportAvailable === true;
  if (available()) return true;
  const LOAD = 'Install GemStone Support…';
  const choice = await vscode.window.showInformationMessage(
    `${action} needs the GemStone refactoring engine, which isn't loaded in this stone yet.`,
    LOAD,
  );
  if (choice !== LOAD) return false;
  await vscode.commands.executeCommand('gemstone.installServerSupport');
  return available();
}

export interface MethodEditorTarget {
  editor: vscode.TextEditor;
  parsed: ParsedMethodUri;
  session: ActiveSession;
  /** The position the action is anchored at (code-action position, else cursor). */
  at: vscode.Position;
  /** The dict scope for class lookups: the 1-based SymbolList index when the URI
   *  carries one, else the dictionary name — so a class shadowed across
   *  dictionaries resolves the SAME way for a membership pre-check AND the rename
   *  itself (never scoped one way and run the other). */
  dict: number | string;
}

/** Resolve the active editor as a saved gemstone method, refusing (and answering
 *  undefined) when it is not one. `subject` names what the caller renames, for the
 *  refusal messages (e.g. "an instance variable"). */
export function resolveMethodEditor(
  sessions: SessionManager,
  position: vscode.Position | undefined,
  subject: string,
): MethodEditorTarget | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'gemstone') {
    refuse(`Open a GemStone method and place the cursor on ${subject} to rename it.`);
    return undefined;
  }

  let parsed: ParsedUri | undefined;
  try {
    parsed = parseUri(editor.document.uri);
  } catch {
    parsed = undefined;
  }
  if (!parsed || parsed.kind !== 'method') {
    refuse('This rename works in a method source editor.');
    return undefined;
  }

  const session = sessions.getSession(parsed.sessionId);
  if (!session) {
    refuse('No GemStone session for this editor.');
    return undefined;
  }

  return {
    editor,
    parsed,
    session,
    at: position ?? editor.selection.active,
    dict: parsed.dictIndex ?? parsed.dictName,
  };
}

/** The identifier at the target's position (with its 1-based source offset), or
 *  undefined when the position is not on an identifier. `subject` names what the
 *  caller renames, for the refusal message. By default a miss refuses with a
 *  warning; pass `{ silent: true }` when the caller treats "no identifier" as a
 *  valid outcome (the unified-rename dispatcher falls through to Rename Method) and
 *  so must not flash a spurious "not a variable" warning. */
export function wordAt(
  target: MethodEditorTarget,
  subject: string,
  opts?: { silent?: boolean },
): { name: string; wordRange: vscode.Range; offset: number } | undefined {
  const document = target.editor.document;
  const wordRange = document.getWordRangeAtPosition(target.at, IDENTIFIER);
  if (!wordRange) {
    if (!opts?.silent) refuse(`Place the cursor on ${subject} name (that spot is not a variable).`);
    return undefined;
  }
  // 1-based source offset. The engine indexes the stored source by CHARACTER (a
  // GemStone Character is a full code point), but VS Code offsets count UTF-16
  // code units — they differ once a non-BMP character (emoji, astral) appears
  // before the cursor. Count code points in the prefix (`Array.from` iterates by
  // code point) so the offset stays aligned; for the common all-ASCII/BMP source
  // this equals the plain length, so nothing changes.
  const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), wordRange.start));
  return {
    name: document.getText(wordRange),
    wordRange,
    offset: Array.from(prefix).length + 1,
  };
}

/** Ensure the editor is saved before a refactoring runs, so the refactoring
 *  operates on (and later reloads) the STORED source — never silently discarding
 *  the user's edits via the post-rename reload, and (for the offset-based temp
 *  rename) keeping the offset aligned with what the stone compiled.
 *
 *  A refactoring compiles the method to GemStone; that save is durable and a later
 *  Cancel in the refactoring cannot undo it. So we never save behind the user's
 *  back: a dirty editor is confirmed first, and the refactoring is aborted (answers
 *  false) if the user declines. Answers false (and refuses) if the save itself
 *  fails. A clean editor proceeds with no prompt. */
export const SAVE_BEFORE_REFACTOR = 'Save and Continue';

export async function saveIfDirty(editor: vscode.TextEditor): Promise<boolean> {
  if (!editor.document.isDirty) return true;

  const choice = await vscode.window.showWarningMessage(
    'This method has unsaved changes. Refactoring saves them to GemStone first, and ' +
      'cancelling the refactoring will not undo that save. Save and continue?',
    { modal: true },
    SAVE_BEFORE_REFACTOR,
  );
  if (choice !== SAVE_BEFORE_REFACTOR) return false;

  const saved = await editor.document.save();
  if (!saved) refuse('Save the method before renaming.');
  return saved;
}

/** 1-based count of code points before `position` in `document`. The engine indexes
 *  the stored source by CHARACTER (a GemStone Character is a full code point) while
 *  VS Code offsets count UTF-16 code units — they differ once a non-BMP character
 *  appears before the position, so count code points (`Array.from`). */
export function codePointsBefore(document: vscode.TextDocument, position: vscode.Position): number {
  const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
  return Array.from(prefix).length;
}

/** After an applied rename, reload the method editor from the stone (so it shows
 *  the recompiled source) and put focus back on it. */
export async function reloadMethodEditor(editor: vscode.TextEditor): Promise<void> {
  await vscode.window.showTextDocument(editor.document, { preserveFocus: false });
  try {
    await vscode.commands.executeCommand('workbench.action.files.revert');
  } catch {
    /* best-effort: the editor is focused even if revert is unavailable */
  }
}
