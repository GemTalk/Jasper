/**
 * "Rename Class Variable…" triggered from the METHOD SOURCE EDITOR (the Refactor…
 * code action / command palette): the user puts the cursor on a class variable in
 * a gemstone: method editor, and the existing R4 rename flow (input box →
 * all-or-nothing preview panel → server-side apply, no commit) runs for the
 * editor's class — the same flow the Explorer's class-var-row pencil drives.
 *
 * Simple-but-polite: when the word is NOT a class variable declared on this class,
 * a warning toast says what it is instead — visible-but-inherited (rename belongs
 * to the defining class, since R4 edits the defining class's classVars: clause) or
 * not a class variable at all.
 */
import * as vscode from 'vscode';
import { SessionManager } from '../sessionManager';
import * as queries from '../browserQueries';
import { logInfo } from '../gciLog';
import {
  resolveMethodEditor,
  wordAt,
  ensureRbSupport,
  refuse,
  reloadMethodEditor,
  saveIfDirty,
} from './renameAtCursorShared';

/** What the shared Explorer rename flow needs to start. */
export interface ClassVarRenameTarget {
  className: string;
  classVarName: string;
  dict: number | string;
}

/** Run the rename-class-variable flow for the identifier at the cursor.
 *  `beginRename` is the Explorer controller's shared flow; it answers true when
 *  the rename was applied, in which case the method editor is reloaded so it
 *  shows the recompiled source. */
export async function renameClassVarAtCursorCommand(
  sessions: SessionManager,
  beginRename: (target: ClassVarRenameTarget) => Promise<boolean>,
  position?: vscode.Position,
): Promise<void> {
  logInfo('[renameClassVar] invoked');
  const target = resolveMethodEditor(sessions, position, 'a class variable');
  if (!target) return;
  if (!(await ensureRbSupport(target.session, 'Renaming a class variable'))) return;

  const word = wordAt(target, 'a class variable');
  if (!word) return;
  // Save first: the rename recompiles this method server-side and the flow reloads
  // the editor afterwards, which would otherwise discard unsaved edits.
  if (!(await saveIfDirty(target.editor))) return;
  const { parsed, session, dict } = target;
  const name = word.name;

  // Simple membership pre-check: only a class variable DECLARED on this class
  // proceeds (R4 edits the declaring class's classVars: clause, so a visible-but-
  // inherited one belongs to its defining class; anything else is not a class-var
  // rename at all).
  try {
    const defined = queries.getDefinedClassVarNames(session, parsed.className, dict);
    if (!defined.includes(name)) {
      const visible = queries.getVisibleClassVarNames(session, parsed.className, dict);
      if (visible.includes(name)) {
        refuse(
          `'${name}' is a class variable INHERITED by ${parsed.className} — rename it on its defining class (its class-variable row in the Explorer).`,
        );
      } else {
        refuse(
          `'${name}' is not a class variable of ${parsed.className}. For an instance variable or a temporary/argument, use those renames.`,
        );
      }
      return;
    }
  } catch (e: unknown) {
    // Non-fatal: fall through — the rename flow itself reports "no references".
    logInfo(
      `[renameClassVar] membership pre-check failed (falling through): ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const applied = await beginRename({ className: parsed.className, classVarName: name, dict });
  if (applied) await reloadMethodEditor(target.editor);
}
