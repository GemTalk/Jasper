/**
 * The Refactor code actions hosted under VS Code's native "Refactor…" editor menu
 * (`editor.action.refactor`) in a GemStone method editor. That built-in menu item is
 * always present in a text editor and is otherwise empty for GemStone methods; this
 * populates it — the idiomatic home for refactorings — rather than adding separate
 * top-level context-menu entries (which grew too crowded). The whole RB family lives
 * here:
 *   - on a SELECTION: Extract Method, Extract Temporary;
 *   - on an IDENTIFIER at the cursor: Rename Temporary/Argument, Rename Instance
 *     Variable, Rename Class Variable, Inline Method, Inline Temporary;
 *   - always: Rename Method (targets the edited method, or a sent selector at the
 *     cursor).
 * Each action invokes its command, which resolves the target and declines with a
 * reason when it doesn't apply — offered without pre-resolving what the token IS
 * (that needs the stone); simple but polite.
 */
import * as vscode from 'vscode';

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/;

// Sub-kinds of Refactor. VS Code's "Refactor…" menu separates actions into groups
// by the segment after `refactor.`, so tagging each action gives the family clean
// separators (Extract | Inline | Rename | other rewrites) instead of one flat list.
// Actions are emitted grouped by kind (see below) so each group stays contiguous.
const EXTRACT = vscode.CodeActionKind.Refactor.append('extract');
const INLINE = vscode.CodeActionKind.Refactor.append('inline');
const RENAME = vscode.CodeActionKind.Refactor.append('rename');
const REWRITE = vscode.CodeActionKind.Refactor.append('rewrite');

export class RefactorCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.Refactor];

  /**
   * @param refactoringAvailable  whether the selected session's stone has the
   *   refactoring engine installed. Every action here needs it, so when it is
   *   absent (never installed, or uninstalled) the provider offers nothing —
   *   the "Refactor…" menu stays empty rather than listing actions that would
   *   only fail. Mirrors the Explorer menus' `gemstone.rbSupportAvailable` gate.
   */
  constructor(private readonly refactoringAvailable: () => boolean) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    if (!this.refactoringAvailable()) return [];

    const actions: vscode.CodeAction[] = [];
    const action = (
      kind: vscode.CodeActionKind,
      title: string,
      command: string,
      args?: unknown[],
    ): void => {
      const a = new vscode.CodeAction(title, kind);
      a.command = { command, title, arguments: args };
      actions.push(a);
    };
    // Cursor-on-identifier refactorings act on the exact token here (each is passed
    // the position it was offered at); whichever doesn't apply declines with a reason.
    const onIdentifier = document.getWordRangeAtPosition(range.start, IDENTIFIER) !== undefined;

    // Extract group — needs a selection (the code to extract); the commands read the
    // editor selection, so no position argument is passed.
    if (!range.isEmpty) {
      action(EXTRACT, 'Extract Method…', 'gemstone.explorer.extractMethod');
      action(EXTRACT, 'Extract Temporary…', 'gemstone.explorer.extractTemporary');
    }

    // Inline group — on an identifier at the cursor.
    if (onIdentifier) {
      action(INLINE, 'Inline Method…', 'gemstone.explorer.inlineMethod', [range.start]);
      action(INLINE, 'Inline Temporary…', 'gemstone.explorer.inlineTemporary', [range.start]);
    }

    // Rename group — the cursor renames (on an identifier), then "Rename Method…",
    // which targets the edited method (or a sent selector at the position) and so is
    // offered anywhere.
    if (onIdentifier) {
      action(RENAME, 'Rename Temporary/Argument…', 'gemstone.renameTemporary', [range.start]);
      action(RENAME, 'Rename Instance Variable…', 'gemstone.renameInstVarAtCursor', [range.start]);
      action(RENAME, 'Rename Class Variable…', 'gemstone.renameClassVarAtCursor', [range.start]);
    }
    action(RENAME, 'Rename Method…', 'gemstone.renameMethodInEditor', [range.start]);

    // Other rewrites — promote a temp (on an identifier), then "Change Method
    // Signature…", which targets the edited method's own signature and is offered
    // anywhere.
    if (onIdentifier) {
      action(REWRITE, 'Convert Temporary to Instance Variable…', 'gemstone.convertTempToInstVar', [
        range.start,
      ]);
    }
    action(REWRITE, 'Change Method Signature…', 'gemstone.changeMethodSignature', [range.start]);

    return actions;
  }
}
