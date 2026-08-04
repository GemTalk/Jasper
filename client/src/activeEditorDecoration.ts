import * as vscode from 'vscode';

// Tints the tree row whose gemstone:// source is the CURRENTLY ACTIVE editor —
// the matching method in the Methods pane and the matching row in the Open Editors
// pane — so you can see at a glance which method/class the front editor is. A
// tree's own selection goes muted grey once focus moves into the editor, leaving no
// strong link back to the row; this decoration is focus-independent.
//
// Colour only (no badge), so it composes with the unsaved-changes dot
// (DirtyDecorationProvider) rather than competing for the single badge slot. Uses
// the same FileDecoration mechanism the git/SCM views use for row badges (each row
// carries a resourceUri).
export class ActiveEditorDecorationProvider implements vscode.FileDecorationProvider {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;
  private active: vscode.Uri | undefined;

  // Which gemstone:// editor is active isn't encoded in any URI, so VS Code caches
  // per-URI decorations until told they may have changed. Fire only the outgoing
  // and incoming URIs (never `undefined`, which would invalidate every decoration
  // in the workbench, git badges included).
  setActiveEditor(uri: vscode.Uri | undefined): void {
    const next = uri && uri.scheme === 'gemstone' ? uri : undefined;
    if (next?.toString() === this.active?.toString()) return;
    const changed: vscode.Uri[] = [];
    if (this.active) changed.push(this.active);
    if (next) changed.push(next);
    this.active = next;
    if (changed.length) this._onDidChange.fire(changed);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== 'gemstone' || this.active === undefined) return undefined;
    if (uri.toString() !== this.active.toString()) return undefined;
    return {
      color: new vscode.ThemeColor('list.highlightForeground'),
      tooltip: 'Shown in the active editor',
      propagate: false,
    };
  }
}
