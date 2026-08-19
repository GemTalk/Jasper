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
 * `mirror` — reversed by re-applying the OPPOSITE operation of the same engine: a rename with
 * the names swapped, or an add/remove flipped. Those rows are the mirrored operation's OWN
 * change set, so they carry CLASS-shape kinds — `classRename`, `classReparent`,
 * `classDefinitionEdit` — plus method recompiles for references being rewritten. A `mirror` is
 * deliberately not a rollback, and the UI says so once, above the list, in wording that depends
 * on `reverseKind` because the honest caveat differs per kind.
 *
 * `deselection` matters as much as the mechanism: un-ticking a row means three different things
 * (see `UndoDeselection`), and a panel that renders them alike will mislead.
 *
 * Kept free of any `vscode` dependency so it unit-tests directly.
 */

/** How the recorded undo will be carried out. See the module comment. */
export type UndoMechanism = 'changeSet' | 'mirror';

/** Which operation a `mirror` entry reverses. Drives the caveat wording. */
export type UndoReverseKind =
  'classRename' | 'instVarRename' | 'classVarRename' | 'instVarAdd' | 'instVarRemove';

/**
 * What un-ticking a preview row actually DOES. Three genuinely different answers, and getting
 * this wrong is worse than not offering the checkbox at all:
 *
 * - `perChange`   the change is simply not applied.
 * - `dropsMethod` the method is NOT carried onto the new class version — i.e. it is DELETED.
 *                 So "un-tick what you want to keep" is exactly backwards here.
 * - `ignored`     the engine applies its whole change set regardless. The row must render
 *                 DISABLED rather than invite a click that silently does nothing.
 */
export type UndoDeselection = 'perChange' | 'dropsMethod' | 'ignored';

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
  reverseKind: UndoReverseKind | null;
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
  /** Which operation is being mirrored; null for a change-set entry. */
  reverseKind: UndoReverseKind | null;
  /** What un-ticking a row does here. */
  deselection: UndoDeselection;
  /** How many methods the reversal is predicted to DELETE (only ever non-zero when reversing
   *  an instance-variable add, which removes the variable those methods use). */
  dropCount: number;
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

const REVERSE_KINDS: readonly string[] = [
  'classRename',
  'instVarRename',
  'classVarRename',
  'instVarAdd',
  'instVarRemove',
];

/** Parse the mechanism, defaulting to the change-set one — an engine that predates the mirror
 *  reversal answers no `mechanism` field and only ever records change-set entries. */
function mechanismOf(v: unknown): UndoMechanism {
  return v === 'mirror' ? 'mirror' : 'changeSet';
}

function reverseKindOf(v: unknown): UndoReverseKind | null {
  return typeof v === 'string' && REVERSE_KINDS.includes(v) ? (v as UndoReverseKind) : null;
}

/** Parse the deselection semantics. Defaults to `perChange`, which is what a change-set entry
 *  always is and what an engine predating the field only ever recorded. */
function deselectionOf(v: unknown): UndoDeselection {
  if (v === 'ignored') return 'ignored';
  if (v === 'dropsMethod') return 'dropsMethod';
  return 'perChange';
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
    reverseKind: null,
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
    reverseKind: reverseKindOf(env.reverseKind),
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
    reverseKind: reverseKindOf(env.reverseKind),
    deselection: deselectionOf(env.deselection),
    dropCount: asCount(env.dropCount),
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
      return mechanism === 'mirror' ? 'Rewrite' : 'Revert';
  }
}

/** The shared half of every `mirror` caveat: it re-applies the opposite operation, so nothing
 *  is rolled back and class history only ever grows. */
const MIRROR_PREAMBLE =
  'This reverses the change by applying the opposite operation — it is not a rollback. ' +
  'The class keeps its history (a reversal adds a version, it never removes one). ';

const COMMIT_TAIL = 'If the original change was committed, the reversal needs its own commit.';

/**
 * The standing caveat for a `mirror` entry, stated once above the list.
 *
 * Deliberately per-kind, because the honest caveat genuinely differs. A rename gets a *better*
 * outcome than a rollback would give (it carries later work forward, where a class-history
 * revert would discard it). An add/remove reversal does not, and must say what it will not
 * bring back — a single generic sentence would either overstate the renames' risk or
 * understate the instance variables'.
 *
 * `dropCount` is the number of methods the reversal is predicted to DELETE; the caller passes
 * it so the wording can name the number instead of hinting at it.
 */
export function mirrorCaveat(kind: UndoReverseKind | null, dropCount = 0): string {
  switch (kind) {
    case 'instVarAdd': {
      const drops =
        dropCount > 0
          ? `Taking it back out will DELETE ${dropCount} method${dropCount === 1 ? '' : 's'} ` +
            'written since that use it. '
          : '';
      return `${MIRROR_PREAMBLE}Reversing an added instance variable removes it again. ${drops}${COMMIT_TAIL}`;
    }
    case 'instVarRemove':
      return (
        `${MIRROR_PREAMBLE}Reversing a removed instance variable declares the name again, but ` +
        'it does NOT restore the values it held, nor any method the removal dropped. ' +
        COMMIT_TAIL
      );
    default:
      return (
        `${MIRROR_PREAMBLE}Anything written since the rename is carried forward rather than ` +
        `discarded. ${COMMIT_TAIL}`
      );
  }
}

/** What to say about the checkboxes, given what un-ticking actually does here. */
export function deselectionNote(deselection: UndoDeselection): string | null {
  switch (deselection) {
    case 'ignored':
      return 'This reversal is all-or-nothing — the shape edits and the class re-versionings have to move together, so individual rows cannot be left out.';
    case 'dropsMethod':
      return 'Careful: un-ticking a row here does not keep that method as it is — it DELETES it, by not carrying it onto the new class version.';
    default:
      return null;
  }
}

/** The one-line summary above the change list. */
export function undoSummary(total: number, drifted: number): string {
  const changes = `${total} change${total === 1 ? '' : 's'}`;
  if (drifted <= 0) return `${changes} will be reversed.`;
  return (
    `${changes} will be reversed. ${drifted} of them ${drifted === 1 ? 'is' : 'are'} ` +
    'not a clean reversal — see the warnings below, and un-tick anything you want to keep.'
  );
}
