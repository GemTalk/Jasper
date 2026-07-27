/**
 * Pure helpers for the Inline Temporary (M4) preview: parsing the server-side
 * engine's pre-flight analysis, its paginated preview envelope, and the apply
 * result. No `vscode` dependency, so it unit-tests directly.
 *
 * M4 is method-local: the engine (GsInlineTemporaryRefactoring) stages a SINGLE
 * change kind — `methodRecompile`, the one method with the temporary inlined. There
 * is no class-definition edit and no cross-method scan.
 *
 * The out-of-scope payload carries the `decline` precondition the panel surfaces and
 * refuses to apply on: the target is not an inlinable temporary — an argument, an
 * instance/class variable, a global, a temp assigned more than once or never, read
 * before assignment, or a non-atomic value read more than once. Inlining introduces
 * no shadowing, so `collision` is always null.
 */

export type InlineTemporaryChangeKind = 'methodRecompile';

export interface InlineTemporaryChange {
  id: string;
  kind: InlineTemporaryChangeKind;
  dictName: string | null;
  className: string;
  isMeta: boolean;
  selector: string | null;
  category: string | null;
  oldSource: string;
  newSource: string;
}

export interface InlineTemporaryOutOfScope {
  references: number;
  skipped: number;
  collision: string | null;
  decline: string | null;
}

export interface PreviewPage {
  changes: InlineTemporaryChange[];
  nextOffset: number;
  done: boolean;
}

/** Pre-flight: the temporary's name (or null on decline) and a decline reason if it
 *  cannot be inlined. */
export interface InlineTemporaryAnalysis {
  name: string | null;
  decline: string | null;
}

export interface StartInlineTemporaryPreview {
  token: string;
  total: number;
  name: string;
  outOfScope: InlineTemporaryOutOfScope;
  page: PreviewPage;
}

export interface ApplyResult {
  applied: number;
  failed: { id: string; label: string; error: string }[];
  error?: string;
}

function asCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

function parseChange(raw: unknown, i: number): InlineTemporaryChange {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Inline preview change ${i} is malformed.`);
  }
  const c = raw as Record<string, unknown>;
  if (c.kind !== 'methodRecompile') {
    throw new Error(`Inline preview change ${i} has an unknown kind: ${String(c.kind)}`);
  }
  if (
    typeof c.id !== 'string' ||
    typeof c.className !== 'string' ||
    typeof c.newSource !== 'string' ||
    typeof c.oldSource !== 'string'
  ) {
    throw new Error(`Inline preview change ${i} is missing required fields.`);
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
    throw new Error('Inline preview page is missing its change list.');
  }
  return {
    changes: env.changes.map(parseChange),
    nextOffset: asCount(env.nextOffset),
    done: env.done === true,
  };
}

/** Parse the pre-flight analysis payload. */
export function parseAnalysis(json: string): InlineTemporaryAnalysis {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Inline pre-flight did not return an analysis envelope.');
  }
  const env = parsed as Record<string, unknown>;
  return {
    name: typeof env.name === 'string' ? env.name : null,
    decline: typeof env.decline === 'string' ? env.decline : null,
  };
}

/** Parse the start of a paginated preview. */
export function parseStartPreview(json: string): StartInlineTemporaryPreview {
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
    name: typeof env.name === 'string' ? env.name : '',
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

/** A human label for the preview row: "Foo>>bar" / "Foo class>>bar". */
export function inlineTemporaryChangeLabel(change: InlineTemporaryChange): string {
  const side = change.isMeta ? ' class' : '';
  return `${change.className}${side}>>${change.selector ?? '?'}`;
}
