/**
 * The single "Rename…" entry point in a GemStone method source editor (the
 * Refactor… code action / palette). Rather than making the user pick which rename
 * applies, it figures out what the cursor is on and dispatches to the specific
 * rename — the consolidation asked for in issue #328 (item 2).
 *
 * Classification precedence, resolved against the running stone:
 *   0. Not on an identifier (whitespace, a binary selector, punctuation) → Rename
 *      Method, which resolves a sent selector at the cursor or the edited method.
 *   1. A temporary or argument at that exact offset → Rename Temporary/Argument.
 *      This is checked FIRST because it is OFFSET-based (position-accurate): a
 *      method-pattern argument (e.g. `aKey` in `foo: aKey`) is a renamable argument,
 *      but the AST-based selector probe misreads it as a unary selector — so the
 *      offset probe must win for it to rename the argument, not the method.
 *   2. A message selector (unary/binary/keyword send) or the method header, per the
 *      LSP → Rename Method. Checked before the name-based ivar/classvar tests so a
 *      selector sharing a name with a variable is never misclassified.
 *   3. An instance variable (own or inherited) → Rename Instance Variable.
 *   4. A class variable (own or inherited) → Rename Class Variable.
 *   5. Otherwise → Rename Class, which renames the token when it resolves to a class
 *      and otherwise declines (a plain global/shared or pseudo-variable).
 *
 * Dispatch runs the existing per-kind command via executeCommand, so each rename's
 * own flow — including the inherited-ivar/classvar retarget and every preview/apply
 * path — is reused unchanged.
 */
import * as vscode from 'vscode';
import { SessionManager } from '../sessionManager';
import * as queries from '../browserQueries';
import { logInfo } from '../gciLog';
import {
  resolveMethodEditor,
  wordAt,
  refuse,
  saveIfDirty,
  ensureRbSupport,
} from './renameAtCursorShared';
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
  // Gate up front: classification calls an engine-backed query
  // (renameTemporaryDeclineReason references GsRenameTemporaryRefactoring), and
  // every rename this dispatches to needs the engine anyway — so on a stone without
  // it, offer to install rather than failing classification with a cryptic message.
  if (!(await ensureRbSupport(target.session, 'Renaming'))) return;
  const { editor, parsed, session, dict, at } = target;

  // Not on an identifier (whitespace, a binary selector, punctuation): let Rename
  // Method resolve it — a sent binary selector at the cursor, or the edited method.
  // Silent: this is a supported route to Rename Method, not an error, so wordAt must
  // not flash a "not a variable" warning before we fall through.
  const word = wordAt(target, 'a name', { silent: true });
  if (!word) {
    await vscode.commands.executeCommand('gemstone.renameMethodInEditor', at);
    return;
  }

  // The temporary probe reads the STORED source at an offset, so save first (each
  // dispatched command saves too; this keeps the offset aligned for the probe).
  if (!(await saveIfDirty(editor))) return;
  const name = word.name;

  // Classify the word against the stone and route to the matching rename. Each probe
  // is guarded on its own: a failure makes that ONE classification inconclusive and we
  // move on — a later probe (or the LSP selector) may still classify the word
  // definitively, so a probe hiccup must never block a path that didn't need it (e.g.
  // a method rename must not be refused because the TEMPORARY probe failed). Only when
  // every path is exhausted AND a probe couldn't run do we refuse: defaulting to "it's
  // a class" then could silently rename the wrong kind of thing.

  // 1. Temporary/argument FIRST — offset-based, so a method-pattern argument or a body
  //    temp is renamed as a variable rather than mistaken for a selector by the
  //    AST-based probe below. `undefined` = the probe could not run.
  let tempReason: string | undefined;
  try {
    tempReason = (
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
  } catch (e: unknown) {
    logInfo(`[rename] temporary probe failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (tempReason === '') {
    await vscode.commands.executeCommand('gemstone.renameTemporary', at);
    return;
  }

  // 2. A selector (send or the method header) resolves via the LSP; a variable
  //    reference resolves to null. Checked before the name-based tests so a selector
  //    sharing a name with an ivar/classvar becomes a method rename.
  let sel: string | null = null;
  try {
    sel = await selectorAt(editor.document, at);
  } catch {
    logInfo('[rename] selectorAtPosition unavailable; continuing with variable classification');
  }
  if (sel) {
    await vscode.commands.executeCommand('gemstone.renameMethodInEditor', at);
    return;
  }

  // 3/4. `getInstVarNames` (allInstVarNames) and `getVisibleClassVarNames` already
  //      include the inherited ones — the retarget lives in each dispatched command.
  //      `undefined` = that probe could not run.
  let ivarNames: string[] | undefined;
  try {
    ivarNames = queries.getInstVarNames(session, parsed.className, dict);
  } catch (e: unknown) {
    logInfo(
      `[rename] instance-variable probe failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (ivarNames?.includes(name)) {
    await vscode.commands.executeCommand('gemstone.renameInstVarAtCursor', at);
    return;
  }
  let classVarNames: string[] | undefined;
  try {
    classVarNames = queries.getVisibleClassVarNames(session, parsed.className, dict);
  } catch (e: unknown) {
    logInfo(`[rename] class-variable probe failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (classVarNames?.includes(name)) {
    await vscode.commands.executeCommand('gemstone.renameClassVarAtCursor', at);
    return;
  }

  // 5. Nothing matched. If a probe couldn't run, the word might be a temporary or a
  //    variable we simply failed to see — so we can't safely treat it as a class.
  //    Refuse with a specific reason (what failed, what to do) rather than silently
  //    misrouting to Rename Class.
  if (tempReason === undefined || ivarNames === undefined || classVarNames === undefined) {
    refuse(
      `Couldn't tell what '${name}' is — a stone query failed while checking whether it's a ` +
        `temporary, an instance variable, or a class variable. Try again in a moment, or pick a ` +
        `specific action from the Refactor menu (Rename Method / Instance Variable / Class Variable / Class).`,
    );
    return;
  }

  // Not a temporary, selector, or variable of the class — treat it as a class
  // reference: Rename Class renames the token if it resolves to a class, declines if not.
  await vscode.commands.executeCommand('gemstone.renameClassAtCursor', at);
}
