/**
 * "Rename Class…" triggered from the METHOD SOURCE EDITOR: the cursor is on a class
 * reference in the body (e.g. `Path` in `addFirst: (Path root)`), and the existing
 * R3 class-rename flow runs for that class — the same flow the Explorer's class-row
 * pencil drives. Reached through the unified "Rename…" action, which routes here
 * when the token is a class reference rather than a variable or selector.
 *
 * The word is resolved the way the compiler resolves a global in a method: across
 * the whole symbol list, and only when it actually names a Class (a plain global or
 * shared variable such as `Transcript` is declined, since there is no refactoring
 * for those). Renaming a class rewrites references — including in the method being
 * edited — so the editor is reloaded afterwards.
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
} from './renameAtCursorShared';

/** What the shared Explorer class-rename flow needs to start: the class name and
 *  the SymbolList index that binds it (undefined resolves across the whole symbol
 *  list). */
export interface ClassRefRenameTarget {
  className: string;
  dict: number | undefined;
}

/** Run the rename-class flow for the class reference at the cursor. `beginRename`
 *  is the Explorer controller's shared class-rename flow. */
export async function renameClassAtCursorCommand(
  sessions: SessionManager,
  beginRename: (target: ClassRefRenameTarget) => Promise<void>,
  position?: vscode.Position,
): Promise<void> {
  logInfo('[renameClass] invoked from editor');
  const target = resolveMethodEditor(sessions, position, 'a class');
  if (!target) return;
  if (!(await ensureRbSupport(target.session, 'Renaming a class'))) return;

  const word = wordAt(target, 'a class');
  if (!word) return;
  const { session } = target;
  const name = word.name;

  let resolved;
  try {
    resolved = queries.resolveClassReference(session, name);
  } catch (e: unknown) {
    refuse(
      `Couldn't determine whether '${name}' is a class — a stone query failed. Try again in a moment.`,
    );
    logInfo(`[renameClass] resolve failed: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  if (!resolved) {
    refuse(
      `'${name}' isn't a class. (Global and shared variables can't be renamed here; rename classes and class variables from those actions.)`,
    );
    return;
  }

  await beginRename({
    className: resolved.className,
    dict: resolved.dictIndex > 0 ? resolved.dictIndex : undefined,
  });
  // A class rename rewrites references, so the edited method's source may have
  // changed; reload it from the stone (best-effort — a no-op if it did not).
  await reloadMethodEditor(target.editor);
}
