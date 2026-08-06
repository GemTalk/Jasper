import * as vscode from 'vscode';
import { parseUri, listOpenGemstoneTabs } from './gemstoneFileSystemProvider';
import { classifyGemstoneUri, OpenEditorKind } from './explorerOpenEditorsLabel';

// The Open Editors pane: a live mirror of the currently-open gemstone:// source
// editors, shown as the FIRST (top) pane of the GemStone Explorer container.
// There is no pinning or persistence — a row appears when its editor opens and
// disappears when it closes. Entries are split into two groups: class definition
// editors ("Classes") and method source editors ("Methods"). Clicking a row
// focuses that editor. When no gemstone editors are open the pane shows no rows.
//
// The view is hidden entirely when no gemstone editors are open: its `when` is
// `gemstone.explorerActive && gemstone.explorerHasOpenEditors`, and we drive the
// `explorerHasOpenEditors` context key from the open-tab count (initially and on
// every tab change). We use `registerTreeDataProvider` (NOT `createTreeView`)
// because the latter throws "No view is registered with id: …" while the view's
// `when` is false, whereas `registerTreeDataProvider` simply binds the provider
// and tolerates the view being currently hidden — so an empty pane never shows.

const VIEW_ID = 'gemstoneExplorerOpenEditors';
const REVEAL_COMMAND = 'gemstone.explorer.revealOpenEditor';
const CLOSE_COMMAND = 'gemstone.explorer.closeOpenEditor';
const CLOSE_ALL_COMMAND = 'gemstone.explorer.closeAllOpenEditors';
const ITEM_CONTEXT = 'explorerOpenEditorItem';

// Group headers, in display order. Only non-empty groups are shown.
const GROUPS: { kind: OpenEditorKind; label: string; icon: string }[] = [
  { kind: 'class', label: 'Classes', icon: 'symbol-class' },
  { kind: 'comment', label: 'Comments', icon: 'book' },
  { kind: 'method', label: 'Methods', icon: 'symbol-method' },
];

class GroupItem extends vscode.TreeItem {
  constructor(
    readonly kind: OpenEditorKind,
    label: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `group:${kind}`;
    this.contextValue = 'explorerOpenEditorGroup';
  }
}

class EditorItem extends vscode.TreeItem {
  constructor(
    label: string,
    readonly uri: vscode.Uri,
    icon: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = uri.toString();
    this.resourceUri = uri;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.tooltip = uri.toString();
    this.contextValue = ITEM_CONTEXT;
    this.command = { command: REVEAL_COMMAND, title: 'Reveal Open Editor', arguments: [uri] };
  }
}

interface Entry {
  kind: OpenEditorKind;
  label: string;
  uri: vscode.Uri;
}

// Every open gemstone:// source tab, classified and de-duplicated by URI (the
// same document split across editor groups yields one row).
function openEntries(): Entry[] {
  const seen = new Set<string>();
  const out: Entry[] = [];
  for (const { uri } of listOpenGemstoneTabs()) {
    const key = uri.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    let entry: { kind: OpenEditorKind; label: string } | undefined;
    try {
      entry = classifyGemstoneUri(parseUri(uri));
    } catch {
      entry = undefined;
    } // unrecognized URI shape → skip
    if (entry) out.push({ ...entry, uri });
  }
  return out;
}

class OpenEditorsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    const entries = openEntries();
    if (!element) {
      // Top level: one header per non-empty group (Classes, Comments, Methods).
      return GROUPS.filter((g) => entries.some((e) => e.kind === g.kind)).map(
        (g) => new GroupItem(g.kind, g.label),
      );
    }
    if (element instanceof GroupItem) {
      const icon = GROUPS.find((g) => g.kind === element.kind)!.icon;
      return entries
        .filter((e) => e.kind === element.kind)
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((e) => new EditorItem(e.label, e.uri, icon));
    }
    return [];
  }
}

// A gemstone:// URI is "dirty" when any open tab for it has unsaved edits.
function isDirtyUri(uri: vscode.Uri): boolean {
  const key = uri.toString();
  return listOpenGemstoneTabs().some((t) => t.uri.toString() === key && t.tab.isDirty);
}

// Marks unsaved rows in the Open Editors pane with a small dot, mirroring the
// unsaved-dot VS Code paints on the editor tab. Uses the same FileDecoration
// mechanism the git/SCM views use for row badges (each row carries a
// resourceUri). No color, so it reads as a neutral dot and doesn't tint the
// label. Scoped to gemstone:// so it never touches other resources.
export class DirtyDecorationProvider implements vscode.FileDecorationProvider {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  // Dirty state isn't encoded in the URI, so VS Code caches per-URI decorations
  // until we tell it they may have changed. Fire only the open gemstone source
  // URIs rather than `undefined` (which would invalidate every decoration in
  // the workbench, git badges included) on each tab change.
  refresh(): void {
    this._onDidChange.fire(listOpenGemstoneTabs().map((t) => t.uri));
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== 'gemstone') return undefined;
    if (!isDirtyUri(uri)) return undefined;
    return { badge: '●', tooltip: 'Unsaved changes', propagate: false };
  }
}

// Close the open editor tab(s) for one URI (the same document may be split
// across editor groups).
async function closeEditor(uri: vscode.Uri): Promise<void> {
  const key = uri.toString();
  const tabs = listOpenGemstoneTabs()
    .filter((t) => t.uri.toString() === key)
    .map((t) => t.tab);
  if (tabs.length) await vscode.window.tabGroups.close(tabs);
}

// Close every open gemstone:// source editor at once.
async function closeAllEditors(): Promise<void> {
  const tabs = listOpenGemstoneTabs().map((t) => t.tab);
  if (tabs.length) await vscode.window.tabGroups.close(tabs);
}

// Keep the `explorerHasOpenEditors` context key in sync with whether any
// gemstone:// source editor is open, so the view's `when` hides an empty pane.
function syncHasOpenEditorsContext(): void {
  void vscode.commands.executeCommand(
    'setContext',
    'gemstone.explorerHasOpenEditors',
    openEntries().length > 0,
  );
}

export function registerExplorerOpenEditors(context: vscode.ExtensionContext): void {
  const provider = new OpenEditorsProvider();
  const decorations = new DirtyDecorationProvider();
  syncHasOpenEditorsContext();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(VIEW_ID, provider),
    vscode.window.registerFileDecorationProvider(decorations),
    // A tab opening, closing, or changing its dirty state rebuilds the pane's
    // rows, refreshes the unsaved-dot decorations, and re-evaluates whether the
    // pane should be shown at all.
    vscode.window.tabGroups.onDidChangeTabs(() => {
      provider.refresh();
      decorations.refresh();
      syncHasOpenEditorsContext();
    }),
    vscode.commands.registerCommand(REVEAL_COMMAND, (uri?: vscode.Uri) => {
      if (uri instanceof vscode.Uri) {
        void vscode.window.showTextDocument(uri, { preview: false, preserveFocus: false });
      }
    }),
    // Row inline close button — the argument is the clicked EditorItem.
    vscode.commands.registerCommand(CLOSE_COMMAND, (item?: { uri?: vscode.Uri }) => {
      if (item?.uri instanceof vscode.Uri) void closeEditor(item.uri);
    }),
    // View-title "Close All Editors".
    vscode.commands.registerCommand(CLOSE_ALL_COMMAND, () => void closeAllEditors()),
  );
}
