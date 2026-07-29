/**
 * Pure helpers for the add / remove instance-variable (V1) preview: parsing the engine's
 * pre-flight analysis, the paginated preview envelope, and the apply result. No `vscode`
 * dependency, so it unit-tests directly.
 *
 * The engine stages a `classDefinitionEdit` for each edited class (the class gains or
 * loses the variable) plus a `classReparent` for every other affected class (recompiled
 * only to re-point at the freshly created parent version). The whole change is
 * ALL-OR-NOTHING: the class-shape edits and the descendant reparents must move together,
 * so every row is a required (checked + disabled) row and the deselected set is always
 * empty.
 *
 * Two things this preview surfaces beyond the rest of the family:
 *   - `willNotRecompile` — the methods that reference the removed variable and so will
 *     fail to compile onto the new class version (they are dropped, and reported again in
 *     the apply result's `dropped`);
 *   - the acted-on class's `currentOptions` + the `optionVocabulary`, driving the
 *     editable class-options group, plus the migrate / delete-history commit note.
 */

export type InstVarChangeKind = 'classDefinitionEdit' | 'classReparent';

/** One staged change: a class-definition edit (own-ivar list changes) or a reparent. */
export interface InstVarChange {
  id: string;
  kind: InstVarChangeKind;
  dictName: string | null;
  className: string;
  oldSource: string;
  newSource: string;
}

/** A method that will not recompile onto the new class version (it references the
 *  removed variable) and will be dropped. */
export interface BrokenMethod {
  className: string;
  selector: string;
}

/** Preview preconditions + the extra V1 payload. `decline` blocks Apply. */
export interface InstVarOutOfScope {
  decline: string | null;
  willNotRecompile: BrokenMethod[];
  actedOnClass: string | null;
  currentOptions: string[];
  optionVocabulary: string[];
  note: string | null;
}

export interface PreviewPage {
  changes: InstVarChange[];
  nextOffset: number;
  done: boolean;
}

export interface StartInstVarPreview {
  token: string;
  total: number;
  sourceClass: string | null;
  outOfScope: InstVarOutOfScope;
  page: PreviewPage;
}

export interface ApplyResult {
  applied: number;
  failed: { id: string; label: string; error: string }[];
  dropped: BrokenMethod[];
  committed: boolean;
  error?: string;
}

export interface InstVarAnalysis {
  decline: string | null;
  operation: string | null;
  sourceClass: string | null;
  affectedCount: number;
  willNotRecompileCount: number;
}

function asCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
}

function parseBroken(raw: unknown): BrokenMethod[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
    .map((m) => ({
      className: typeof m.class === 'string' ? m.class : '?',
      selector: typeof m.selector === 'string' ? m.selector : '?',
    }));
}

function parseChange(raw: unknown, i: number): InstVarChange {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Instance-variable preview change ${i} is malformed.`);
  }
  const c = raw as Record<string, unknown>;
  if (c.kind !== 'classDefinitionEdit' && c.kind !== 'classReparent') {
    throw new Error(`Instance-variable preview change ${i} has an unknown kind: ${String(c.kind)}`);
  }
  if (typeof c.id !== 'string' || typeof c.className !== 'string') {
    throw new Error(`Instance-variable preview change ${i} is missing required fields.`);
  }
  return {
    id: c.id,
    kind: c.kind,
    dictName: typeof c.dictName === 'string' ? c.dictName : null,
    className: c.className,
    oldSource: typeof c.oldSource === 'string' ? c.oldSource : '',
    newSource: typeof c.newSource === 'string' ? c.newSource : '',
  };
}

function parsePageObject(env: Record<string, unknown>): PreviewPage {
  if (typeof env.error === 'string') throw new Error(env.error);
  if (!Array.isArray(env.changes)) {
    throw new Error('Instance-variable preview page is missing its change list.');
  }
  return {
    changes: env.changes.map(parseChange),
    nextOffset: asCount(env.nextOffset),
    done: env.done === true,
  };
}

function parseOutOfScope(raw: unknown): InstVarOutOfScope {
  const oos = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    decline: typeof oos.decline === 'string' ? oos.decline : null,
    willNotRecompile: parseBroken(oos.willNotRecompile),
    actedOnClass: typeof oos.actedOnClass === 'string' ? oos.actedOnClass : null,
    currentOptions: asStringArray(oos.currentOptions),
    optionVocabulary: asStringArray(oos.optionVocabulary),
    note: typeof oos.note === 'string' ? oos.note : null,
  };
}

/** Parse the pre-flight analysis payload. Throws on a bare error string. */
export function parseAnalysis(json: string): InstVarAnalysis {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Instance-variable analysis did not return an envelope.');
  }
  const env = parsed as Record<string, unknown>;
  return {
    decline: typeof env.decline === 'string' ? env.decline : null,
    operation: typeof env.operation === 'string' ? env.operation : null,
    sourceClass: typeof env.sourceClass === 'string' ? env.sourceClass : null,
    affectedCount: asCount(env.affectedCount),
    willNotRecompileCount: asCount(env.willNotRecompileCount),
  };
}

/** Parse the start of a paginated preview. Throws on a malformed payload. */
export function parseStartPreview(json: string): StartInstVarPreview {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Instance-variable preview did not return a preview envelope.');
  }
  const env = parsed as Record<string, unknown>;
  if (typeof env.token !== 'string') {
    throw new Error('Instance-variable preview did not return a session token.');
  }
  const page =
    typeof env.page === 'object' && env.page !== null
      ? parsePageObject(env.page as Record<string, unknown>)
      : { changes: [], nextOffset: 0, done: true };
  return {
    token: env.token,
    total: asCount(env.total),
    sourceClass: typeof env.sourceClass === 'string' ? env.sourceClass : null,
    outOfScope: parseOutOfScope(env.outOfScope),
    page,
  };
}

export function parsePage(json: string): PreviewPage {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Instance-variable preview page did not return an envelope.');
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
    dropped: parseBroken(env.dropped),
    committed: env.committed === true,
    error: typeof env.error === 'string' ? env.error : undefined,
  };
}

/** A human label for a preview row: "Class — edited" or "Class — recompiled". */
export function instVarChangeLabel(change: InstVarChange): string {
  return change.kind === 'classDefinitionEdit'
    ? `${change.className} (definition edited)`
    : `${change.className} (recompiled)`;
}
