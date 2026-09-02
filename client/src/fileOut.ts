// Writing GemStone code out as a Topaz `.gs` file the user can keep, diff, or read
// back in with `input` — the same thing Jadeite's "File Out …" menu items produce,
// but landing on the user's OWN machine: the destination comes from VS Code's save
// dialog, so the directory is picked locally rather than on the stone's host (issue
// #539). Nothing here talks to GemStone; the caller supplies a `build` that runs the
// file-out queries.
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { rememberDirectory, rememberedDirectory } from './fileTransferDirectory';

/** Save-dialog file types. `.gs` first — a Topaz file-out is what these commands write. */
export const FILE_OUT_FILTERS: Record<string, string[]> = {
  'GemStone Files': ['gs'],
  'Smalltalk Files': ['st'],
  'All Files': ['*'],
};

/**
 * Fold a GemStone name into something safe to hand a filesystem: anything outside
 * `[A-Za-z0-9._-]` becomes `_`, and runs collapse. Selectors are the reason this
 * exists — `at:put:` is a perfectly good default file name only after the colons go,
 * and a binary selector (`<`, `+`, `,`) is nothing BUT unsafe characters.
 *
 * Dot runs go too, and leading separators are trimmed, so no name can come out as a
 * dotfile or carry a `..` segment. A name with no alphanumeric left over falls back
 * to `fileOut` rather than naming the file after its own punctuation.
 */
export function sanitizeFileNameStem(name: string): string {
  const cleaned = name
    .replace(/\.{2,}/g, '_')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._-]+/, '');
  return /[A-Za-z0-9]/.test(cleaned) ? cleaned : 'fileOut';
}

/** Default file name for a file-out of `name` — sanitized, with the `.gs` suffix
 *  Rowan and Jadeite both use for Topaz files. */
export function fileOutFileName(name: string): string {
  return `${sanitizeFileNameStem(name)}.gs`;
}

/**
 * Join a header and one or more file-out bodies into the text of a `.gs` file.
 *
 * Exactly one header per file, however many bodies there are: Topaz's `fileformat`
 * directive is a property of the file, and repeating it mid-file (once per selected
 * method, say) is not something a reader expects. Empty bodies drop out — a class
 * category whose classes all failed to resolve should not pad the file with blank
 * chunks — and every body is newline-terminated so two chunks can't run together
 * into one unreadable line.
 */
export function composeFileOut(header: string, bodies: string[]): string {
  const chunks = bodies
    .map((b) => b.trimEnd())
    .filter((b) => b.length > 0)
    .map((b) => `${b}\n`);
  return `${header.trimEnd()}\n\n${chunks.join('')}`;
}

/**
 * Ask for a destination, build the file-out, write it, and tell the user where it
 * landed.
 *
 * The dialog comes FIRST and `build` runs only after a destination is chosen, so
 * cancelling costs no round trips — filing out a whole dictionary is one of these
 * calls, and it is not cheap.
 *
 * @returns the file written, or undefined if the user cancelled or the build failed
 * (which is reported to the user, not thrown — every caller is a menu command).
 */
export async function saveFileOut(options: {
  /** Save-dialog title, e.g. `File Out Association`. */
  title: string;
  /** Pre-filled file name, already suffixed (see {@link fileOutFileName}). */
  defaultFileName: string;
  /** What went into the file, for the confirmation message: `2 methods`, `Animals`. */
  label: string;
  /** Produces the file's text. Runs after the destination is chosen; may throw. */
  build: () => string;
  /** Where the last-used directory is remembered, shared with File In (globalState). */
  store?: vscode.Memento;
}): Promise<vscode.Uri | undefined> {
  const uri = await vscode.window.showSaveDialog({
    title: options.title,
    defaultUri: vscode.Uri.file(
      path.join(rememberedDirectory(options.store), options.defaultFileName),
    ),
    filters: FILE_OUT_FILTERS,
  });
  if (!uri) return undefined;

  let text: string;
  try {
    text = options.build();
  } catch (e) {
    void vscode.window.showErrorMessage(
      `File out failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return undefined;
  }

  try {
    fs.writeFileSync(uri.fsPath, text, 'utf8');
  } catch (e) {
    void vscode.window.showErrorMessage(
      `Could not write ${uri.fsPath}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return undefined;
  }

  await rememberDirectory(options.store, path.dirname(uri.fsPath));

  // Not awaited: the command is finished once the file is on disk, and the toast
  // stays up until the user dismisses it.
  void announce(uri, options.label);
  return uri;
}

/** Report where the file landed and open it on request. Offered rather than opened
 *  outright: a dictionary file-out can run to megabytes, and dropping that into an
 *  editor unasked is a worse default than a one-click link. */
async function announce(uri: vscode.Uri, label: string): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    `Filed out ${label} to ${path.basename(uri.fsPath)}.`,
    'Open',
  );
  if (choice === 'Open') await vscode.window.showTextDocument(uri);
}
