/**
 * Pure helpers for the move-method (M6) preview: parsing the engine's pre-flight
 * analysis, the paginated preview envelope, and the apply result. No `vscode`
 * dependency, so it unit-tests directly.
 *
 * M6 relocates one OR MORE methods from a source class/side to a different class
 * and/or the other side. Per movable selector it stages a `methodAdd` on the target
 * (the same source, verbatim) plus a `methodRemove` on the source. Both changes for a
 * selector are required together, so every row is a CORE row (checked + disabled): the
 * user chooses WHICH methods to move at drag/command time, not in the preview.
 *
 * A selector that cannot move is dropped from the change set and reported in
 * `skippedMethods` (with a reason); a GLOBAL decline (target missing, or a same-class
 * same-side no-op) empties the whole change set and rides in `outOfScope.decline`.
 */

export type MoveChangeKind = 'methodAdd' | 'methodRemove';

/** One staged change: a `methodAdd` (compile on the target, no old source) or a
 *  `methodRemove` (delete from the source, no new source). */
export interface MoveChange {
  id: string;
  kind: MoveChangeKind;
  dictName: string | null;
  className: string;
  isMeta: boolean;
  selector: string | null;
  category: string | null;
  /** Empty for a `methodAdd` (brand-new on the target) — the diff renders all-added. */
  oldSource: string;
  /** Empty for a `methodRemove` (deleted) — the diff renders all-removed. */
  newSource: string;
}

/** A selector that will NOT move, with the reason. */
export interface SkippedMethod {
  selector: string;
  reason: string;
}

/** Preview preconditions. `decline` (a global decline) blocks Apply; `collision` is
 *  always null for move (per-selector collisions ride in `skippedMethods`). */
export interface MoveOutOfScope {
  collision: string | null;
  decline: string | null;
}

export interface PreviewPage {
  changes: MoveChange[];
  nextOffset: number;
  done: boolean;
}

export interface StartMovePreview {
  token: string;
  total: number;
  targetClass: string | null;
  movableCount: number;
  outOfScope: MoveOutOfScope;
  skippedMethods: SkippedMethod[];
  page: PreviewPage;
}

export interface ApplyResult {
  applied: number;
  failed: { id: string; label: string; error: string }[];
  error?: string;
}

/** One selector's pre-flight verdict. */
export interface MoveSelectorAnalysis {
  selector: string;
  decline: string | null;
}

/** The engine pre-flight: the resolved target class, a global decline (if any), the
 *  count that will move, and a per-selector decline. */
export interface MoveAnalysis {
  targetClass: string | null;
  globalDecline: string | null;
  movableCount: number;
  selectors: MoveSelectorAnalysis[];
}

function asCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

function parseChange(raw: unknown, i: number): MoveChange {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Move preview change ${i} is malformed.`);
  }
  const c = raw as Record<string, unknown>;
  if (c.kind !== 'methodAdd' && c.kind !== 'methodRemove') {
    throw new Error(`Move preview change ${i} has an unknown kind: ${String(c.kind)}`);
  }
  if (typeof c.id !== 'string' || typeof c.className !== 'string') {
    throw new Error(`Move preview change ${i} is missing required fields.`);
  }
  return {
    id: c.id,
    kind: c.kind,
    dictName: typeof c.dictName === 'string' ? c.dictName : null,
    className: c.className,
    isMeta: c.isMeta === true,
    selector: typeof c.selector === 'string' ? c.selector : null,
    category: typeof c.category === 'string' ? c.category : null,
    oldSource: typeof c.oldSource === 'string' ? c.oldSource : '',
    newSource: typeof c.newSource === 'string' ? c.newSource : '',
  };
}

function parsePageObject(env: Record<string, unknown>): PreviewPage {
  if (typeof env.error === 'string') throw new Error(env.error);
  if (!Array.isArray(env.changes)) {
    throw new Error('Move preview page is missing its change list.');
  }
  return {
    changes: env.changes.map(parseChange),
    nextOffset: asCount(env.nextOffset),
    done: env.done === true,
  };
}

function parseSkipped(raw: unknown): SkippedMethod[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .map((s) => ({
      selector: typeof s.selector === 'string' ? s.selector : '?',
      reason: typeof s.reason === 'string' ? s.reason : 'cannot move',
    }));
}

/** Parse the pre-flight analysis payload. Throws on a bare error string (which fails
 *  JSON.parse). */
export function parseAnalysis(json: string): MoveAnalysis {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Move analysis did not return an envelope.');
  }
  const env = parsed as Record<string, unknown>;
  const selectors = Array.isArray(env.selectors)
    ? env.selectors
        .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
        .map((s) => ({
          selector: typeof s.selector === 'string' ? s.selector : '?',
          decline: typeof s.decline === 'string' ? s.decline : null,
        }))
    : [];
  return {
    targetClass: typeof env.targetClass === 'string' ? env.targetClass : null,
    globalDecline: typeof env.globalDecline === 'string' ? env.globalDecline : null,
    movableCount: asCount(env.movableCount),
    selectors,
  };
}

/** Parse the start of a paginated preview. Throws on a malformed payload. */
export function parseStartPreview(json: string): StartMovePreview {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Move preview did not return a preview envelope.');
  }
  const env = parsed as Record<string, unknown>;
  if (typeof env.token !== 'string') {
    throw new Error('Move preview did not return a session token.');
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
    targetClass: typeof env.targetClass === 'string' ? env.targetClass : null,
    movableCount: asCount(env.movableCount),
    outOfScope: {
      collision: typeof oos.collision === 'string' ? oos.collision : null,
      decline: typeof oos.decline === 'string' ? oos.decline : null,
    },
    skippedMethods: parseSkipped(env.skippedMethods),
    page,
  };
}

export function parsePage(json: string): PreviewPage {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Move preview page did not return an envelope.');
  }
  return parsePageObject(parsed as Record<string, unknown>);
}

export function parseApplyResult(json: string): ApplyResult {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Apply did not return a result envelope.');
  }
  const env = parsed as Record<string, unknown>;
  const failed = Array.isArray(env.failed)
    ? env.failed
        .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
        .map((f) => ({
          id: typeof f.id === 'string' ? f.id : '?',
          label: typeof f.label === 'string' ? f.label : '?',
          error: typeof f.error === 'string' ? f.error : 'unknown error',
        }))
    : [];
  return {
    applied: asCount(env.applied),
    failed,
    error: typeof env.error === 'string' ? env.error : undefined,
  };
}

/** A human label for a preview row: "Class[ class]>>selector" tagged with the move
 *  direction (add onto the target / remove from the source). */
export function moveChangeLabel(change: MoveChange): string {
  const side = change.isMeta ? ' class' : '';
  const base = `${change.className}${side}>>${change.selector ?? '?'}`;
  return change.kind === 'methodAdd' ? `${base} (add to target)` : `${base} (remove from source)`;
}
