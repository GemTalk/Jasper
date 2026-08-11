import { URI as Uri } from 'vscode-uri';

/**
 * Mirrors `vscode.Uri#fsPath`'s platform-dependent output, for building the
 * "expected" side of an assertion against a path that came from a
 * `vscode.Uri`'s `fsPath` getter rather than from `path.join`.
 *
 * @remarks
 * `Uri#fsPath` is a separate implementation from `path.join`. Both swap `/`
 * for `\` on Windows, but they are not interchangeable in general:
 * `fsPath` lowercases a leading drive letter and treats a leading `//` as
 * a network-share authority, neither of which `path.join`/`normalize`
 * does. Asserting against `path.join`'s output instead of this helper
 * would happen to match for simple inputs, recreating the same "two
 * different functions, hope they agree" risk this helper exists to
 * eliminate — call the exact getter production reads, not a lookalike, so
 * expected tracks actual by construction, not by luck.
 *
 * @param rawPath - A filesystem path, in either separator style, passed to
 * `vscode.Uri.file(...)` when building the mocked value.
 * @returns The value `.fsPath` returns for that URI on this platform.
 */
export function uriFsPath(rawPath: string): string {
  return Uri.file(rawPath).fsPath;
}
