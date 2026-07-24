import * as vscode from 'vscode';

// A grayed-out "empty variable side" header in the Explorer's Classes pane. When a
// class defines only instance variables (or only class variables) we still show
// both the "instance variables" and "class variables" headers, graying the empty
// one. VS Code has no direct API to color a tree-item label, so — like the Rowan
// tree (see rowanDecorations.ts) — the empty row carries a synthetic resourceUri
// under this scheme and a FileDecorationProvider answers a muted color for it. Only
// empty sides get a URI, so any URI of this scheme is an empty side to gray.
export const EXPLORER_EMPTY_VAR_SCHEME = 'jasper-explorer-emptyvar';

/** URI marking an empty variable-side header (instance or class) for graying. */
export function emptyVarSideUri(className: string, isMeta: boolean): vscode.Uri {
  return vscode.Uri.from({
    scheme: EXPLORER_EMPTY_VAR_SCHEME,
    path: `/${className}/${isMeta ? 'class' : 'instance'}`,
  });
}

export class ExplorerEmptyVarDecorationProvider implements vscode.FileDecorationProvider {
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== EXPLORER_EMPTY_VAR_SCHEME) return undefined;
    return {
      color: new vscode.ThemeColor('disabledForeground'),
      tooltip: 'No variables defined',
      propagate: false,
    };
  }
}
