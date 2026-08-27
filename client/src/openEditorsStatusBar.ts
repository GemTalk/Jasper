import * as vscode from 'vscode';
import { listOpenGemstoneTabs } from './gemstoneFileSystemProvider';

// A status-bar "Close All GemStone Editors" button. It replaces the former Open
// Editors Explorer pane: the open editors are already visible as editor tabs, so
// the pane's only unique value was one-click "close everything" — which a
// status-bar item preserves without stealing a pane's worth of height from the
// Explorer. The item shows a live count and closes every open gemstone:// source
// editor on click; it hides itself when nothing is open. The count is expected to
// grow beyond source editors as inspectors/debuggers join it, which is exactly
// where an always-visible tally earns its place over a tab strip.

const CLOSE_ALL_COMMAND = 'gemstone.explorer.closeAllOpenEditors';

// Distinct open gemstone:// source URIs (one document split across editor groups
// counts once), matching what "close all" actually closes.
function openEditorUris(): vscode.Uri[] {
  const seen = new Set<string>();
  const out: vscode.Uri[] = [];
  for (const { uri } of listOpenGemstoneTabs()) {
    const key = uri.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(uri);
  }
  return out;
}

// Close every open gemstone:// source editor at once (all tabs, across groups).
async function closeAllEditors(): Promise<void> {
  const tabs = listOpenGemstoneTabs().map((t) => t.tab);
  if (tabs.length) await vscode.window.tabGroups.close(tabs);
}

export function registerOpenEditorsStatusBar(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  item.command = CLOSE_ALL_COMMAND;

  const refresh = () => {
    const count = openEditorUris().length;
    if (count === 0) {
      item.hide();
      return;
    }
    item.text = `$(close-all) Close ${count} GemStone editor${count === 1 ? '' : 's'}`;
    item.tooltip = 'Close all open GemStone editors';
    item.show();
  };
  refresh();

  context.subscriptions.push(
    item,
    vscode.window.tabGroups.onDidChangeTabs(refresh),
    vscode.commands.registerCommand(CLOSE_ALL_COMMAND, () => void closeAllEditors()),
  );
}
