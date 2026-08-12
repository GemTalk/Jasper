/**
 * Pure helpers for the split-class refactoring (V8 / extract class): parsing the source's
 * instance-variable candidates, the pre-flight analysis, the paginated preview envelope, and the
 * apply result. No `vscode` dependency, so it unit-tests directly.
 *
 * The change set is: one `classAdd` (the new component class, rendered as an all-added definition),
 * a `methodAdd` per moved method onto the component, a `classDefinitionEdit` reversioning the source
 * (extracted ivars dropped, the component ivar added), a `classReparent` per descendant, and a
 * `methodAdd` on the source for the lazy accessor + one delegator per moved method. The refactoring
 * is all-or-nothing, so every row is a CORE row (checked + disabled).
 */
import { asCount } from './previewCounts';
import { ApplyResult, parseApplyResultWith } from './previewEnvelope';

export type SplitChangeKind = 'classAdd' | 'classDefinitionEdit' | 'classReparent' | 'methodAdd';

/** One staged change. `oldSource`/`newSource` are the before/after for the diff. */
export interface SplitChange {
  id: string;
  kind: SplitChangeKind;
  dictName: string | null;
  className: string;
  isMeta: boolean;
  selector: string | null;
  category: string | null;
  oldSource: string;
  newSource: string;
}

/** An own instance variable of the source, offered as an extract candidate. */
export interface SplitInstVarCandidate {
  name: string;
}

/** The source's own instance variables the extract checklist renders. */
export interface SplitCandidates {
  sourceClass: string | null;
  instVars: SplitInstVarCandidate[];
}

/** Preview preconditions. `decline` (a precondition failure) blocks Apply; `note` explains the
 *  no-instance-migration semantics. */
export interface SplitOutOfScope {
  decline: string | null;
  note: string | null;
}

export interface SplitPreviewPage {
  changes: SplitChange[];
  nextOffset: number;
  done: boolean;
}

export interface StartSplitPreview {
  token: string;
  total: number;
  newClass: string | null;
  sourceClass: string | null;
  outOfScope: SplitOutOfScope;
  page: SplitPreviewPage;
}

export interface SplitApplyResult extends ApplyResult {
  committed?: boolean;
}

/** The engine pre-flight: a decline reason (nil when viable), the new class name, the source, the
 *  movable-method count, and the number of staged changes. */
export interface SplitAnalysis {
  decline: string | null;
  newClass: string | null;
  sourceClass: string | null;
  movableCount: number;
  affectedCount: number;
}

const KINDS: ReadonlySet<string> = new Set([
  'classAdd',
  'classDefinitionEdit',
  'classReparent',
  'methodAdd',
]);

function parseChange(raw: unknown, i: number): SplitChange {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Split-class preview change ${i} is malformed.`);
  }
  const c = raw as Record<string, unknown>;
  if (typeof c.kind !== 'string' || !KINDS.has(c.kind)) {
    throw new Error(`Split-class preview change ${i} has an unknown kind: ${String(c.kind)}`);
  }
  if (typeof c.id !== 'string' || typeof c.className !== 'string') {
    throw new Error(`Split-class preview change ${i} is missing required fields.`);
  }
  return {
    id: c.id,
    kind: c.kind as SplitChangeKind,
    dictName: typeof c.dictName === 'string' ? c.dictName : null,
    className: c.className,
    isMeta: c.isMeta === true,
    selector: typeof c.selector === 'string' ? c.selector : null,
    category: typeof c.category === 'string' ? c.category : null,
    oldSource: typeof c.oldSource === 'string' ? c.oldSource : '',
    newSource: typeof c.newSource === 'string' ? c.newSource : '',
  };
}

function parsePageObject(env: Record<string, unknown>): SplitPreviewPage {
  if (typeof env.error === 'string') throw new Error(env.error);
  if (!Array.isArray(env.changes)) {
    throw new Error('Split-class preview page is missing its change list.');
  }
  return {
    changes: env.changes.map(parseChange),
    nextOffset: asCount(env.nextOffset),
    done: env.done === true,
  };
}

/** Parse the source's instance-variable candidates. Throws on a bare error string. */
export function parseCandidates(json: string): SplitCandidates {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Split-class candidates did not return an envelope.');
  }
  const env = parsed as Record<string, unknown>;
  const instVars = Array.isArray(env.instVars)
    ? env.instVars
        .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
        // DROP a candidate whose name isn't a string rather than naming it '?'. A placeholder is
        // still pickable in the quick pick and goes straight back to the engine as an extract
        // ivar, landing the user on "Cannot split: ? is not an instance variable of Person."
        .flatMap((v) => (typeof v.name === 'string' ? [{ name: v.name }] : []))
    : [];
  return {
    sourceClass: typeof env.sourceClass === 'string' ? env.sourceClass : null,
    instVars,
  };
}

/** Parse the pre-flight analysis. Throws on a bare error string (which fails JSON.parse). */
export function parseAnalysis(json: string): SplitAnalysis {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Split-class analysis did not return an envelope.');
  }
  const env = parsed as Record<string, unknown>;
  return {
    decline: typeof env.decline === 'string' ? env.decline : null,
    newClass: typeof env.newClass === 'string' ? env.newClass : null,
    sourceClass: typeof env.sourceClass === 'string' ? env.sourceClass : null,
    movableCount: asCount(env.movableCount),
    affectedCount: asCount(env.affectedCount),
  };
}

/** Parse the start of a paginated preview. Throws on a malformed payload. */
export function parseStartPreview(json: string): StartSplitPreview {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Split-class preview did not return a preview envelope.');
  }
  const env = parsed as Record<string, unknown>;
  // A pre-start decline (e.g. the class vanished between pre-flight and start) arrives as a bare
  // `{"decline": …}` envelope with no token. Surface it through outOfScope so the caller's
  // existing decline path handles it.
  if (typeof env.decline === 'string') {
    return {
      token: '',
      total: 0,
      newClass: null,
      sourceClass: null,
      outOfScope: { decline: env.decline, note: null },
      page: { changes: [], nextOffset: 0, done: true },
    };
  }
  if (typeof env.token !== 'string') {
    throw new Error('Split-class preview did not return a session token.');
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
    newClass: typeof env.newClass === 'string' ? env.newClass : null,
    sourceClass: typeof env.sourceClass === 'string' ? env.sourceClass : null,
    outOfScope: {
      decline: typeof oos.decline === 'string' ? oos.decline : null,
      note: typeof oos.note === 'string' ? oos.note : null,
    },
    page,
  };
}

export function parsePage(json: string): SplitPreviewPage {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Split-class preview page did not return an envelope.');
  }
  return parsePageObject(parsed as Record<string, unknown>);
}

export function parseApplyResult(json: string): SplitApplyResult {
  return parseApplyResultWith(json, (env) => ({ committed: env.committed === true }));
}

/** A human label for a preview row. */
export function splitChangeLabel(change: SplitChange): string {
  const side = change.isMeta ? ' class' : '';
  if (change.kind === 'classAdd') {
    return `${change.className} (new class)`;
  }
  if (change.kind === 'methodAdd') {
    return `${change.className}${side}>>${change.selector ?? '?'}`;
  }
  if (change.kind === 'classReparent') {
    return `${change.className} (recompiled)`;
  }
  return `${change.className} (definition)`;
}
