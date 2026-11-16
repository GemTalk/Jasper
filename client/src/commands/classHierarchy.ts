import * as vscode from 'vscode';
import * as queries from '../browserQueries';
import { SessionManager } from '../sessionManager';
import { buildClassDefinitionUri } from '../gemstoneFileSystemProvider';
import { unboundHierarchyMarker, unboundHierarchyTooltip } from '../hierarchyBinding';
import { pickClass } from './classPicker';
import { NbCancelledError } from '../nbRunner';

/**
 * Command handler for "Class Hierarchy": pick a class from the stone's class list, then pick a
 * row of its hierarchy (superclasses, the class, its subclasses) to open that class's definition
 * and show the class in the GemStone Explorer, with its Hierarchy pane open.
 */
export async function showClassHierarchy(sessionManager: SessionManager): Promise<void> {
  const session = await sessionManager.resolveSession();
  if (!session) return;

  const pickedClass = await pickClass(session);
  if (!pickedClass) return;

  // The dictionary index scopes the lookup, so a class shadowed by a same-named one in an
  // earlier dictionary shows its own lineage.
  const { className, dictIndex } = pickedClass.entry;
  let results: Awaited<ReturnType<typeof queries.getClassHierarchyAsync>>;
  try {
    results = await queries.getClassHierarchyAsync(session, className, dictIndex);
  } catch (e) {
    // A cancel needs no message, and a busy refusal has had its own.
    if (!(e instanceof NbCancelledError) && !queries.isBusyRefusal(e)) {
      vscode.window.showErrorMessage(
        `Hierarchy query failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return;
  }

  if (results.length === 0) {
    vscode.window.showInformationMessage(`No hierarchy found for ${className}.`);
    return;
  }

  const superCount = results.filter((r) => r.kind === 'superclass').length;

  const items = results.map((r, idx) => {
    let depth: number;
    if (r.kind === 'superclass') depth = idx;
    else if (r.kind === 'self') depth = superCount;
    else depth = superCount + 1;
    const marker = r.kind === 'self' ? ' ◀' : '';
    return {
      label: `${'  '.repeat(depth)}${r.className}${marker}`,
      description: r.binding === 'bound' ? r.dictName : unboundHierarchyMarker(r.binding),
      detail: r.kind === 'self' ? '(target class)' : undefined,
      entry: r,
    };
  });

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `Hierarchy for ${className}`,
    matchOnDescription: true,
  });
  if (!picked) return;

  const { entry } = picked;
  // Opening one by name would show whichever class the name binds now, not this one.
  if (entry.binding !== 'bound') {
    // Only the tooltip's marker line: the rest explains the Explorer row, too much for a toast.
    const [why] = unboundHierarchyTooltip(entry.className, entry.binding).split('\n\n');
    vscode.window.showWarningMessage(`${why} Its definition can't be opened from here.`);
    return;
  }
  // Focusing expands the Hierarchy pane even when collapsed, which plain navigation never does.
  await vscode.commands.executeCommand('gemstoneExplorerClassHierarchy.focus');
  await vscode.commands.executeCommand(
    'gemstone.openDocument',
    buildClassDefinitionUri(session.id, entry.dictName, entry.className, entry.dictIndex),
  );
}
