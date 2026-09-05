/**
 * Pure decision helpers for the GemStone Explorer's class/variable tree and its
 * default-dictionary selection. Kept free of any `vscode` dependency so the tree
 * shape and selection rules unit-test directly; the controller/providers wire
 * them to TreeItems and TreeView.reveal.
 */

/** One variable-side grouping under a class row: the "instance" side (isMeta
 *  false) holding instance-variable names, or the "class" side (isMeta true)
 *  holding class-variable names. Either list may be empty — see `variableSides`. */
export interface VariableSide {
  isMeta: boolean;
  names: string[];
}

/**
 * The variable-side nodes to show under a class row, mirroring the Methods pane's
 * instance/class split: the "instance" side then the "class" side.
 *
 * A class with variables of EITHER kind shows BOTH rows — the empty one rendered as
 * an empty state, since the inline "+" that adds a variable is hosted on the side
 * row, and omitting the empty side took away the only visible way to add the first
 * class variable to a class that has instance variables, or vice versa (#499).
 *
 * A class with NO variables at all shows neither row, and so keeps a flat row with
 * no expansion chevron. It has to: a tree row can only carry children by declaring a
 * collapsible state, and any collapsible state draws the chevron — so child rows
 * there would advertise variables the class does not have. That class reaches the
 * same two actions from the "+" on the class row itself.
 *
 * This must agree with what gates the class row's chevron (`classHasDefinedVars`),
 * or a class gets a chevron that opens onto nothing, or rows that cannot be reached.
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
