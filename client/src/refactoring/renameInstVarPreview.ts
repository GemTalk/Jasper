/**
 * Pure helpers for the rename-instance-variable preview: parsing the server-side
 * refactoring engine's change-set JSON, ordering the changes for a safe apply,
 * and labelling each change for the refactor-preview panel.
 *
 * Kept free of any `vscode` dependency so it unit-tests directly; the VS Code
 * glue (building the WorkspaceEdit + URIs, showing the preview, saving to
 * recompile) lives in the Explorer command.
 */

/** One staged change from GsRefactoringChangeSet>>jsonString. `selector` and
 *  `category` are null for a class-definition edit; `dictName` may be null when
 *  the engine could not name a defining dictionary. */
export interface RenameChange {
  id: string;
  kind: 'methodRecompile' | 'classDefinitionEdit';
  dictName: string | null;
  className: string;
  isMeta: boolean;
  selector: string | null;
  category: string | null;
  oldSource: string;
  newSource: string;
}

/** True when a change is structural (always applied, cannot be deselected).
 *  The class-definition edit must accompany the method recompiles: recompiling
 *  method bodies that reference the new ivar name without reshaping the class
 *  would fail every recompile, or bind to a stray Undeclared global. The panel
 *  renders such a change checked and DISABLED, and a disabled checkbox is never
 *  reported as deselected to the engine. */
export function isStructuralChange(change: RenameChange): boolean {
  return change.kind === 'classDefinitionEdit';
}

/**
 * Parse the engine's change-set JSON into typed changes. Throws if the payload
 * is not the expected JSON array of change objects — callers surface that as an
 * error rather than a partial rename. The stone returns a bare error string
 * (e.g. "Class not found: Foo") instead of JSON when the class can't be
 * resolved; that fails JSON.parse and is reported as an error.
 */
export function parseRenameChanges(json: string): RenameChange[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error('Rename preview did not return a change list.');
  }
  return parsed.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error(`Rename preview change ${i} is malformed.`);
    }
    const c = raw as Record<string, unknown>;
    const kind = c.kind;
    if (kind !== 'methodRecompile' && kind !== 'classDefinitionEdit') {
      throw new Error(`Rename preview change ${i} has an unknown kind: ${String(kind)}`);
    }
    if (
      typeof c.id !== 'string' ||
      typeof c.className !== 'string' ||
      typeof c.newSource !== 'string' ||
      typeof c.oldSource !== 'string'
    ) {
      throw new Error(`Rename preview change ${i} is missing required fields.`);
    }
    return {
      id: c.id,
      kind,
      dictName: typeof c.dictName === 'string' ? c.dictName : null,
      className: c.className,
      isMeta: c.isMeta === true,
      selector: typeof c.selector === 'string' ? c.selector : null,
      category: typeof c.category === 'string' ? c.category : null,
      oldSource: c.oldSource,
      newSource: c.newSource,
    };
  });
}

/**
 * Order the changes so a class-definition edit is applied (and recompiled)
 * before any method that references the renamed variable: methods recompiled
 * against the old class shape would not resolve the new variable name. Original
 * order is otherwise preserved (stable).
 */
export function orderChangesClassDefFirst(changes: RenameChange[]): RenameChange[] {
  const defs = changes.filter((c) => c.kind === 'classDefinitionEdit');
  const methods = changes.filter((c) => c.kind === 'methodRecompile');
  return [...defs, ...methods];
}

/**
 * Validate a proposed new instance-variable name for the rename input box.
 * Returns an error string to show inline, or undefined when the name is
 * acceptable. A valid name is a Smalltalk identifier that differs from the old
 * one; equal-to-old is allowed silently (the caller treats it as "no change").
 */
export function validateNewIvarName(candidate: string, oldName: string): string | undefined {
  const name = candidate.trim();
  if (name.length === 0) return 'Enter a new instance-variable name.';
  if (name === oldName) return undefined;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return 'An instance-variable name must be a letter or underscore followed by letters, digits, or underscores.';
  }
  return undefined;
}

/** A human label for the refactor-preview row: "Foo (class definition)" or
 *  "Foo>>bar" / "Foo class>>bar" for a method. */
export function changeLabel(change: RenameChange): string {
  if (change.kind === 'classDefinitionEdit') {
    return `${change.className} (class definition)`;
  }
  const side = change.isMeta ? ' class' : '';
  return `${change.className}${side}>>${change.selector ?? '?'}`;
}

/** One recompile to perform when applying a rename: everything the client needs
 *  to drive a compile query, with the source's dictionary already resolved to a
 *  1-based symbol-list index (or undefined to fall back to first-match). */
export interface RenameApplyStep {
  id: string;
  kind: RenameChange['kind'];
  className: string;
  isMeta: boolean;
  category: string;
  newSource: string;
  dictIndex: number | undefined;
  label: string;
}

/**
 * Build the ordered list of recompiles for the selected changes. Keeps the
 * caller's ordering (class definition first, so methods recompile against the
 * new class shape), resolves each change's dictionary name to its 1-based
 * symbol-list index (falling back to the currently-selected dictionary, then to
 * undefined = first-match), and fills the method category (defaulting to "as yet
 * unclassified"). Pure so the ordering/resolution rules unit-test directly; the
 * caller just executes each step with no commit.
 */
export function planRenameApply(
  ordered: RenameChange[],
  selectedIds: string[],
  dictNames: string[],
  currentDictName?: string,
): RenameApplyStep[] {
  const dictIndexOf = (name: string | null): number | undefined => {
    const dn = name ?? currentDictName;
    if (dn === undefined || dn === null) return undefined;
    const i = dictNames.indexOf(dn);
    return i >= 0 ? i + 1 : undefined;
  };
  return ordered
    .filter((c) => selectedIds.includes(c.id))
    .map((c) => ({
      id: c.id,
      kind: c.kind,
      className: c.className,
      isMeta: c.isMeta,
      category: c.category ?? 'as yet unclassified',
      newSource: c.newSource,
      dictIndex: dictIndexOf(c.dictName),
      label: changeLabel(c),
    }));
}
