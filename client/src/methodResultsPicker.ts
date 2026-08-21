/**
 * The one place a list of found methods is offered to the user and opened: the Senders /
 * Implementors / References commands, the method-source search, and the safe-delete
 * confirmation's "Show References…" all show the same type-to-filter list, and picking a
 * row navigates an open System Browser for that session (which updates all five columns)
 * or, when none is open, opens the method document directly.
 */
import * as vscode from 'vscode';
import { MethodSearchResult } from './queries/methodSearch';
import { SystemBrowser } from './systemBrowser';
import { buildMethodUri } from './gemstoneFileSystemProvider';

/** How a found method reads in a list or a sentence: `Account class >> #reset`. */
export function describeMethodResult(result: MethodSearchResult): string {
  return `${result.className}${result.isMeta ? ' class' : ''} >> #${result.selector}`;
}

/** Show the results as a picker and open whichever the user chooses. An empty list says
 *  so and opens nothing.
 *
 *  Answers whether the user actually opened one. Callers that offer the list as a detour
 *  from something else — the safe-delete confirmation — need to tell "went and looked at a
 *  method" apart from "closed the list again", because only the first means the user has
 *  moved on to something other than the thing they were being asked about. */
export async function showMethodResults(
  sessionId: number,
  results: MethodSearchResult[],
  title: string,
): Promise<boolean> {
  if (results.length === 0) {
    vscode.window.showInformationMessage(`${title}: no results found.`);
    return false;
  }

  const items = results.map((r) => ({
    label: describeMethodResult(r),
    description: r.category,
    detail: r.dictName,
    result: r,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `${results.length} method${results.length === 1 ? '' : 's'} found`,
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!picked) return false;

  const r = picked.result;
  if (!SystemBrowser.navigateTo(sessionId, r)) {
    const uri = buildMethodUri({ kind: 'method', sessionId, ...r, environmentId: 0 });
    vscode.commands.executeCommand('gemstone.openDocument', uri);
  }
  return true;
}
