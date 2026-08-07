import { asCount } from './previewCounts';
/**
 * Pure helpers for the extract-superclass refactorings (V6 insert superclass, V7 extract
 * superclass): parsing the engine's member-candidate classification, the pre-flight analysis,
 * the paginated preview envelope, and the apply result. No `vscode` dependency, so it
 * unit-tests directly.
 *
 * The change set is: one `classAdd` (the new superclass, rendered as an all-added definition),
 * a `classDefinitionEdit` per extracted class (re-parented under the new class, hoisted ivars
 * dropped), a `classReparent` per descendant (recompiled only to re-point at its freshly
 * versioned ancestor), plus a `methodAdd` on the new class and a `methodRemove` on each extracted
 * class per hoisted method. The refactoring is all-or-nothing, so every row is a CORE row
 * (checked + disabled).
 */

export type ExtractSuperChangeKind =
  'classAdd' | 'classDefinitionEdit' | 'classReparent' | 'methodAdd' | 'methodRemove';

/** One staged change. `oldSource`/`newSource` are the before/after for the diff. */
export interface ExtractSuperChange {
  id: string;
  kind: ExtractSuperChangeKind;
  dictName: string | null;
  className: string;
  isMeta: boolean;
  selector: string | null;
  category: string | null;
  oldSource: string;
  newSource: string;
}

/** How a hoist candidate classifies across the extracted set. */
export type MemberKind = 'identical' | 'divergent' | 'partial' | 'unhoistable';

export interface MethodCandidate {
  selector: string;
  kind: MemberKind;
  defaultChecked: boolean;
  reason: string | null;
}

export interface InstVarCandidate {
  name: string;
  kind: MemberKind;
  defaultChecked: boolean;
}

/** The classified member candidates the extract checklist renders. */
export interface MemberCandidates {
  decline: string | null;
  sharedParent: string | null;
  methods: MethodCandidate[];
  instVars: InstVarCandidate[];
}

/** Preview preconditions. `decline` (a precondition failure) blocks Apply; `note` explains the
 *  no-instance-migration semantics. */
export interface ExtractSuperOutOfScope {
  decline: string | null;
  note: string | null;
}

export interface ExtractSuperPreviewPage {
  changes: ExtractSuperChange[];
  nextOffset: number;
  done: boolean;
}

export interface StartExtractSuperPreview {
  token: string;
  total: number;
  newClass: string | null;
  sharedParent: string | null;
  outOfScope: ExtractSuperOutOfScope;
  page: ExtractSuperPreviewPage;
}

export interface ExtractSuperApplyResult {
  applied: number;
  failed: { id: string; label: string; error: string }[];
  committed?: boolean;
  error?: string;
}

/** The engine pre-flight: a decline reason (nil when viable), the new class name, the shared
 *  parent, and the number of staged changes. */
export interface ExtractSuperAnalysis {
  decline: string | null;
  newClass: string | null;
  sharedParent: string | null;
  affectedCount: number;
}

const KINDS: ReadonlySet<string> = new Set([
  'classAdd',
  'classDefinitionEdit',
  'classReparent',
  'methodAdd',
  'methodRemove',
]);

