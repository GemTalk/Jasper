/**
 * "Rename Instance Variable…" triggered from the METHOD SOURCE EDITOR (the
 * Refactor… code action / command palette): the user puts the cursor on an
 * instance variable in a gemstone: method editor, and the existing R1 rename flow
 * (input box → checkbox preview panel → apply, no commit) runs for the editor's
 * class — the same flow the Explorer's ivar-row pencil drives.
 *
 * A rename is always reachable from a method editor: a variable DEFINED on the
 * editor's class renames here directly; an INHERITED one is not a dead-end — its
 * defining class is resolved and, after a one-line confirm, the rename runs there
 * (across that class's whole hierarchy), which is where an ivar rename belongs.
 * Only a word that is not a visible instance variable at all is declined (with a
 * pointer to Rename Temporary/Argument) — the mirror image of the temp/arg rename
 * declining in the other direction.
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
import { DefiningClass } from './queries/getDefiningClassOfInstVar';

/** What the shared Explorer rename flow needs to start. */
export interface InstVarRenameTarget {
  className: string;
  ivarName: string;
  dict: number | string;
}

/** Run the rename-instance-variable flow for the identifier at the cursor.
 *  `beginRename` is the Explorer controller's shared flow (input box → preview →
 *  apply); it answers true when the rename was applied, in which case the method
 *  editor is reloaded so it shows the recompiled source. */
export async function renameInstVarAtCursorCommand(
  sessions: SessionManager,
  beginRename: (target: InstVarRenameTarget) => Promise<boolean>,
  position?: vscode.Position,
): Promise<void> {
  logInfo('[renameIvar] invoked');
  const target = resolveMethodEditor(sessions, position, 'an instance variable');
  if (!target) return;
  if (!(await ensureRbSupport(target.session, 'Renaming an instance variable'))) return;

  const word = wordAt(target, 'an instance variable');
  if (!word) return;
  // Save first: the rename recompiles this method server-side and the flow reloads
  // the editor afterwards, which would otherwise discard unsaved edits.
  if (!(await saveIfDirty(target.editor))) return;
  const { parsed, session, dict } = target;
  const name = word.name;

  // Classify the word against the stone: DEFINED here renames in place; INHERITED
  // is retargeted to its defining class (below); anything that is not a visible
  // instance variable at all is declined. A probe-query failure STOPS with a retry
  // message rather than falling through: proceeding against the cursor's class would
  // hand an inherited ivar to the engine on a class that does not declare it, staging
  // a reference rewrite with no matching declaration — a broken method, not just an
  // empty preview.
  let inherited: DefiningClass | undefined;
  try {
    const defined = queries.getDefinedInstVarNames(session, parsed.className, dict);
    if (!defined.includes(name)) {
      const all = queries.getInstVarNames(session, parsed.className, dict);
      if (!all.includes(name)) {
        refuse(
          `'${name}' is not an instance variable of ${parsed.className}. For a temporary or argument, use Rename Temporary/Argument.`,
        );
        return;
      }
      inherited = queries.getDefiningClassOfInstVar(session, parsed.className, name, dict);
      if (!inherited) {
        refuse(
          `'${name}' is inherited by ${parsed.className}, but its defining class could not be resolved — rename it from that class's ivar row in the Explorer.`,
        );
        return;
      }
    }
  } catch (e: unknown) {
    logInfo(
      `[renameIvar] membership pre-check failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    refuse(
      `Couldn't determine where '${name}' is defined — a stone query failed. Try again, or rename it from the class's instance-variable row in the Explorer.`,
    );
    return;
  }

  // An inherited ivar renames on its DEFINING class, across that whole hierarchy.
  // Confirm the retarget first, since the user invoked this from a subclass method
  // and the rename reaches beyond the class they were looking at.
  let renameTarget: InstVarRenameTarget = { className: parsed.className, ivarName: name, dict };
  if (inherited) {
    // dictIndex 0 means the defining class is not bound under its own name, so there
    // is no identity-safe handle to it — resolving `inherited.className` by name in
    // the subclass's dictionary could hit a DIFFERENT class of the same name and
    // rename the wrong one. Stop rather than guess.
    if (inherited.dictIndex <= 0) {
      refuse(
        `'${name}' is defined on ${inherited.className}, which isn't uniquely bound by name — can't safely target it from here. Rename it from that class's instance-variable row in the Explorer.`,
      );
      return;
    }
    const PROCEED = `Rename on ${inherited.className}…`;
    const choice = await vscode.window.showInformationMessage(
      `'${name}' is defined on ${inherited.className}, not ${parsed.className}. Rename it across ${inherited.className} and its subclasses?`,
      PROCEED,
    );
    if (choice !== PROCEED) return;
    renameTarget = {
      className: inherited.className,
      ivarName: name,
      dict: inherited.dictIndex,
    };
  }

  const applied = await beginRename(renameTarget);
  if (applied) await reloadMethodEditor(target.editor);
}
