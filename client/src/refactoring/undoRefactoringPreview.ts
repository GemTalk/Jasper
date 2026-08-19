import { asCount } from './previewCounts';
export { parseApplyResult } from './previewEnvelope';
export type { ApplyResult } from './previewEnvelope';

/**
 * Pure helpers for the UNDO-a-refactoring preview (issue #434): parsing the undo
 * status probe, the paginated preview envelope, and naming what each inverse change
 * will do.
 *
 * The engine records an undo as an ordinary `GsRefactoringChangeSet` holding the
 * INVERSE of what was applied, so the envelope is the same shape every forward
 * refactoring's preview uses — with `label` / `engine` naming the refactoring being
 * undone and `drifted` counting the changes that carry a warning.
 *
 * There are TWO mechanisms and the rows read differently under each, so `mechanism` travels
 * in the envelope and the labels are chosen from it:
 *
 * `changeSet` — the recorded inverse of a method refactoring. Three kinds:
 *   methodAdd       the refactoring DELETED this method — undoing puts it back
 *   methodRecompile the refactoring REWROTE it          — undoing restores the source
 *   methodRemove    the refactoring CREATED it          — undoing deletes it
 *
 * `renameBack` — a rename reversed by renaming again (rename class / instance variable /
 * class variable). Those rows are the reverse rename's OWN change set, so they carry
 * CLASS-shape kinds — `classRename`, `classReparent`, `classDefinitionEdit` — plus method
 * recompiles for the references being rewritten. A `renameBack` is deliberately not a
 * rollback, and the UI says so once, above the list.
 *
 * Kept free of any `vscode` dependency so it unit-tests directly.
 */

/** How the recorded undo will be carried out. See the module comment. */
export type UndoMechanism = 'changeSet' | 'renameBack';

/** One change the undo will apply. A method change carries a `selector`; a class-shape
 *  change (only ever from a `renameBack`) carries none, and is labelled by its class. */
export interface UndoChange {
  id: string;
  kind:
    | 'methodAdd'
    | 'methodRecompile'
    | 'methodRemove'
    | 'classRename'
    | 'classReparent'
    | 'classDefinitionEdit';
  dictName: string | null;
  className: string;
  isMeta: boolean;
  /** null for a class-shape change. */
  selector: string | null;
  /** The name a `classRename` renames TO; null for every other kind. */
  newName: string | null;
  category: string | null;
  /** What is in the stone now (null for a methodAdd — the method is not there). */
  oldSource: string | null;
  /** What undoing leaves behind (null for a methodRemove — it will be gone). */
  newSource: string | null;
  /** Why undoing this one is not a clean reversal (edited since, already undone,
   *  class gone), or null when it is clean. */
  warning: string | null;
}

/** Whether there is a refactoring to undo, and what it is called. */
export interface UndoStatus {
  available: boolean;
  label: string;
  engine: string;
  mechanism: UndoMechanism;
  /** Monotonic per-session counter: a later entry always has a higher number, so a
   *  stale label the client is still showing can be told apart from a current one. */
  sequence: number;
  total: number;
}

/** One page of a paginated undo preview. */
export interface UndoPreviewPage {
  changes: UndoChange[];
  nextOffset: number;
  done: boolean;
}

/** The start of a paginated undo preview. */
export interface UndoStartPreview {
  token: string;
  /** What the refactoring being undone called itself. */
  label: string;
  engine: string;
  mechanism: UndoMechanism;
  sequence: number;
  /** How many changes carry a warning (see `UndoChange.warning`). */
  drifted: number;
  total: number;
  page: UndoPreviewPage;
}

const UNDO_KINDS = [
  'methodAdd',
  'methodRecompile',
  'methodRemove',
  'classRename',
  'classReparent',
  'classDefinitionEdit',
] as const;

/** Parse the mechanism, defaulting to the change-set one — an engine that predates the rename
 *  reversal answers no `mechanism` field and only ever records change-set entries. */
