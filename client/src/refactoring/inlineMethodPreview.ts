/**
 * Pure helpers for the inline-method (M2) preview: parsing the engine's pre-flight
 * analysis, the paginated preview envelope, and the apply result. No `vscode`
 * dependency, so it unit-tests directly.
 *
 * M2 stages ONE core change — a `methodRecompile` of the caller with the send
 * inlined — followed, ONLY when the inlined call was the target method's last
 * sender, by a single deselectable `methodRemove` that deletes the now-unused
 * target. The recompile always applies; the removal can be unchecked to keep the
 * method.
 *
 * The out-of-scope payload carries one precondition the client surfaces: `decline`
 * (a hard precondition — the send cannot be inlined; blocks Apply). Inlining
 * introduces no shadowing, so `collision` is always null.
 */

export type InlineChangeKind = 'methodRecompile' | 'methodRemove';

/** One staged change: the rewritten caller (`methodRecompile`) or the removal of
 *  the now-unused target (`methodRemove`, no new source). */
export interface InlineChange {
  id: string;
  kind: InlineChangeKind;
  dictName: string | null;
  className: string;
  isMeta: boolean;
  selector: string | null;
  category: string | null;
  oldSource: string;
  /** Empty for a `methodRemove` (the method is deleted), so the diff renders as an
   *  all-removed method. */
  newSource: string;
}

/** Preview preconditions. `decline` blocks Apply (hard); `collision` is always null
 *  for inline. */
export interface InlineOutOfScope {
  collision: string | null;
  decline: string | null;
}

export interface PreviewPage {
  changes: InlineChange[];
  nextOffset: number;
  done: boolean;
}

export interface StartInlinePreview {
  token: string;
  total: number;
  targetSelector: string | null;
  lastSender: boolean;
  outOfScope: InlineOutOfScope;
  page: PreviewPage;
}

export interface ApplyResult {
  applied: number;
  failed: { id: string; label: string; error: string }[];
  error?: string;
}

/** The engine pre-flight: the class + selector the send resolves to, whether the
 *  inlined call is the target's last sender (so a delete will be offered), and a
 *  hard decline reason if the send cannot be inlined. */
export interface InlineAnalysis {
  targetClass: string | null;
  targetSelector: string | null;
  lastSender: boolean;
  decline: string | null;
}

function asCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

function parseChange(raw: unknown, i: number): InlineChange {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Inline preview change ${i} is malformed.`);
  }
  const c = raw as Record<string, unknown>;
  if (c.kind !== 'methodRecompile' && c.kind !== 'methodRemove') {
    throw new Error(`Inline preview change ${i} has an unknown kind: ${String(c.kind)}`);
  }
  if (typeof c.id !== 'string' || typeof c.className !== 'string') {
    throw new Error(`Inline preview change ${i} is missing required fields.`);
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
    throw new Error('Inline preview page is missing its change list.');
  }
  return {
    changes: env.changes.map(parseChange),
    nextOffset: asCount(env.nextOffset),
    done: env.done === true,
  };
}

/** Parse the pre-flight analysis payload. Throws on a bare error string (which
 *  fails JSON.parse). */
export function parseAnalysis(json: string): InlineAnalysis {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Inline analysis did not return an envelope.');
  }
  const env = parsed as Record<string, unknown>;
  return {
    targetClass: typeof env.targetClass === 'string' ? env.targetClass : null,
    targetSelector: typeof env.targetSelector === 'string' ? env.targetSelector : null,
    lastSender: env.lastSender === true,
    decline: typeof env.decline === 'string' ? env.decline : null,
  };
}

/** Parse the start of a paginated preview. Throws on a malformed payload. */
export function parseStartPreview(json: string): StartInlinePreview {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Inline preview did not return a preview envelope.');
  }
  const env = parsed as Record<string, unknown>;
  if (typeof env.token !== 'string') {
    throw new Error('Inline preview did not return a session token.');
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
    targetSelector: typeof env.targetSelector === 'string' ? env.targetSelector : null,
    lastSender: env.lastSender === true,
    outOfScope: {
      collision: typeof oos.collision === 'string' ? oos.collision : null,
      decline: typeof oos.decline === 'string' ? oos.decline : null,
    },
    page,
  };
}

export function parsePage(json: string): PreviewPage {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Inline preview page did not return an envelope.');
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

/** A human label for a preview row. The rewritten caller renders as
 *  "Class>>selector"; the target removal is tagged "(remove — last sender)". */
export function inlineChangeLabel(change: InlineChange): string {
  const side = change.isMeta ? ' class' : '';
  const base = `${change.className}${side}>>${change.selector ?? '?'}`;
  return change.kind === 'methodRemove' ? `${base} (remove — last sender)` : base;
}

/** The single CORE change (the caller recompile) is always staged first and must
 *  not be deselectable; a later `methodRemove` (offered only when last-sender) can
 *  be unchecked to keep the target. */
export function isCoreChange(index: number): boolean {
  return index < 1;
}
