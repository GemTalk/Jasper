/**
 * The one place a list of found methods is offered to the user and opened: the Senders /
 * Implementors / References commands, the method-source search, and the safe-delete
 * confirmation's "Show References…" all show the same type-to-filter list, and picking a
 * row navigates an open System Browser for that session (which updates all five columns)
 * or, when none is open, opens the method document directly.
 *
 * A list of exactly one skips the list and goes straight to the method, saying in a toast
 * that there was only one — a one-row picker costs a click and tells you nothing the toast
 * cannot. The toast is what keeps that honest: jumping silently would leave you unsure
 * whether the search found one or gave up.
 */
import * as vscode from 'vscode';
import { MethodSearchResult } from './queries/methodSearch';
import { SystemBrowser } from './systemBrowser';
import { buildMethodUri } from './gemstoneFileSystemProvider';

/**
 * How a method reads in a list or a sentence: `Account class >> #reset`.
 *
 * Takes only the three parts of the name so it serves anything that names a
 * method — a search result, a method URI's coordinates, a breakpoint's — rather
 * than each caller growing its own copy of the format and drifting apart from
 * this one.
 */
export function describeMethodResult(result: {
  className: string;
  isMeta: boolean;
  selector: string;
}): string {
  return `${result.className}${result.isMeta ? ' class' : ''} >> #${result.selector}`;
}

/** Open one found method: through an open System Browser for that session when there is
 *  one, otherwise as a document of its own.
 *
 *  The row carries the environment it was found in, and the method is opened there on BOTH
 *  paths: navigateTo switches an open browser to the row's environment, and the direct open
 *  spreads the row into the URI. Hard-coding environment 0 opened the wrong method — or
 *  none — for a row found anywhere else, which the safe-delete confirmation reaches by
 *  scanning every environment the user has configured. */
function openMethodResult(sessionId: number, r: MethodSearchResult): void {
  if (!SystemBrowser.navigateTo(sessionId, r)) {
    const uri = buildMethodUri({ kind: 'method', sessionId, ...r });
    vscode.commands.executeCommand('gemstone.openDocument', uri);
  }
}

/** Show the results as a picker and open whichever the user chooses. An empty list says
 *  so and opens nothing; a list of exactly one opens it and says so, without the picker.
 *
 *  Answers whether the user actually opened one. Callers that offer the list as a detour
 *  from something else — the safe-delete confirmation — need to tell "went and looked at a
 *  method" apart from "closed the list again", because only the first means the user has
 *  moved on to something other than the thing they were being asked about. A single result
 *  answers true for the same reason: the user is now looking at a method. */
export async function showMethodResults(
  sessionId: number,
  results: MethodSearchResult[],
  title: string,
): Promise<boolean> {
  if (results.length === 0) {
    vscode.window.showInformationMessage(`${title}: no results found.`);
    return false;
  }

  if (results.length === 1) {
    const only = results[0];
    vscode.window.showInformationMessage(
      `${title}: only ${describeMethodResult(only)} — opened it.`,
    );
    openMethodResult(sessionId, only);
    return true;
  }

  const items = results.map((r) => ({
    label: describeMethodResult(r),
    description: r.category,
    detail: r.dictName,
    result: r,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    // Always plural: a list of one never gets here.
    placeHolder: `${results.length} methods found`,
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!picked) return false;

  openMethodResult(sessionId, picked.result);
  return true;
}
