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
 * Only three change kinds can appear, and each reads as a plain action:
 *
 *   methodAdd       the refactoring DELETED this method — undoing puts it back
 *   methodRecompile the refactoring REWROTE it          — undoing restores the source
 *   methodRemove    the refactoring CREATED it          — undoing deletes it
 *
 * Kept free of any `vscode` dependency so it unit-tests directly.
 */

/** One inverse change: what undoing does to a single method. */
export interface UndoChange {
  id: string;
  kind: 'methodAdd' | 'methodRecompile' | 'methodRemove';
  dictName: string | null;
  className: string;
  isMeta: boolean;
  selector: string;
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
  sequence: number;
  /** How many changes carry a warning (see `UndoChange.warning`). */
  drifted: number;
  total: number;
  page: UndoPreviewPage;
}

const UNDO_KINDS = ['methodAdd', 'methodRecompile', 'methodRemove'] as const;

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Parse the undo status probe. A malformed payload reads as "nothing to undo"
 *  rather than throwing: the probe drives a menu's visibility, and a broken probe
 *  must not break the menu. */
export function parseUndoStatus(json: string): UndoStatus {
  const empty: UndoStatus = { available: false, label: '', engine: '', sequence: 0, total: 0 };
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
  if (
    typeof c.id !== 'string' ||
    typeof c.className !== 'string' ||
    typeof c.selector !== 'string'
  ) {
    throw new Error(`Undo preview change ${i} is missing required fields.`);
  }
  return {
    id: c.id,
    kind: kind as UndoChange['kind'],
    dictName: str(c.dictName),
    className: c.className,
    isMeta: c.isMeta === true,
    selector: c.selector,
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

/** A human label for a preview row: "Foo>>bar:" or "Foo class>>bar:". */
export function undoChangeLabel(change: UndoChange): string {
  return `${change.className}${change.isMeta ? ' class' : ''}>>${change.selector}`;
}

/** What undoing this change does, in the user's terms — the badge on its row. */
export function undoActionLabel(change: UndoChange): string {
  switch (change.kind) {
    case 'methodAdd':
      return 'Restore';
    case 'methodRemove':
      return 'Delete';
    default:
      return 'Revert';
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
