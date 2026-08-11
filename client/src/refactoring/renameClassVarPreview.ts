import { asCount } from './previewCounts';
export { parseApplyResult } from './previewEnvelope';
export type { ApplyResult } from './previewEnvelope';
/**
 * Pure helpers for the rename-class-variable (R4) preview: parsing the
 * server-side engine's paginated preview envelope and the apply result, and
 * validating a new class-variable name. Kept free of any `vscode` dependency so
 * it unit-tests directly.
 *
 * The engine (GsRenameClassVariableRefactoring) stages two kinds of change, the
 * same shapes rename-instVar (R1) uses:
 *   - classDefinitionEdit — the defining class's classVars: clause with the
 *     variable renamed; apply does the value-preserving reflective rename.
 *   - methodRecompile — a method (instance OR class side, in the class or a
 *     subclass) whose reference to the old name is rewritten.
 * A class-variable rename is ALL-OR-NOTHING: every change is applied, so there is
 * no per-change selection (the engine ignores any deselected set), and the panel
 * renders no checkboxes. The paginated-envelope shape mirrors R2/R3 so the
 * non-blocking fetch and server-side apply are reused.
 */

export type ClassVarChangeKind = 'classDefinitionEdit' | 'methodRecompile';

/** One staged change from the engine. `selector`/`category` are null for the
 *  class-definition edit. */
export interface ClassVarRenameChange {
  id: string;
  kind: ClassVarChangeKind;
  dictName: string | null;
  className: string;
  isMeta: boolean;
  selector: string | null;
  category: string | null;
  oldSource: string;
  newSource: string;
}

/** Preview warnings. A class-variable rename is hierarchy-scoped, so `references`
 *  (out-of-scope references) is always 0; `skipped` counts methods the engine
 *  could not rewrite; `collision` is the reason the new name is already in use, or
 *  null. */
export interface ClassVarOutOfScope {
  references: number;
  skipped: number;
  collision: string | null;
}

/** A method the engine could not rewrite (and skipped). */
export interface SkippedMethod {
  className: string;
  selector: string;
}

export interface PreviewPage {
  changes: ClassVarRenameChange[];
  nextOffset: number;
  done: boolean;
}

export interface StartClassVarPreview {
  token: string;
  total: number;
  oldName: string;
  newName: string;
  outOfScope: ClassVarOutOfScope;
  skippedMethods: SkippedMethod[];
  page: PreviewPage;
}

function parseChange(raw: unknown, i: number): ClassVarRenameChange {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Rename preview change ${i} is malformed.`);
  }
  const c = raw as Record<string, unknown>;
  const kind = c.kind;
  if (kind !== 'classDefinitionEdit' && kind !== 'methodRecompile') {
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
}

function parseSkipped(v: unknown): SkippedMethod[] {
  return Array.isArray(v)
    ? v
        .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
        .map((m) => ({
          className: typeof m.class === 'string' ? m.class : '?',
          selector: typeof m.selector === 'string' ? m.selector : '?',
        }))
    : [];
}

function parsePageObject(env: Record<string, unknown>): PreviewPage {
  if (typeof env.error === 'string') throw new Error(env.error);
  if (!Array.isArray(env.changes)) {
    throw new Error('Rename preview page is missing its change list.');
  }
  return {
    changes: env.changes.map(parseChange),
    nextOffset: asCount(env.nextOffset),
    done: env.done === true,
  };
}

/** Parse the start of a paginated preview. Throws on a malformed payload; the
 *  stone returns a bare error string (e.g. "Class not found: Foo") when it can't
 *  build the preview, which fails JSON.parse and is reported as an error. */
export function parseStartPreview(json: string): StartClassVarPreview {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Rename preview did not return a preview envelope.');
  }
  const env = parsed as Record<string, unknown>;
  if (typeof env.token !== 'string') {
    throw new Error('Rename preview did not return a session token.');
  }
  const oos =
    typeof env.outOfScope === 'object' && env.outOfScope !== null
      ? (env.outOfScope as Record<string, unknown>)
      : {};
  const page =
    typeof env.page === 'object' && env.page !== null
      ? parsePageObject(env.page as Record<string, unknown>)
      : { changes: [], nextOffset: 0, done: true };
  return {
    token: env.token,
    total: asCount(env.total),
    oldName: typeof env.oldName === 'string' ? env.oldName : '',
    newName: typeof env.newName === 'string' ? env.newName : '',
    outOfScope: {
      references: asCount(oos.references),
      skipped: asCount(oos.skipped),
      collision: typeof oos.collision === 'string' ? oos.collision : null,
    },
    skippedMethods: parseSkipped(env.skippedMethods),
    page,
  };
}

export function parsePage(json: string): PreviewPage {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Rename preview page did not return an envelope.');
  }
  return parsePageObject(parsed as Record<string, unknown>);
}

/** A human label for a preview row: "Foo (class definition)" or "Foo>>bar" /
 *  "Foo class>>bar" for a method. */
export function classVarChangeLabel(change: ClassVarRenameChange): string {
  if (change.kind === 'classDefinitionEdit') {
    return `${change.className} (class definition)`;
  }
  const side = change.isMeta ? ' class' : '';
  return `${change.className}${side}>>${change.selector ?? '?'}`;
}

/**
 * Validate a proposed new class-variable name. Returns an error string to show
 * inline, or undefined when acceptable. A class-variable name is a Smalltalk
 * identifier (conventionally capitalised, but GemStone does not require it) that
 * differs from the old name.
 */
export function validateNewClassVarName(value: string, oldName: string): string | undefined {
  const name = value.trim();
  if (name.length === 0) return 'Enter a new class-variable name.';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return 'A class-variable name must be a letter or underscore followed by letters, digits, or underscores.';
  }
  if (name === oldName) return 'Enter a different name.';
  return undefined;
}
