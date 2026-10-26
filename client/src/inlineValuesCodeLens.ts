import * as vscode from 'vscode';
import { DebuggerPanel } from './debugger/debuggerPanel';

/**
 * A one-line CodeLens at the top of an Enhanced Debugger source pane that toggles
 * the inline-value overlay (#5) — "Inline values: on/off". Living in the document
 * itself (rather than the editor title bar) keeps the control visibly attached to
 * the source pane: it appears when a debugger opens a source doc, flips when the
 * overlay is toggled, and disappears when the pane closes — driven by
 * `DebuggerPanel.refreshSourceCodeLenses()`.
 *
 * Registered for both source schemes the debugger uses — the editable `gemstone://`
 * method scheme and the read-only `gemstone-debug` doit scheme — but it emits a
 * lens ONLY for URIs a live debugger is currently showing (`isLiveSourceUri`), so
 * an ordinary System Browser method editor (also `gemstone://`) never gets one.
 */
export class InlineValuesCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  /** Re-emit lenses (toggle flipped / pane opened or closed / frame changed). */
  refresh(): void {
    this._onDidChange.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const uri = document.uri.toString();
    if (!DebuggerPanel.isLiveSourceUri(uri)) return [];
    const range = new vscode.Range(0, 0, 0, 0);
    const on = DebuggerPanel.isInlineValuesEnabledFor(uri);
    const lenses = [
      new vscode.CodeLens(range, {
        title: on ? '$(eye) Inline values: on' : '$(eye-closed) Inline values: off',
        tooltip: 'Show each in-scope variable’s value inline in this source pane',
        command: 'gemstone.toggleInlineValues',
        arguments: [uri],
      }),
    ];
    // The mode toggle only makes sense while the overlay is on.
    if (on) {
      const perLine = DebuggerPanel.isInlineValuesPerLineFor(uri);
      lenses.push(
        new vscode.CodeLens(range, {
          title: perLine ? '$(list-ordered) Every line: on' : '$(list-ordered) Every line: off',
          tooltip:
            'On: show a variable on every line that references it. Off: only at its first use.',
          command: 'gemstone.toggleInlineValuesPerLine',
          arguments: [uri],
        }),
      );
    }
    return lenses;
  }
}
