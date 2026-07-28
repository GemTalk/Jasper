/**
 * Pure helpers for the instance-variable structure refactorings (V2 push up, V3 push
 * down, V5 convert temporary to instance variable): parsing the engine's pre-flight
 * analysis, the paginated preview envelope, and the apply result. No `vscode`
 * dependency, so it unit-tests directly.
 *
 * Each edits one or more class definitions' own-instVar lists, which means creating new
 * class versions and re-parenting the subtree (there is no addInstVarName:). So the
 * change set is: a `classDefinitionEdit` per edited class (with a before/after definition
 * diff), a `classReparent` per other descendant (recompiled only to re-point at the new
 * parent chain — its definition is unchanged), and, for V5, one `methodRecompile` (the
 * method with the temporary's declaration removed). The refactoring is all-or-nothing, so
 * every row is a CORE row (checked + disabled).
 */

export type IvarChangeKind = 'classDefinitionEdit' | 'classReparent' | 'methodRecompile';

/** One staged change: a class-definition edit, a descendant reparent, or (V5) a method
 *  recompile. `oldSource`/`newSource` are the before/after for the diff. */
export interface IvarChange {
  id: string;
  kind: IvarChangeKind;
  dictName: string | null;
  className: string;
  isMeta: boolean;
  selector: string | null;
  category: string | null;
  oldSource: string;
  newSource: string;
}

/** Preview preconditions. `decline` (a precondition failure) blocks Apply; `note`
 *  explains the reparent + no-instance-migration semantics. */
export interface IvarOutOfScope {
  decline: string | null;
  note: string | null;
}

export interface IvarPreviewPage {
  changes: IvarChange[];
  nextOffset: number;
  done: boolean;
}

export interface StartIvarPreview {
  token: string;
  total: number;
  topClass: string | null;
  outOfScope: IvarOutOfScope;
  page: IvarPreviewPage;
}

export interface IvarApplyResult {
  applied: number;
  failed: { id: string; label: string; error: string }[];
  error?: string;
}

/** The engine pre-flight: a decline reason (nil when viable), the top edited class, and
 *  the number of classes that will be recompiled. */
export interface IvarAnalysis {
  decline: string | null;
  topClass: string | null;
  affectedCount: number;
}

function asCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

function parseChange(raw: unknown, i: number): IvarChange {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`InstVar preview change ${i} is malformed.`);
  }
  const c = raw as Record<string, unknown>;
  if (
    c.kind !== 'classDefinitionEdit' &&
    c.kind !== 'classReparent' &&
    c.kind !== 'methodRecompile'
  ) {
    throw new Error(`InstVar preview change ${i} has an unknown kind: ${String(c.kind)}`);
  }
  if (typeof c.id !== 'string' || typeof c.className !== 'string') {
    throw new Error(`InstVar preview change ${i} is missing required fields.`);
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

function parsePageObject(env: Record<string, unknown>): IvarPreviewPage {
  if (typeof env.error === 'string') throw new Error(env.error);
  if (!Array.isArray(env.changes)) {
    throw new Error('InstVar preview page is missing its change list.');
  }
  return {
    changes: env.changes.map(parseChange),
    nextOffset: asCount(env.nextOffset),
    done: env.done === true,
  };
}

/** Parse the pre-flight analysis. Throws on a bare error string (which fails JSON.parse). */
export function parseAnalysis(json: string): IvarAnalysis {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('InstVar analysis did not return an envelope.');
  }
  const env = parsed as Record<string, unknown>;
  return {
    decline: typeof env.decline === 'string' ? env.decline : null,
    topClass: typeof env.topClass === 'string' ? env.topClass : null,
    affectedCount: asCount(env.affectedCount),
  };
}

/** Parse the start of a paginated preview. Throws on a malformed payload. */
export function parseStartPreview(json: string): StartIvarPreview {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('InstVar preview did not return a preview envelope.');
  }
  const env = parsed as Record<string, unknown>;
  if (typeof env.token !== 'string') {
    throw new Error('InstVar preview did not return a session token.');
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
    topClass: typeof env.topClass === 'string' ? env.topClass : null,
    outOfScope: {
      decline: typeof oos.decline === 'string' ? oos.decline : null,
      note: typeof oos.note === 'string' ? oos.note : null,
    },
    page,
  };
}

export function parsePage(json: string): IvarPreviewPage {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('InstVar preview page did not return an envelope.');
  }
  return parsePageObject(parsed as Record<string, unknown>);
}

export function parseApplyResult(json: string): IvarApplyResult {
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

/** A human label for a preview row. */
export function ivarChangeLabel(change: IvarChange): string {
  const side = change.isMeta ? ' class' : '';
  if (change.kind === 'methodRecompile') {
    return `${change.className}${side}>>${change.selector ?? '?'}`;
  }
  if (change.kind === 'classReparent') {
    return `${change.className} (recompiled)`;
  }
  return `${change.className} (definition)`;
}
