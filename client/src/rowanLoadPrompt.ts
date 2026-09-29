import * as vscode from 'vscode';

/**
 * Whether to load the open project now that `dependencyName` has been added to
 * it. Adding a dependency only writes a file; until the project is loaded the
 * database doesn't have the code, which is easy to forget — so offer, rather
 * than either loading behind the user's back or leaving them to notice.
 *
 * The offer is made every time, and there is no setting to silence it: it
 * follows an explicit **Add Dependency…**, so it is never a prompt the user
 * did not just ask for, and someone who added a dependency deliberately is in
 * a position to answer for that one.
 *
 * Only call this while connected: with no database there is nothing to load
 * into, and asking would be noise.
 */
export async function shouldLoadAfterAddingDependency(dependencyName: string): Promise<boolean> {
  const LOAD = 'Load';
  // Modal, not a toast: it follows an explicit action and the answer decides
  // whether the database matches the project on disk. A toast auto-hides, and
  // missing it leaves the two quietly out of step.
  const choice = await vscode.window.showInformationMessage(
    `Load this project into the database so "${dependencyName}" takes effect?`,
    {
      modal: true,
      detail:
        `"${dependencyName}" has been added to the project on disk. The database won't have ` +
        'its code until the project is loaded.',
    },
    LOAD,
  );

  // Dismissing leaves the dependency on disk and unloaded.
  return choice === LOAD;
}
