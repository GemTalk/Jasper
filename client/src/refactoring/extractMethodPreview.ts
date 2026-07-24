/**
 * Pure helpers for the extract-method (M1) preview: parsing the engine's
 * pre-flight analysis, the paginated preview envelope, and the apply result, plus
 * validating the new selector against the required argument count. No `vscode`
 * dependency, so it unit-tests directly.
 *
 * M1 stages two CORE changes — a `methodAdd` (the extracted method) and a
 * `methodRecompile` (the rewritten original) — followed, when the user opted into
 * "replace similar code" and the extraction is a safe void shape, by one
 * deselectable `methodRecompile` per structurally-equivalent site. The core two are
 * always applied; only the duplicate replacements can be deselected.
 *
 * The out-of-scope payload carries two preconditions the client surfaces:
 * `decline` (a hard precondition — the selection cannot be extracted; blocks Apply)
 * and `collision` (a SOFT warning — the new selector already exists in the
 * hierarchy; shown but does NOT block).
 */

export type ExtractChangeKind = 'methodAdd' | 'methodRecompile';

/** One staged change: the new method (`methodAdd`, no old source), the rewritten
 *  original, or a replaced duplicate site (both `methodRecompile`). */
export interface ExtractChange {
  id: string;
  kind: ExtractChangeKind;
  dictName: string | null;
  className: string;
  isMeta: boolean;
  selector: string | null;
  category: string | null;
  /** Empty for a `methodAdd` (the method did not exist), so the diff renders as an
   *  all-added method. */
  oldSource: string;
  newSource: string;
}

/** Preview preconditions. `decline` blocks Apply (hard); `collision` is a soft,
 *  non-blocking hierarchy warning. */
export interface ExtractOutOfScope {
  collision: string | null;
  decline: string | null;
}

export interface PreviewPage {
  changes: ExtractChange[];
  nextOffset: number;
  done: boolean;
}

export interface StartExtractPreview {
  token: string;
  total: number;
  newSelector: string;
  outOfScope: ExtractOutOfScope;
  page: PreviewPage;
}

export interface ApplyResult {
  applied: number;
  failed: { id: string; label: string; error: string }[];
  error?: string;
}

/** The engine pre-flight: how many arguments the selection needs (and their
 *  names), whether it returns a value, whether it is a replace-similar-eligible
 *  void shape, and a hard decline reason if the selection cannot be extracted. */
export interface ExtractAnalysis {
  argCount: number;
  argNames: string[];
  returnVar: string | null;
  safeVoidShape: boolean;
  decline: string | null;
}

function asCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

function parseChange(raw: unknown, i: number): ExtractChange {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Extract preview change ${i} is malformed.`);
  }
  const c = raw as Record<string, unknown>;
  if (c.kind !== 'methodAdd' && c.kind !== 'methodRecompile') {
    throw new Error(`Extract preview change ${i} has an unknown kind: ${String(c.kind)}`);
  }
  if (
    typeof c.id !== 'string' ||
    typeof c.className !== 'string' ||
    typeof c.newSource !== 'string'
  ) {
    throw new Error(`Extract preview change ${i} is missing required fields.`);
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
    newSource: c.newSource,
  };
}

function parsePageObject(env: Record<string, unknown>): PreviewPage {
  if (typeof env.error === 'string') throw new Error(env.error);
  if (!Array.isArray(env.changes)) {
    throw new Error('Extract preview page is missing its change list.');
  }
  return {
    changes: env.changes.map(parseChange),
    nextOffset: asCount(env.nextOffset),
    done: env.done === true,
  };
}

/** Parse the pre-flight analysis payload. Throws on a bare error string (e.g.
 *  "Class not found: Foo"), which fails JSON.parse. */
export function parseAnalysis(json: string): ExtractAnalysis {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Extract analysis did not return an envelope.');
  }
  const env = parsed as Record<string, unknown>;
  return {
    argCount: asCount(env.argCount),
    argNames: Array.isArray(env.argNames)
      ? env.argNames.filter((n): n is string => typeof n === 'string')
      : [],
    returnVar: typeof env.returnVar === 'string' ? env.returnVar : null,
    safeVoidShape: env.safeVoidShape === true,
    decline: typeof env.decline === 'string' ? env.decline : null,
  };
}

/** Parse the start of a paginated preview. Throws on a malformed payload. */
export function parseStartPreview(json: string): StartExtractPreview {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Extract preview did not return a preview envelope.');
  }
  const env = parsed as Record<string, unknown>;
  if (typeof env.token !== 'string') {
    throw new Error('Extract preview did not return a session token.');
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
    newSelector: typeof env.newSelector === 'string' ? env.newSelector : '',
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
    throw new Error('Extract preview page did not return an envelope.');
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

/** A human label for a preview row. The extracted method (`methodAdd`) is tagged
 *  "(new method)"; the rewritten original and any replaced duplicate render as
 *  "Class>>selector". */
export function extractChangeLabel(change: ExtractChange): string {
  const side = change.isMeta ? ' class' : '';
  const base = `${change.className}${side}>>${change.selector ?? '?'}`;
  return change.kind === 'methodAdd' ? `${base} (new method)` : base;
}

/** The two CORE changes (the new method + the rewritten original) are always the
 *  first two staged and must not be deselectable; only later duplicate-replacement
 *  changes can be unchecked. */
export function isCoreChange(index: number): boolean {
  return index < 2;
}

/** The arity a selector encodes: unary → 0, binary → 1, keyword → number of
 *  colons; -1 when the string is not a valid selector. */
export function selectorArity(sel: string): number {
  const s = sel.trim();
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return 0; // unary
  if (/^[-+*/~<>=&|@%,?!]+$/.test(s)) return 1; // binary
  if (/^([A-Za-z_][A-Za-z0-9_]*:)+$/.test(s)) return (s.match(/:/g) ?? []).length; // keyword
  return -1;
}

/**
 * Validate a proposed new selector for an extraction needing `argCount` arguments.
 * Returns an inline error, or undefined when acceptable: it must be a syntactically
 * valid selector whose arity equals `argCount` (0 args ⇒ unary, 1 ⇒ binary or a
 * single keyword, N ⇒ an N-keyword selector). Collisions with existing selectors
 * are a soft, server-side warning, not a validation error.
 */
export function validateNewSelector(
  value: string,
  argCount: number,
  sourceSelector?: string,
): string | undefined {
  const sel = value.trim();
  if (sel.length === 0) return 'Enter a selector for the new method.';
  if (sourceSelector !== undefined && sel === sourceSelector) {
    return `The new method must have a different selector than ${sourceSelector}, the method you are extracting from.`;
  }
  const arity = selectorArity(sel);
  if (arity < 0) return 'That is not a valid Smalltalk selector.';
  if (arity !== argCount) {
    return argCount === 0
      ? `The selection needs no arguments, so use a unary selector (got ${arity}).`
      : `The selection needs ${argCount} argument${argCount === 1 ? '' : 's'}, so the selector must take ${argCount} (got ${arity}).`;
  }
  return undefined;
}
