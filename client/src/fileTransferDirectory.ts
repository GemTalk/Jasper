// Where the last file-out went, or the last file-in came from. File In and File Out
// share one remembered folder deliberately: a user keeps their `.gs` files in one
// place, and filing a class out to it and back in from it should not mean navigating
// twice. It is the equivalent of Jadeite's `JadePresenter lastFilePath`.
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';

// Kept in the extension's globalState (callers pass it in) rather than a module
// variable, so the folder survives a window reload.
export const LAST_DIRECTORY_KEY = 'gemstone.fileInOut.lastDirectory';

/** The directory a file dialog should open in: wherever the last file-in or file-out
 *  went, else the workspace root, else the user's home. A remembered directory that
 *  has since been deleted is ignored rather than opening a dialog on nothing. */
export function rememberedDirectory(store: vscode.Memento | undefined): string {
  const remembered = store?.get<string>(LAST_DIRECTORY_KEY);
  if (remembered && fs.existsSync(remembered)) return remembered;
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
}

/** Remember `directory` as where the next file dialog should open. */
export async function rememberDirectory(
  store: vscode.Memento | undefined,
  directory: string,
): Promise<void> {
  await store?.update(LAST_DIRECTORY_KEY, directory);
}
