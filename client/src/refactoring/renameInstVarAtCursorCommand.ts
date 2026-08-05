/**
 * "Rename Instance Variable…" triggered from the METHOD SOURCE EDITOR (the
 * Refactor… code action / command palette): the user puts the cursor on an
 * instance variable in a gemstone: method editor, and the existing R1 rename flow
 * (input box → checkbox preview panel → apply, no commit) runs for the editor's
 * class — the same flow the Explorer's ivar-row pencil drives.
 *
 * Simple-but-polite (Eric, 2026-07-21): the Refactor… menu offers the action on
 * any identifier; when the word is NOT an instance variable of this class, a
 * warning toast says what it is instead — inherited (rename belongs to the
 * defining class) or not an ivar at all (use Rename Temporary/Argument) — the
 * mirror image of the temp/arg rename declining in the other direction.
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

  // Simple membership pre-check, the mirror image of the temp/arg decline: only a
  // variable DEFINED on this class proceeds (an inherited one belongs to its
  // defining class; anything else is not an ivar rename at all).
  try {
    const defined = queries.getDefinedInstVarNames(session, parsed.className, dict);
    if (!defined.includes(name)) {
      const all = queries.getInstVarNames(session, parsed.className);
      if (all.includes(name)) {
        refuse(
          `'${name}' is an instance variable INHERITED by ${parsed.className} — rename it on its defining class (its ivar row in the Explorer).`,
        );
      } else {
        refuse(
          `'${name}' is not an instance variable of ${parsed.className}. For a temporary or argument, use Rename Temporary/Argument.`,
        );
      }
      return;
    }
  } catch (e: unknown) {
    // Non-fatal: fall through — the rename flow itself reports "no references".
    logInfo(
      `[renameIvar] membership pre-check failed (falling through): ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const applied = await beginRename({ className: parsed.className, ivarName: name, dict });
  if (applied) await reloadMethodEditor(target.editor);
}
