/**
 * The single "Rename…" entry point in a GemStone method source editor (the
 * Refactor… code action / palette). Rather than making the user pick which rename
 * applies, it figures out what the cursor is on and dispatches to the specific
 * rename — the consolidation asked for in issue #328 (item 2).
 *
 * Classification precedence, resolved against the running stone:
 *   1. A message selector (unary/binary/keyword send) OR the method header →
 *      Rename Method. The LSP's selectorAtPosition answers the selector at a send
 *      or pattern position and null at a variable reference, so this is checked
 *      FIRST — a selector that happens to share a name with an instance/class
 *      variable is never misclassified by the name-based checks below.
 *   2. Otherwise the identifier is a variable reference; classify it in scope
 *      order — temporary/argument (which shadows a variable of the same name),
 *      then instance variable (own or inherited), then class variable — and
 *      dispatch to that rename.
 *   3. Otherwise fall through to Rename Class, which renames the token when it
 *      resolves to a class and otherwise declines (a plain global/shared variable
 *      or pseudo-variable has no rename here).
 *
 * Dispatch runs the existing per-kind command via executeCommand, so each rename's
 * own flow — including the inherited-ivar retarget and every preview/apply path —
 * is reused unchanged.
 */
import * as vscode from 'vscode';
import { SessionManager } from '../sessionManager';
import * as queries from '../browserQueries';
import { logInfo } from '../gciLog';
import { resolveMethodEditor, wordAt, refuse, saveIfDirty } from './renameAtCursorShared';
import { SelectorAtPosition } from './renameMethodAtCursorCommand';

/** Resolve the identifier/selector at the cursor and run the rename that applies.
 *  `selectorAt` is the LSP-backed selector resolver; `position` is the code-action
 *  anchor, else the editor cursor. */
export async function renameAtCursorCommand(
  sessions: SessionManager,
  selectorAt: SelectorAtPosition,
  position?: vscode.Position,
): Promise<void> {
  logInfo('[rename] invoked');
  const target = resolveMethodEditor(sessions, position, 'a name');
  if (!target) return;
  const { editor, parsed, session, dict, at } = target;

  // A selector (send or the method header) resolves via the LSP; a variable
  // reference resolves to null. Checked first so a selector sharing a name with an
  // ivar/classvar is dispatched as a method rename, not by the name-based checks.
  let sel: string | null = null;
  try {
    sel = await selectorAt(editor.document, at);
  } catch {
    // LSP unavailable: fall through to variable classification. If that can't place
    // the token either, we decline with a generic message rather than guess.
    logInfo('[rename] selectorAtPosition unavailable; treating the cursor as a variable position');
  }
  if (sel) {
    await vscode.commands.executeCommand('gemstone.renameMethodInEditor', at);
    return;
  }

  const word = wordAt(target, 'a name');
  if (!word) return; // wordAt already refused with a helpful message

  // The temporary check reads the STORED source at an offset, so save first (each
  // dispatched command saves too; this keeps the offset aligned for the probe).
  if (!(await saveIfDirty(editor))) return;
  const name = word.name;
  try {
    const tempReason = (
      await queries.renameTemporaryDeclineReason(
        session,
        parsed.className,
        parsed.selector,
        parsed.isMeta,
        name,
        word.offset,
        dict,
      )
    ).trim();
    if (tempReason.length === 0) {
      await vscode.commands.executeCommand('gemstone.renameTemporary', at);
      return;
    }

    if (
      queries.getDefinedInstVarNames(session, parsed.className, dict).includes(name) ||
      queries.getInstVarNames(session, parsed.className).includes(name)
    ) {
      await vscode.commands.executeCommand('gemstone.renameInstVarAtCursor', at);
      return;
    }

    if (
      queries.getDefinedClassVarNames(session, parsed.className, dict).includes(name) ||
      queries.getVisibleClassVarNames(session, parsed.className, dict).includes(name)
    ) {
      await vscode.commands.executeCommand('gemstone.renameClassVarAtCursor', at);
      return;
    }
  } catch (e: unknown) {
    logInfo(`[rename] classification failed: ${e instanceof Error ? e.message : String(e)}`);
    refuse(
      `Couldn't determine what '${name}' is — a stone query failed. Try again, or use a specific Rename action.`,
    );
    return;
  }

  // Not a temporary or a variable of the class: fall through to Rename Class, which
  // renames the token if it resolves to a class and declines otherwise (a plain
  // global/shared variable or pseudo-variable has no rename here).
  await vscode.commands.executeCommand('gemstone.renameClassAtCursor', at);
}
