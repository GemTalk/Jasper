import { asCount } from './previewCounts';
export { parseApplyResult } from './previewEnvelope';
export type { ApplyResult } from './previewEnvelope';
/**
 * Pure helpers for the rename-temporary/argument (R5) preview: parsing the
 * server-side engine's paginated preview envelope and the apply result, and
 * validating a new name. No `vscode` dependency, so it unit-tests directly.
 *
 * R5 is method-local: the engine (GsRenameTemporaryRefactoring) stages a SINGLE
 * change kind — `methodRecompile`, the one method whose local was renamed. There
 * is no class-definition edit and no cross-method scan, so the change list holds
 * at most one entry. The paginated-envelope shape mirrors R2/R3/R4 so the
 * non-blocking fetch and server-side apply are reused.
 *
 * The out-of-scope payload carries two preconditions the panel surfaces and
 * refuses to apply on: `collision` (the new name is already an argument,
 * temporary, instance/class variable, or pseudo-variable) and `decline` (the
 * offset is not a local at all — an instance variable, a global, self, or a
 * message selector; that is R1/R4's job, not R5's).
 */

export type TemporaryChangeKind = 'methodRecompile';

/** The one staged change from the engine: the method recompiled with the local
 *  renamed. */
export interface TemporaryRenameChange {
  id: string;
  kind: TemporaryChangeKind;
  dictName: string | null;
  className: string;
  isMeta: boolean;
  selector: string | null;
  category: string | null;
  oldSource: string;
  newSource: string;
}

/** Preview preconditions. A temporary/argument rename is confined to one method,
 *  so `references` and `skipped` are always 0; `collision` is the reason the new
 *  name is already taken (or null); `decline` is the reason the target is not a
 *  renamable local (or null). */
export interface TemporaryOutOfScope {
  references: number;
  skipped: number;
  collision: string | null;
  decline: string | null;
}

export interface PreviewPage {
  changes: TemporaryRenameChange[];
  nextOffset: number;
  done: boolean;
}

export interface StartTemporaryPreview {
  token: string;
  total: number;
  oldName: string;
  newName: string;
  outOfScope: TemporaryOutOfScope;
  page: PreviewPage;
}

function parseChange(raw: unknown, i: number): TemporaryRenameChange {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Rename preview change ${i} is malformed.`);
  }
  const c = raw as Record<string, unknown>;
  if (c.kind !== 'methodRecompile') {
    throw new Error(`Rename preview change ${i} has an unknown kind: ${String(c.kind)}`);
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
    kind: 'methodRecompile',
    dictName: typeof c.dictName === 'string' ? c.dictName : null,
    className: c.className,
    isMeta: c.isMeta === true,
    selector: typeof c.selector === 'string' ? c.selector : null,
    category: typeof c.category === 'string' ? c.category : null,
    oldSource: c.oldSource,
    newSource: c.newSource,
  };
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
export function parseStartPreview(json: string): StartTemporaryPreview {
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
      decline: typeof oos.decline === 'string' ? oos.decline : null,
    },
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

/** A human label for the preview row: "Foo>>bar" / "Foo class>>bar". */
export function temporaryChangeLabel(change: TemporaryRenameChange): string {
  const side = change.isMeta ? ' class' : '';
  return `${change.className}${side}>>${change.selector ?? '?'}`;
}

/**
 * Validate a proposed new temporary/argument name. Returns an error string to
 * show inline, or undefined when acceptable. A local name is a Smalltalk
 * identifier (conventionally lowercase, but not required) that differs from the
 * old name. Collisions with existing variables are checked server-side and
 * surfaced through the preview's `collision`/`decline` reasons.
 */
export function validateNewTemporaryName(value: string, oldName: string): string | undefined {
  const name = value.trim();
  if (name.length === 0) return 'Enter a new name.';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return 'A variable name must be a letter or underscore followed by letters, digits, or underscores.';
  }
  if (name === oldName) return 'Enter a different name.';
  return undefined;
}
