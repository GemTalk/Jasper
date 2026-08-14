/**
 * Pure decision helpers for the GemStone Explorer's class/variable tree and its
 * default-dictionary selection. Kept free of any `vscode` dependency so the tree
 * shape and selection rules unit-test directly; the controller/providers wire
 * them to TreeItems and TreeView.reveal.
 */

/** One variable-side grouping under a class row: the "instance" side (isMeta
 *  false) holding instance-variable names, or the "class" side (isMeta true)
 *  holding class-variable names. */
export interface VariableSide {
  isMeta: boolean;
  names: string[];
}

/**
 * The variable-side nodes to show under a class row, mirroring the Methods pane's
 * instance/class split: the "instance" side then the "class" side. When a class
 * defines any variables at all, BOTH sides are returned (a side that happens to be
 * empty carries an empty `names` list, so the caller can render its header grayed
 * and non-expandable). A class that defines neither kind shows nothing.
 */
export function variableSides(ivarNames: string[], classVarNames: string[]): VariableSide[] {
  if (ivarNames.length === 0 && classVarNames.length === 0) return [];
  return [
    { isMeta: false, names: ivarNames },
    { isMeta: true, names: classVarNames },
  ];
}

/**
 * The index (into `names`) of the dictionary to auto-select when a session
 * connects: UserGlobals when present (the usual starting point), otherwise the
 * first dictionary. Returns -1 when there are no dictionaries (nothing to select).
 */
export function defaultDictionaryIndex(names: string[]): number {
  if (names.length === 0) return -1;
  const userGlobals = names.indexOf('UserGlobals');
  return userGlobals >= 0 ? userGlobals : 0;
}

/**
 * Whether a class-picker label matches the typed query, for the class-by-prefix
 * QuickPick (the move-to-class destination picker). The
 * QuickPick deliberately turns VS Code's built-in fuzzy SUBSTRING matching off and
 * uses this instead, so typing "Z" surfaces only classes that START with "Z", not
 * every class containing a "z". Case-insensitive; the query is trimmed; an empty
 * query matches everything (show the full list).
 */
export function matchesClassPrefix(label: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || label.toLowerCase().startsWith(q);
}

/**
 * Whether a class whose class-category is `classCategory` is shown under the
 * selected category node `selectedPath`. A category node shows its own classes AND
 * everything in its dash-segmented subtree (selecting "Announcements" shows
 * "Announcements-Core" too), so a class matches when its category equals the path
 * or begins with `path-`. Used to keep a selected class in sync when its category
 * node is clicked: the classes pane keeps highlighting the class, so the
 * controller must not drop it (which would desync New Method / the Hierarchy pane).
 */
export function categoryContains(selectedPath: string, classCategory: string | undefined): boolean {
  if (classCategory === undefined) return false;
  return classCategory === selectedPath || classCategory.startsWith(`${selectedPath}-`);
}
