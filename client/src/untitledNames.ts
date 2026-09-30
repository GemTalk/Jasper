import * as vscode from 'vscode';

/**
 * `untitled:<base><suffix>`, then `<base> 2<suffix>`, `<base> 3<suffix>`, … —
 * the first whose URI is not in `taken`. A named untitled document keeps its
 * name across window reloads, where an anonymous one comes back as a fresh
 * Untitled-N, so each opener can make as many as the user asks for.
 */
export function nextUntitledUri(base: string, suffix: string, taken: string[]): vscode.Uri {
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${base}${suffix}` : `${base} ${n}${suffix}`;
    const uri = vscode.Uri.from({ scheme: 'untitled', path: name });
    if (!taken.includes(uri.toString())) return uri;
  }
}
