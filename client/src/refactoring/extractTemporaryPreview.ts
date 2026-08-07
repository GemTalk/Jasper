import { asCount } from './previewCounts';
/**
 * Pure helpers for the Extract Temporary (M3) preview: parsing the server-side
 * engine's pre-flight analysis, its paginated preview envelope, and the apply
 * result, plus validating the new name. No `vscode` dependency, so it unit-tests
 * directly.
 *
 * M3 is method-local: the engine (GsExtractTemporaryRefactoring) stages a SINGLE
 * change kind — `methodRecompile`, the one method with the expression extracted to a
 * new temporary. The paginated-envelope shape mirrors the rest of the family.
 *
 * The out-of-scope payload carries two preconditions the panel surfaces: `decline`
 * (the selection is not an extractable expression — a bare variable, an assignment,
 * a whole return, or a multi-statement selection) blocks Apply; `collision` (the new
 * name is already an argument/temporary/ivar/class var/pseudo-variable) also blocks
 * Apply (it would silently shadow).
 */

export type ExtractTemporaryChangeKind = 'methodRecompile';

export interface ExtractTemporaryChange {
  id: string;
  kind: ExtractTemporaryChangeKind;
  dictName: string | null;
  className: string;
  isMeta: boolean;
  selector: string | null;
  category: string | null;
  oldSource: string;
  newSource: string;
}

export interface ExtractTemporaryOutOfScope {
  references: number;
  skipped: number;
  collision: string | null;
  decline: string | null;
}

export interface PreviewPage {
  changes: ExtractTemporaryChange[];
  nextOffset: number;
  done: boolean;
}

/** Pre-flight: how many identical occurrences of the selected expression exist in
 *  scope, and a decline reason if the selection cannot be extracted at all. */
export interface ExtractTemporaryAnalysis {
  occurrenceCount: number;
  decline: string | null;
}

export interface StartExtractTemporaryPreview {
  token: string;
  total: number;
  newName: string;
  occurrenceCount: number;
  outOfScope: ExtractTemporaryOutOfScope;
  page: PreviewPage;
}

export interface ApplyResult {
  applied: number;
  failed: { id: string; label: string; error: string }[];
  error?: string;
}

function parseChange(raw: unknown, i: number): ExtractTemporaryChange {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Extract preview change ${i} is malformed.`);
  }
  const c = raw as Record<string, unknown>;
  if (c.kind !== 'methodRecompile') {
    throw new Error(`Extract preview change ${i} has an unknown kind: ${String(c.kind)}`);
  }
  if (
    typeof c.id !== 'string' ||
    typeof c.className !== 'string' ||
    typeof c.newSource !== 'string' ||
    typeof c.oldSource !== 'string'
  ) {
    throw new Error(`Extract preview change ${i} is missing required fields.`);
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
    throw new Error('Extract preview page is missing its change list.');
  }
  return {
    changes: env.changes.map(parseChange),
    nextOffset: asCount(env.nextOffset),
    done: env.done === true,
  };
}

/** Parse the pre-flight analysis payload. */
export function parseAnalysis(json: string): ExtractTemporaryAnalysis {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Extract pre-flight did not return an analysis envelope.');
  }
  const env = parsed as Record<string, unknown>;
  return {
    occurrenceCount: asCount(env.occurrenceCount),
    decline: typeof env.decline === 'string' ? env.decline : null,
  };
}

/** Parse the start of a paginated preview. Throws on a malformed payload; the stone
 *  returns a bare error string when it can't build the preview, which fails
 *  JSON.parse and is reported as an error. */
export function parseStartPreview(json: string): StartExtractTemporaryPreview {
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
    newName: typeof env.newName === 'string' ? env.newName : '',
    occurrenceCount: asCount(env.occurrenceCount),
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

/** A human label for the preview row: "Foo>>bar" / "Foo class>>bar". */
export function extractTemporaryChangeLabel(change: ExtractTemporaryChange): string {
  const side = change.isMeta ? ' class' : '';
  return `${change.className}${side}>>${change.selector ?? '?'}`;
}

/**
 * Validate a proposed new temporary name. Returns an error string to show inline, or
 * undefined when acceptable. A name is a Smalltalk identifier (conventionally
 * lowercase, but not required). Collisions with existing variables are checked
 * server-side and surfaced through the preview's `collision` reason.
 */
export function validateNewTemporaryName(value: string): string | undefined {
  const name = value.trim();
  if (name.length === 0) return 'Enter a name for the new temporary variable.';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return 'A variable name must be a letter or underscore followed by letters, digits, or underscores.';
  }
  return undefined;
}