function parseChange(raw: unknown, i: number): ExtractSuperChange {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Extract-superclass preview change ${i} is malformed.`);
  }
  const c = raw as Record<string, unknown>;
  if (typeof c.kind !== 'string' || !KINDS.has(c.kind)) {
    throw new Error(
      `Extract-superclass preview change ${i} has an unknown kind: ${String(c.kind)}`,
    );
  }
  if (typeof c.id !== 'string' || typeof c.className !== 'string') {
    throw new Error(`Extract-superclass preview change ${i} is missing required fields.`);
  }
  return {
    id: c.id,
    kind: c.kind as ExtractSuperChangeKind,
    dictName: typeof c.dictName === 'string' ? c.dictName : null,
    className: c.className,
    isMeta: c.isMeta === true,
    selector: typeof c.selector === 'string' ? c.selector : null,
    category: typeof c.category === 'string' ? c.category : null,
    oldSource: typeof c.oldSource === 'string' ? c.oldSource : '',
    newSource: typeof c.newSource === 'string' ? c.newSource : '',
  };
}

function parsePageObject(env: Record<string, unknown>): ExtractSuperPreviewPage {
  if (typeof env.error === 'string') throw new Error(env.error);
  if (!Array.isArray(env.changes)) {
    throw new Error('Extract-superclass preview page is missing its change list.');
  }
  return {
    changes: env.changes.map(parseChange),
    nextOffset: asCount(env.nextOffset),
    done: env.done === true,
  };
}

/** Map the engine's classification onto a MemberKind, FAILING CLOSED.
 *
 *  An unrecognised kind — a classification a future engine grows, or a truncated/garbled payload
 *  — becomes `'unhoistable'`, which `buildMemberPicks` withholds from the checklist. Defaulting
 *  to an offerable kind instead (`'partial'`) would put a member we cannot classify in front of
 *  the user as opt-in-able, without knowing whether it compiles on the new superclass. The worst
 *  case here is a member the user has to hoist another way; the worst case the other way is a
 *  hoist we did not understand. */
function toMemberKind(v: unknown): MemberKind {
  return v === 'identical' || v === 'divergent' || v === 'partial' || v === 'unhoistable'
    ? v
    : 'unhoistable';
}

/** Parse the member-candidate classification. Throws on a bare error string. */
export function parseCandidates(json: string): MemberCandidates {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Extract-superclass candidates did not return an envelope.');
  }
  const env = parsed as Record<string, unknown>;
  const methods = Array.isArray(env.methods)
    ? env.methods
        .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
        .map((m) => ({
          selector: typeof m.selector === 'string' ? m.selector : '?',
          kind: toMemberKind(m.kind),
          defaultChecked: m.defaultChecked === true,
          reason: typeof m.reason === 'string' ? m.reason : null,
        }))
    : [];
  const instVars = Array.isArray(env.instVars)
    ? env.instVars
        .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
        .map((v) => ({
          name: typeof v.name === 'string' ? v.name : '?',
          kind: toMemberKind(v.kind),
          defaultChecked: v.defaultChecked === true,
        }))
    : [];
  return {
    decline: typeof env.decline === 'string' ? env.decline : null,
    sharedParent: typeof env.sharedParent === 'string' ? env.sharedParent : null,
    methods,
    instVars,
  };
}

/** Parse the pre-flight analysis. Throws on a bare error string (which fails JSON.parse). */
export function parseAnalysis(json: string): ExtractSuperAnalysis {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Extract-superclass analysis did not return an envelope.');
  }
  const env = parsed as Record<string, unknown>;
  return {
    decline: typeof env.decline === 'string' ? env.decline : null,
    newClass: typeof env.newClass === 'string' ? env.newClass : null,
    sharedParent: typeof env.sharedParent === 'string' ? env.sharedParent : null,
    affectedCount: asCount(env.affectedCount),
  };
}

/** Parse the start of a paginated preview. Throws on a malformed payload. */
export function parseStartPreview(json: string): StartExtractSuperPreview {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Extract-superclass preview did not return a preview envelope.');
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
      sharedParent: null,
      outOfScope: { decline: env.decline, note: null },
      page: { changes: [], nextOffset: 0, done: true },
    };
  }
  if (typeof env.token !== 'string') {
    throw new Error('Extract-superclass preview did not return a session token.');
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
    sharedParent: typeof env.sharedParent === 'string' ? env.sharedParent : null,
    outOfScope: {
      decline: typeof oos.decline === 'string' ? oos.decline : null,
      note: typeof oos.note === 'string' ? oos.note : null,
    },
    page,
  };
}

export function parsePage(json: string): ExtractSuperPreviewPage {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Extract-superclass preview page did not return an envelope.');
  }
  return parsePageObject(parsed as Record<string, unknown>);
}

export function parseApplyResult(json: string): ExtractSuperApplyResult {
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
    committed: env.committed === true,
    error: typeof env.error === 'string' ? env.error : undefined,
  };
}

/** A human label for a preview row. */
export function extractSuperChangeLabel(change: ExtractSuperChange): string {
  const side = change.isMeta ? ' class' : '';
  if (change.kind === 'classAdd') {
    return `${change.className} (new superclass)`;
  }
  if (change.kind === 'methodAdd') {
    return `${change.className}${side}>>${change.selector ?? '?'} — hoisted up`;
  }
  if (change.kind === 'methodRemove') {
    return `${change.className}${side}>>${change.selector ?? '?'} — hoisted away`;
  }
  if (change.kind === 'classReparent') {
    return `${change.className} (recompiled)`;
  }
  return `${change.className} (definition)`;
}
