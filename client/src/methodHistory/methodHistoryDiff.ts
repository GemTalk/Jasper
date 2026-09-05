/**
 * A tiny read-only content provider backing the method-history "Diff ⇄ current"
 * action, so a chosen version can be shown side-by-side against the current one in
 * a normal editor diff (vscode.diff). The version sources live only in the panel's
 * memory; this stashes the two texts under `gemstone-method-history:` URIs the
 * provider then serves. Register once at activation (registerMethodHistoryDiff),
 * then call openMethodVersionDiff from the panel's diff handler.
 */
import * as vscode from 'vscode';

const SCHEME = 'gemstone-method-history';

// The text each virtual document serves, keyed by its URI path. Bounded: only the
// two documents of the most-recent diff are kept, so this never accumulates.
const contents = new Map<string, string>();
let seq = 0;

const provider: vscode.TextDocumentContentProvider = {
  provideTextDocumentContent(uri: vscode.Uri): string {
    return contents.get(uri.path) ?? '';
  },
};

/** Register the provider. Call once from extension activation. */
export function registerMethodHistoryDiff(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
  );
}

function put(label: string, text: string): vscode.Uri {
  // A fresh, unique path each call so VS Code never serves a cached body, plus a
  // human-readable suffix so the diff tabs are labelled. `query` carries a stable
  // extension hint so Smalltalk syntax highlighting kicks in.
  seq += 1;
  const path = `/${seq}/${label}`;
  contents.set(path, text);
  // Keep the map from growing without bound: retain only the last few documents.
  if (contents.size > 8) {
    const oldest = contents.keys().next().value;
    if (oldest !== undefined) contents.delete(oldest);
  }
  return vscode.Uri.from({ scheme: SCHEME, path });
}

/** Open a side-by-side diff of one historical version against the current one. */
export async function openMethodVersionDiff(
  methodLabel: string,
  versionLabel: string,
  versionSource: string,
  currentSource: string,
): Promise<void> {
  const left = put(`${versionLabel}.st`, versionSource);
  const right = put('current.st', currentSource);
  await vscode.commands.executeCommand(
    'vscode.diff',
    left,
    right,
    `${methodLabel}: ${versionLabel} ⇄ current`,
    { preview: true },
  );
}
