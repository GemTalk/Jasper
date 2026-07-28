/**
 * Pure helpers for the push-up / push-down method (M7 / M8) preview: parsing the
 * engine's pre-flight analysis, the paginated preview envelope, and the apply result.
 * No `vscode` dependency, so it unit-tests directly.
 *
 * Push-UP relocates one OR MORE methods from a class to its immediate SUPERCLASS.
 * Push-DOWN relocates them from a class into its immediate SUBCLASSES. Both keep the
 * selector and the source verbatim and the same side (no instance↔class flip). Per
 * movable selector, push-up stages one `methodAdd` on the superclass + one
 * `methodRemove` on the source; push-down stages one `methodAdd` per receiving subclass
 * + a single `methodRemove` on the source. Both changes for a selector are required
 * together, so every row is a CORE row (checked + disabled): the user chose WHICH
 * methods to push at command time, not in the preview.
 *
 * A selector that cannot move is dropped from the change set and reported in
 * `skippedMethods` (with a reason); a GLOBAL decline (no superclass for push-up, no
 * subclasses for push-down) empties the whole change set and rides in
 * `outOfScope.decline`. The engine's JSON shape is identical to move-method's, so this
 * module mirrors it.
 */

export type PushChangeKind = 'methodAdd' | 'methodRemove';

/** One staged change: a `methodAdd` (compile on the target, no old source) or a
 *  `methodRemove` (delete from the source, no new source). */
export interface PushChange {
  id: string;
  kind: PushChangeKind;
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
export interface PushSkippedMethod {
  selector: string;
  reason: string;
}

/** Preview preconditions. `decline` (a global decline) blocks Apply; `collision` is
 *  always null for push (per-selector collisions ride in `skippedMethods`). */
export interface PushOutOfScope {
  collision: string | null;
  decline: string | null;
}

export interface PushPreviewPage {
  changes: PushChange[];
  nextOffset: number;
  done: boolean;
}

export interface StartPushPreview {
  token: string;
  total: number;
  /** The superclass name for push-up; null for push-down (the method lands in many
   *  subclasses). */
  targetClass: string | null;
  movableCount: number;
  outOfScope: PushOutOfScope;
  skippedMethods: PushSkippedMethod[];
  page: PushPreviewPage;
}

export interface PushApplyResult {
  applied: number;
  failed: { id: string; label: string; error: string }[];
  error?: string;
}

/** One selector's pre-flight verdict. */
export interface PushSelectorAnalysis {
  selector: string;
  decline: string | null;
}

/** The engine pre-flight: the resolved target (superclass name, or null for
 *  push-down), a global decline (if any), the count that will move, and a per-selector
 *  decline. */
export interface PushAnalysis {
  targetClass: string | null;
  globalDecline: string | null;
  movableCount: number;
  selectors: PushSelectorAnalysis[];
}

function asCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

function parseChange(raw: unknown, i: number): PushChange {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Push preview change ${i} is malformed.`);
  }
  const c = raw as Record<string, unknown>;
  if (c.kind !== 'methodAdd' && c.kind !== 'methodRemove') {
    throw new Error(`Push preview change ${i} has an unknown kind: ${String(c.kind)}`);
  }
  if (typeof c.id !== 'string' || typeof c.className !== 'string') {
    throw new Error(`Push preview change ${i} is missing required fields.`);
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

function parsePageObject(env: Record<string, unknown>): PushPreviewPage {
  if (typeof env.error === 'string') throw new Error(env.error);
  if (!Array.isArray(env.changes)) {
    throw new Error('Push preview page is missing its change list.');
  }
  return {
    changes: env.changes.map(parseChange),
    nextOffset: asCount(env.nextOffset),
    done: env.done === true,
  };
}

function parseSkipped(raw: unknown): PushSkippedMethod[] {
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
export function parseAnalysis(json: string): PushAnalysis {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Push analysis did not return an envelope.');
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
export function parseStartPreview(json: string): StartPushPreview {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Push preview did not return a preview envelope.');
  }
  const env = parsed as Record<string, unknown>;
  if (typeof env.token !== 'string') {
    throw new Error('Push preview did not return a session token.');
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

export function parsePage(json: string): PushPreviewPage {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Push preview page did not return an envelope.');
  }
  return parsePageObject(parsed as Record<string, unknown>);
}

export function parseApplyResult(json: string): PushApplyResult {
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

/** A human label for a preview row: "Class[ class]>>selector" tagged with the push
 *  direction (add onto the target / remove from the source). */
export function pushChangeLabel(change: PushChange): string {
  const side = change.isMeta ? ' class' : '';
  const base = `${change.className}${side}>>${change.selector ?? '?'}`;
  return change.kind === 'methodAdd' ? `${base} (add to target)` : `${base} (remove from source)`;
}