function mechanismOf(v: unknown): UndoMechanism {
  return v === 'renameBack' ? 'renameBack' : 'changeSet';
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Parse the undo status probe. A malformed payload reads as "nothing to undo"
 *  rather than throwing: the probe drives a menu's visibility, and a broken probe
 *  must not break the menu. */
export function parseUndoStatus(json: string): UndoStatus {
  const empty: UndoStatus = {
    available: false,
    label: '',
    engine: '',
    mechanism: 'changeSet',
    sequence: 0,
    total: 0,
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return empty;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return empty;
  const env = parsed as Record<string, unknown>;
  if (env.available !== true) return empty;
  return {
    available: true,
    label: str(env.label) ?? 'the last refactoring',
    engine: str(env.engine) ?? '',
    mechanism: mechanismOf(env.mechanism),
    sequence: asCount(env.sequence),
    total: asCount(env.total),
  };
}

/** Parse one inverse change; throws on a malformed/unknown entry. */
function parseChange(raw: unknown, i: number): UndoChange {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Undo preview change ${i} is malformed.`);
  }
  const c = raw as Record<string, unknown>;
  const kind = c.kind;
  if (!UNDO_KINDS.includes(kind as (typeof UNDO_KINDS)[number])) {
    throw new Error(`Undo preview change ${i} has an unknown kind: ${String(kind)}`);
  }
  if (typeof c.id !== 'string' || typeof c.className !== 'string') {
    throw new Error(`Undo preview change ${i} is missing required fields.`);
  }
  // A METHOD change must name its selector; a class-shape change never has one.
  const selector = str(c.selector);
  if (String(kind).startsWith('method') && selector === null) {
    throw new Error(`Undo preview change ${i} is a method change with no selector.`);
  }
  return {
    id: c.id,
    kind: kind as UndoChange['kind'],
    dictName: str(c.dictName),
    className: c.className,
    isMeta: c.isMeta === true,
    selector,
    newName: str(c.newName),
    category: str(c.category),
    oldSource: str(c.oldSource),
    newSource: str(c.newSource),
    warning: str(c.warning),
  };
}

function parsePageObject(env: Record<string, unknown>): UndoPreviewPage {
  if (typeof env.error === 'string') throw new Error(env.error);
  if (!Array.isArray(env.changes)) throw new Error('Undo preview page is missing its change list.');
  return {
    changes: env.changes.map(parseChange),
    nextOffset: asCount(env.nextOffset),
    done: env.done === true,
  };
}

/** Parse the start of a paginated undo preview. Throws (with the engine's own
 *  wording) when there is nothing to undo, or when the payload is not an envelope. */
export function parseUndoStartPreview(json: string): UndoStartPreview {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Undo preview did not return a preview envelope.');
  }
  const env = parsed as Record<string, unknown>;
  if (typeof env.error === 'string') throw new Error(env.error);
  if (typeof env.token !== 'string')
    throw new Error('Undo preview did not return a session token.');
  const page =
    typeof env.page === 'object' && env.page !== null
      ? parsePageObject(env.page as Record<string, unknown>)
      : { changes: [], nextOffset: 0, done: true };
  return {
    token: env.token,
    label: str(env.label) ?? 'the last refactoring',
    engine: str(env.engine) ?? '',
    mechanism: mechanismOf(env.mechanism),
    sequence: asCount(env.sequence),
    drifted: asCount(env.drifted),
    total: asCount(env.total),
    page,
  };
}

/** Parse a page fetched after the start. Throws on an error/expired envelope. */
export function parseUndoPage(json: string): UndoPreviewPage {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Undo preview page did not return an envelope.');
  }
  return parsePageObject(parsed as Record<string, unknown>);
}

/** A human label for a preview row: "Foo>>bar:", "Foo class>>bar:", or — for a class-shape
 *  change, which has no selector — the class itself, a rename showing both names. */
export function undoChangeLabel(change: UndoChange): string {
  if (change.selector === null) {
    return change.newName === null ? change.className : `${change.className} → ${change.newName}`;
  }
  return `${change.className}${change.isMeta ? ' class' : ''}>>${change.selector}`;
}

/**
 * What undoing this change does, in the user's terms — the badge on its row.
 *
 * The wording depends on the MECHANISM, because one kind means two things: a
 * `methodRecompile` in a recorded inverse restores a method's earlier source ("Revert"),
 * while in a reverse rename it rewrites a reference to follow the name ("Rewrite"). Passing
 * the mechanism keeps the badge honest rather than picking one reading and being wrong half
 * the time.
 */
export function undoActionLabel(change: UndoChange, mechanism: UndoMechanism): string {
  switch (change.kind) {
    case 'methodAdd':
      return 'Restore';
    case 'methodRemove':
      return 'Delete';
    case 'classRename':
      return 'Rename back';
    case 'classReparent':
      return 'Re-version';
    case 'classDefinitionEdit':
      return 'Redefine';
    default:
      return mechanism === 'renameBack' ? 'Rewrite' : 'Revert';
  }
}

/**
 * The standing caveat for a `renameBack`, stated once above the list.
 *
 * Deliberately not sold as a rollback: GemStone has no transaction savepoints, so renaming
 * back is a fresh forward rename and class history GROWS rather than shrinking. The second
 * half is the compensation, and it is a real one — a rename carries methods forward, so work
 * written after the original rename SURVIVES the reversal, where a class-history revert
 * would have discarded it.
 */
export const RENAME_BACK_CAVEAT =
  'This reverses the rename by renaming again — it is not a rollback. The class keeps its ' +
  'history (a reversal adds a version, it never removes one), and anything written since ' +
  'the rename is carried forward rather than discarded. If the rename was committed, the ' +
  'reversal needs its own commit.';

/** The one-line summary above the change list. */
export function undoSummary(total: number, drifted: number): string {
  const changes = `${total} change${total === 1 ? '' : 's'}`;
  if (drifted <= 0) return `${changes} will be reversed.`;
  return (
    `${changes} will be reversed. ${drifted} of them ${drifted === 1 ? 'is' : 'are'} ` +
    'not a clean reversal — see the warnings below, and un-tick anything you want to keep.'
  );
}
