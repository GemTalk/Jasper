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

export class RefactorCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.Refactor];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const action = (title: string, command: string, args?: unknown[]): vscode.CodeAction => {
      const a = new vscode.CodeAction(title, vscode.CodeActionKind.Refactor);
      a.command = { command, title, arguments: args };
      return a;
    };

    // Extractions need a selection (the code to extract); the commands read the
    // editor selection, so no position argument is passed.
    if (!range.isEmpty) {
      actions.push(action('Extract Method…', 'gemstone.explorer.extractMethod'));
      actions.push(action('Extract Temporary…', 'gemstone.explorer.extractTemporary'));
    }

    // Cursor-on-identifier refactorings. Each is passed the exact position the action
    // was offered at, so it acts on the token here rather than wherever the editor
    // selection happens to be. Whichever doesn't apply declines with a reason.
    if (document.getWordRangeAtPosition(range.start, IDENTIFIER)) {
      actions.push(action('Rename Temporary/Argument…', 'gemstone.renameTemporary', [range.start]));
      actions.push(
        action('Rename Instance Variable…', 'gemstone.renameInstVarAtCursor', [range.start]),
      );
      actions.push(
        action('Rename Class Variable…', 'gemstone.renameClassVarAtCursor', [range.start]),
      );
      actions.push(action('Inline Method…', 'gemstone.explorer.inlineMethod', [range.start]));
      actions.push(action('Inline Temporary…', 'gemstone.explorer.inlineTemporary', [range.start]));
    }

    // "Rename Method…" targets the method being edited (or a sent selector at the
    // position), so it is offered anywhere in the editor.
    actions.push(action('Rename Method…', 'gemstone.renameMethodInEditor', [range.start]));
    return actions;
  }
}
