/**
 * Shared "method-relocation" preview primitives (RB catalog C2). The move-method (M6)
 * and push-up / push-down (M7 / M8) client families model a relocation as a set of
 * `methodAdd` / `methodRemove` changes and speak the SAME paginated preview / apply
 * envelope. This module holds the behaviour-identical parts of that envelope — the
 * change-kind, the base change record, the skipped/out-of-scope/page/apply shapes, and
 * the parsers that read them — so move* and push* do not each carry a copy.
 *
 * The only structural divergence is the per-change payload: push adds a `warning`
 * field (an overwrite data-loss note) that move has no concept of. The change parser is
 * therefore parametrized by an `extend` hook that reads any family-specific fields off
 * the raw record; everything else is fixed. No `vscode` dependency, so it unit-tests
 * directly.
 */

export type MethodChangeKind = 'methodAdd' | 'methodRemove';

/** The fields every relocation change carries, regardless of family. A `methodAdd`
 *  compiles on the target (empty `oldSource` unless it overwrites); a `methodRemove`
 *  deletes from the source (empty `newSource`). */
export interface BaseMethodChange {
  id: string;
  kind: MethodChangeKind;
  dictName: string | null;
  className: string;
  isMeta: boolean;
  selector: string | null;
  category: string | null;
  /** Empty for a fresh `methodAdd` — the diff renders all-added. */
  oldSource: string;
  /** Empty for a `methodRemove` — the diff renders all-removed. */
  newSource: string;
}

/** A selector that will NOT relocate, with the reason. */
export interface RelocationSkippedMethod {
  selector: string;
  reason: string;
}

/** Preview preconditions. `decline` (a global decline) blocks Apply; `collision` is
 *  always null for relocations (per-selector collisions ride in `skippedMethods`). */
export interface RelocationOutOfScope {
  collision: string | null;
  decline: string | null;
}

export interface RelocationPreviewPage<C extends BaseMethodChange> {
  changes: C[];
  nextOffset: number;
  done: boolean;
}

export interface StartRelocationPreview<C extends BaseMethodChange> {
  token: string;
  total: number;
  targetClass: string | null;
  movableCount: number;
  outOfScope: RelocationOutOfScope;
  skippedMethods: RelocationSkippedMethod[];
  page: RelocationPreviewPage<C>;
}

export interface RelocationApplyResult {
  applied: number;
  failed: { id: string; label: string; error: string }[];
  error?: string;
}

/** One selector's pre-flight verdict (the base fields; families may extend it). */
export interface BaseSelectorAnalysis {
  selector: string;
  decline: string | null;
}

/** The engine pre-flight: the resolved target class, a global decline (if any), the
 *  count that will move, and a per-selector verdict. */
export interface RelocationAnalysis<S extends BaseSelectorAnalysis> {
  targetClass: string | null;
  globalDecline: string | null;
  movableCount: number;
  selectors: S[];
}

/**
 * Coerce a JSON value to a non-negative count. Anything that is not a finite, non-negative
 * number -- a non-number, a negative, `NaN`, or `Infinity` -- clamps to `0` (rather than
 * throwing or returning `undefined`), so a malformed engine payload degrades to a zero/empty
 * count instead of crashing the parse.
 */
export function asCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

/**
 * Build a family's change parser. `label` names the family for error messages
 * ("Move" / "Push"); `extend` reads any family-specific fields off the raw record and
 * returns them to be merged onto the base change (e.g. push's `warning`).
 */
export function makeParseChange<C extends BaseMethodChange>(
  label: string,
  extend: (raw: Record<string, unknown>) => Omit<C, keyof BaseMethodChange>,
): (raw: unknown, i: number) => C {
  return (raw: unknown, i: number): C => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error(`${label} preview change ${i} is malformed.`);
    }
    const c = raw as Record<string, unknown>;
    if (c.kind !== 'methodAdd' && c.kind !== 'methodRemove') {
      throw new Error(`${label} preview change ${i} has an unknown kind: ${String(c.kind)}`);
    }
    if (typeof c.id !== 'string' || typeof c.className !== 'string') {
      throw new Error(`${label} preview change ${i} is missing required fields.`);
    }
    const base: BaseMethodChange = {
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
    return { ...base, ...extend(c) } as C;
  };
}

