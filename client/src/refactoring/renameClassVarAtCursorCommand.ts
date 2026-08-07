/**
 * "Rename Class Variable…" triggered from the METHOD SOURCE EDITOR (the Refactor…
 * code action / command palette): the user puts the cursor on a class variable in
 * a gemstone: method editor, and the existing R4 rename flow (input box →
 * all-or-nothing preview panel → server-side apply, no commit) runs — the same flow
 * the Explorer's class-var-row pencil drives.
 *
 * A rename is always reachable: a class variable DECLARED on the editor's class
 * renames in place (R4 edits that class's classVars: clause); an INHERITED one is
 * not a dead-end — its defining class is resolved and, after a one-line confirm,
 * the rename runs there (across that class's whole hierarchy). Only a word that is
 * not a visible class variable at all is declined, the mirror of the instance-
 * variable rename in renameInstVarAtCursorCommand.
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
import { DefiningClass } from './queries/getDefiningClassOfClassVar';

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

  // Classify the word against the stone: DECLARED here renames in place; INHERITED
  // is retargeted to its defining class (below); anything that is not a visible
  // class variable at all is declined. A query failure is non-fatal — leave
  // `inherited` unset and fall through, letting the rename flow report "no
  // references" rather than blocking on a transient probe error.
  let inherited: DefiningClass | undefined;
  try {
    const defined = queries.getDefinedClassVarNames(session, parsed.className, dict);
    if (!defined.includes(name)) {
      const visible = queries.getVisibleClassVarNames(session, parsed.className, dict);
      if (!visible.includes(name)) {
        refuse(
          `'${name}' is not a class variable of ${parsed.className}. For an instance variable or a temporary/argument, use those renames.`,
        );
        return;
      }
      inherited = queries.getDefiningClassOfClassVar(session, parsed.className, name, dict);
      if (!inherited) {
        refuse(
          `'${name}' is inherited by ${parsed.className}, but its defining class could not be resolved — rename it from that class's class-variable row in the Explorer.`,
        );
        return;
      }
    }
  } catch (e: unknown) {
    logInfo(
      `[renameClassVar] membership pre-check failed (falling through): ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // An inherited class variable renames on its DEFINING class (R4 edits that class's
  // classVars: clause, across its whole hierarchy). Confirm the retarget first,
  // since the user invoked this from a subclass method. Fall back to the editor's
  // dict scope only if the defining class is not bound by its own name.
  let renameTarget: ClassVarRenameTarget = {
    className: parsed.className,
    classVarName: name,
    dict,
  };
  if (inherited) {
    const PROCEED = `Rename on ${inherited.className}…`;
    const choice = await vscode.window.showInformationMessage(
      `'${name}' is defined on ${inherited.className}, not ${parsed.className}. Rename it across ${inherited.className} and its subclasses?`,
      PROCEED,
    );
    if (choice !== PROCEED) return;
    renameTarget = {
      className: inherited.className,
      classVarName: name,
      dict: inherited.dictIndex > 0 ? inherited.dictIndex : dict,
    };
  }

  const applied = await beginRename(renameTarget);
  if (applied) await reloadMethodEditor(target.editor);
}
