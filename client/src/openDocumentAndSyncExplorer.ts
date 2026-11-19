import * as vscode from 'vscode';
import { logWarning } from './gciLog';

/** The Explorer calls an open needs; see ExplorerController for each. */
export interface OpenDocumentExplorer {
  markAttributedOpen(uri: vscode.Uri): void;
  clearAttributedOpen(uri: vscode.Uri): void;
  syncToEditor(uri: vscode.Uri): Promise<void>;
}

/** What `gemstone.openDocument` takes besides the URI; GemStone Search's opens pass these through. */
export interface OpenDocumentOptions {
  viewColumn?: vscode.ViewColumn;
  preserveFocus?: boolean;
  /** false → a regular, persistent editor rather than a preview tab. */
  preview?: boolean;
}

/** Open a gemstone:// document and bring the Explorer to it — the `gemstone.openDocument` command. */
export async function openDocumentAndSyncExplorer(
  explorer: OpenDocumentExplorer,
  uri: vscode.Uri,
  opts?: OpenDocumentOptions,
): Promise<void> {
  // Claim the open: without this the Explorer reads an open of a test method's
  // document as a Testing-view row click and leaves its panes where they were.
  explorer.markAttributedOpen(uri);
  try {
    const before = vscode.window.activeTextEditor;
    const doc = await vscode.workspace.openTextDocument(uri);
    const shown = await vscode.window.showTextDocument(doc, {
      preview: opts?.preview ?? true,
      viewColumn: opts?.viewColumn,
      preserveFocus: opts?.preserveFocus,
    });
    // Re-showing the active editor fires no editor change, so the Explorer's usual sync never
    // runs and it stays wherever the user had browsed to since.
    if (shown === before && !opts?.preserveFocus) {
      // The document is open by now, so a sync that fails (a busy session, say) costs only the
      // Explorer's catching up, not the open the caller asked for.
      await explorer.syncToEditor(uri).catch((e: unknown) => {
        logWarning(
          `The GemStone Explorer could not follow ${uri.toString()}: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
    }
  } finally {
    // A focus-taking open into a different editor fires an editor change that syncToEditor
    // consumes, making this a no-op. But if the open threw or kept focus, the claim would
    // linger and later hijack a genuine Testing-view click on the same method.
    explorer.clearAttributedOpen(uri);
  }
}