function parsePageObject<C extends BaseMethodChange>(
  label: string,
  parseChange: (raw: unknown, i: number) => C,
  env: Record<string, unknown>,
): RelocationPreviewPage<C> {
  if (typeof env.error === 'string') throw new Error(env.error);
  if (!Array.isArray(env.changes)) {
    throw new Error(`${label} preview page is missing its change list.`);
  }
  return {
    changes: env.changes.map(parseChange),
    nextOffset: asCount(env.nextOffset),
    done: env.done === true,
  };
}

function parseSkipped(raw: unknown): RelocationSkippedMethod[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .map((s) => ({
      selector: typeof s.selector === 'string' ? s.selector : '?',
      reason: typeof s.reason === 'string' ? s.reason : 'cannot move',
    }));
}

/**
 * Build a family's pre-flight-analysis parser. `extendSelector` reads any
 * family-specific per-selector fields (e.g. push's `warning`) off each raw selector.
 * Throws on a bare error string (which fails JSON.parse).
 */
export function makeParseAnalysis<S extends BaseSelectorAnalysis>(
  label: string,
  extendSelector: (raw: Record<string, unknown>) => Omit<S, keyof BaseSelectorAnalysis>,
): (json: string) => RelocationAnalysis<S> {
  return (json: string): RelocationAnalysis<S> => {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${label} analysis did not return an envelope.`);
    }
    const env = parsed as Record<string, unknown>;
    const selectors: S[] = Array.isArray(env.selectors)
      ? env.selectors
          .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
          .map(
            (s) =>
              ({
                selector: typeof s.selector === 'string' ? s.selector : '?',
                decline: typeof s.decline === 'string' ? s.decline : null,
                ...extendSelector(s),
              }) as S,
          )
      : [];
    return {
      targetClass: typeof env.targetClass === 'string' ? env.targetClass : null,
      globalDecline: typeof env.globalDecline === 'string' ? env.globalDecline : null,
      movableCount: asCount(env.movableCount),
      selectors,
    };
  };
}

/** Build a family's start-preview parser. Throws on a malformed payload. */
export function makeParseStartPreview<C extends BaseMethodChange>(
  label: string,
  parseChange: (raw: unknown, i: number) => C,
): (json: string) => StartRelocationPreview<C> {
  return (json: string): StartRelocationPreview<C> => {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${label} preview did not return a preview envelope.`);
    }
    const env = parsed as Record<string, unknown>;
    if (typeof env.token !== 'string') {
      throw new Error(`${label} preview did not return a session token.`);
    }
    const oos =
      typeof env.outOfScope === 'object' && env.outOfScope !== null
        ? (env.outOfScope as Record<string, unknown>)
        : {};
    const page =
      typeof env.page === 'object' && env.page !== null
        ? parsePageObject(label, parseChange, env.page as Record<string, unknown>)
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
  };
}

/** Build a family's page parser. Throws on a malformed payload. */
export function makeParsePage<C extends BaseMethodChange>(
  label: string,
  parseChange: (raw: unknown, i: number) => C,
): (json: string) => RelocationPreviewPage<C> {
  return (json: string): RelocationPreviewPage<C> => {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${label} preview page did not return an envelope.`);
    }
    return parsePageObject(label, parseChange, parsed as Record<string, unknown>);
  };
}

/** Parse an apply result. Identical across families. */
export function parseApplyResult(json: string): RelocationApplyResult {
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

/** The "Class[ class]>>selector" stem shared by every relocation row label. */
export function relocationChangeStem(change: BaseMethodChange): string {
  const side = change.isMeta ? ' class' : '';
  return `${change.className}${side}>>${change.selector ?? '?'}`;
}
