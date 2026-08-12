/**
 * Pure helpers for the rename-instance-variable preview: parsing the server-side
 * refactoring engine's change-set JSON, ordering the changes for a safe apply,
 * and labelling each change for the refactor-preview panel.
 *
 * Kept free of any `vscode` dependency so it unit-tests directly; the VS Code
 * glue (building the WorkspaceEdit + URIs, showing the preview, saving to
 * recompile) lives in the Explorer command.
 */
import { ApplyResult, parseApplyResult } from './previewEnvelope';

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

/** A started preview: the SessionTemps token the apply is addressed to, plus the
 *  staged changes. */
export interface RenamePreview {
  token: string;
  changes: RenameChange[];
}

/**
 * Parse the engine's start-preview envelope, `{"token":..,"changes":[..]}`.
 * Throws if the payload isn't that shape — callers surface it as an error rather
 * than a partial rename. The stone returns a bare error string (e.g. "Class not
 * found: Foo") instead of JSON when the class can't be resolved; that fails
 * JSON.parse and is reported as an error.
 */
export function parseRenamePreview(json: string): RenamePreview {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Rename preview did not return a preview envelope.');
  }
  const env = parsed as Record<string, unknown>;
  if (typeof env.token !== 'string') {
    throw new Error('Rename preview did not return a token.');
  }
  return { token: env.token, changes: parseRenameChanges(JSON.stringify(env.changes)) };
}

/**
 * The apply result: how many classes were re-versioned, and anything that failed to
 * recompile onto its new class version. Structurally the family-wide envelope, so it
 * is a named alias (RB catalog C3) — call sites and their tests read unchanged.
 */
export type RenameApplyResult = ApplyResult;

/**
 * Parse the engine's apply envelope, `{"applied":N,"failed":[..]}`. A malformed payload
 * is reported as an error rather than silently read as success; see `parseApplyResult`
 * for exactly what is coerced.
 *
 * This was a private copy that had DRIFTED from every other family — a missing failure
 * `id` defaulted to '' rather than '?', and `applied` was read with a raw number check
 * rather than `asCount`, so a negative or non-numeric count was never clamped to 0. It
 * is now the shared parser (C3), a deliberate behaviour change pinned by tests.
 */
export const parseRenameApplyResult = parseApplyResult;

/**
 * Parse a JSON array of change objects into typed changes. Throws if the payload
 * is not the expected array — callers surface that as an error rather than a
 * partial rename.
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

/**
 * The ids the user unchecked, which is what the engine's apply takes. Inverting
 * the panel's SELECTED list here (rather than sending it) matters: the engine
 * carries every method forward by default and drops only what it is told to, so a
 * dropped id list that arrives short is harmless, whereas a kept-id list that
 * arrived short would delete methods. Structural changes can't be deselected, so
 * they never appear here even if the caller passes a stale selection.
 */
export function deselectedIdsFrom(changes: RenameChange[], selectedIds: string[]): string[] {
  return changes
    .filter((c) => !isStructuralChange(c) && !selectedIds.includes(c.id))
    .map((c) => c.id);
}

/** Labels for the methods a deselection will DELETE, for the confirm prompt —
 *  deselecting a method means it is not carried onto the new class version. */
export function deselectedLabels(changes: RenameChange[], selectedIds: string[]): string[] {
  const dropped = deselectedIdsFrom(changes, selectedIds);
  return changes.filter((c) => dropped.includes(c.id)).map((c) => changeLabel(c));
}
