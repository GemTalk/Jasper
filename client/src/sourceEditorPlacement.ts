import * as vscode from 'vscode';
import { tabInputUri } from './gemstoneFileSystemProvider';

// The `gemstone://` method-source editor is shared: both the old System Browser
// and the new GemStone Explorer open the same kind of documents into the editor
// area. Placement, however, must NOT be shared — each browser wants its source
// in its own region (the System Browser below its webview columns; the Explorer
// in one navigation pane + one side pane). When both scan the whole window for
// "any session editor", they steal each other's groups: click a method in the
// System Browser after using the Explorer and the source lands in the Explorer's
// column instead of below the browser.
//
// SourceEditorPlacement disentangles that. Each browser holds its own instance
// and only ever reuses a group that currently hosts an editor IT opened (every
// open is recorded via remember()). It never adopts a foreign browser's group.

export class SourceEditorPlacement {
  private readonly owned = new Set<string>();

  // URI (string) of the one reusable, non-preview source tab this browser keeps
  // for single-click navigation, if any. The next single-click closes it instead
  // of piling up tabs. We can't use a real preview tab for this — opening one
  // scrolls the navigator tree (see openGemstoneDocument) — so we mimic its
  // "single throwaway editor" behavior ourselves.
  reusableTab?: string;

  // The view-column the reusable tab was actually opened into. Recorded from the
  // opened editor (not inferred from the URI), because the SAME gemstone:// method
  // URI can be open in another browser's group too — so when we close the outgoing
  // transient we must target the column WE put it in, never a foreign copy.
  reusableColumn?: number;

  // `createHome` builds this browser's source region from scratch (e.g. a group
  // below its webview) and returns the column to open into. Required only when
  // homeColumn() is used.
  constructor(private readonly createHome?: () => Promise<vscode.ViewColumn>) {}

  /** Record a document this placement opened, so its group can be re-found. */
  remember(uri: vscode.Uri | string): void {
    this.owned.add(typeof uri === 'string' ? uri : uri.toString());
  }

  /** The view-columns currently holding one of our editors, with tab counts. */
  private ownedColumns(): Map<number, number> {
    const counts = new Map<number, number>();
    for (const group of vscode.window.tabGroups.all) {
      if (!group.viewColumn) continue;
      let n = 0;
      for (const tab of group.tabs) {
        const uri = tabInputUri(tab)?.toString();
        if (uri && this.owned.has(uri)) n++;
      }
      if (n > 0) counts.set(group.viewColumn, n);
    }
    return counts;
  }

  /**
   * A single "home" region for this browser: reuse the group that already holds
   * our editors (leftmost, for determinism), else create one via `createHome`.
   */
  async homeColumn(): Promise<vscode.ViewColumn> {
    const owned = this.ownedColumns();
    if (owned.size > 0) return [...owned.keys()].sort((a, b) => a - b)[0];
    if (!this.createHome)
      throw new Error('SourceEditorPlacement.homeColumn needs a createHome strategy');
    return this.createHome();
  }

  /**
   * The one editor group that holds this browser's source editors — the transient
   * tab and every pinned tab live together here, so they read as one row of tabs.
   * Undefined until the first open, when the caller uses the active group.
   */
  sourceColumn(): number | undefined {
    for (const group of vscode.window.tabGroups.all) {
      if (!group.viewColumn) continue;
      const holdsOurs = group.tabs.some((tab) => {
        const uri = tabInputUri(tab)?.toString();
        return uri !== undefined && this.owned.has(uri);
      });
      if (holdsOurs) return group.viewColumn;
    }
    return undefined;
  }
}
