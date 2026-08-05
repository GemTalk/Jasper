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
 * Beyond the rest of the family, this preview surfaces `willNotRecompile` — the methods
 * that reference the removed variable and so will fail to compile onto the new class
 * version (they are dropped, and reported again in the apply result's `dropped`) — plus
 * the migrate / delete-history commit note. Class-creation options are preserved onto the
 * new version by the engine but are not surfaced for editing in the panel.
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

/** A method that will not recompile onto the new class version and will be dropped —
 *  either because it references the variable being REMOVED, or because it declares a
 *  method temporary/argument that the variable being ADDED would shadow. */
export interface BrokenMethod {
  className: string;
  selector: string;
}

/** Preview preconditions + the extra V1 payload. `decline` blocks Apply. */
export interface InstVarOutOfScope {
  decline: string | null;
  willNotRecompile: BrokenMethod[];
  actedOnClass: string | null;
  note: string | null;
  /** `System needsCommit` when the preview was built: the session already holds OTHER
   *  uncommitted work. The committing options commit the whole session transaction, so
   *  that work would ride along — the commit confirmation says so when this is true. */
  sessionHasUncommittedChanges: boolean;
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
  /** Set when a change failed: true if earlier changes were already staged, so the
   *  transaction now holds a PARTIAL reshape. The engine never aborts (that would discard
   *  the user's other in-flight work), so this is what the client's abort advice keys on. */
  partiallyApplied?: boolean;
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
    note: typeof oos.note === 'string' ? oos.note : null,
    // Absent (an older engine) reads as false: no warning rather than a false alarm.
    sessionHasUncommittedChanges: oos.sessionHasUncommittedChanges === true,
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
    // Only meaningful alongside a failure; absent (an older engine) stays undefined so the
    // caller falls back to the conservative "abort it yourself" advice.
    partiallyApplied: typeof env.partiallyApplied === 'boolean' ? env.partiallyApplied : undefined,
  };
}

/** A failure to surface in the preview panel instead of applying. `canAbort` is true when a
 *  partial reshape is stranded in the transaction, so the panel offers an in-place abort. */
export interface ApplyFailure {
  message: string;
  canAbort: boolean;
}

/** Interpret an apply result for display. Returns null on success (something applied, nothing
 *  failed, no whole-apply error); otherwise the failure to show in the panel. The panel aborts
 *  directly (no second confirmation), so when the session also holds the user's other
 *  uncommitted work the message spells out that an abort discards that too.
 *
 *  The engine stops at the first failure and never aborts on its own — aborting would throw away
 *  whatever the user had in flight before starting — so a partial reshape is left in the
 *  transaction for the user to abort or keep. */
export function describeApplyFailure(
  result: ApplyResult,
  sessionHasUncommittedChanges: boolean,
): ApplyFailure | null {
  // A whole-apply error — in practice an expired preview token — answers applied:0 with an empty
  // `failed`, so it parses cleanly. Nothing was staged, so there is nothing to abort.
  if (result.error) {
    return { message: result.error, canAbort: false };
  }
  if (result.failed.length > 0) {
    const first = result.failed[0];
    // Trust the engine's `partiallyApplied`; an older engine omits it, so fall back to the
    // applied count — 0 applied is direct evidence that nothing was staged.
    const staged = result.partiallyApplied ?? result.applied > 0;
    const reason = `Failed: ${first.label}: ${first.error}.`;
    if (!staged) {
      return { message: `${reason} Nothing was applied.`, canAbort: false };
    }
    const one = result.applied === 1;
    const count = `${result.applied} class${one ? '' : 'es'}`;
    if (result.committed) {
      // The structural change was committed BEFORE the failing step (a migrate / delete-history
      // step that raised after the commit). It is permanent — an abort cannot undo a commit — so
      // do not offer one; say what stuck and that the follow-up step is what failed. (Without this
      // branch the "aborting discards them" wording below would be a lie for the committed case.)
      return {
        message:
          `${reason} ${count} ${one ? 'was' : 'were'} already versioned and committed, so an` +
          ` abort cannot undo the change; the failure came from the migrate / delete-history step.` +
          ` Check the stone before retrying.`,
        canAbort: false,
      };
    }
    const left = `${count} ${one ? 'was' : 'were'} already versioned and ${one ? 'remains' : 'remain'} in your transaction.`;
    const cost = sessionHasUncommittedChanges
      ? ` Aborting the transaction discards ${one ? 'it' : 'them'} AND every other uncommitted` +
        ' change in this session.'
      : ` The change is all-or-nothing, so aborting the transaction discards ${one ? 'it' : 'them'}.`;
    return { message: `${reason} ${left}${cost}`, canAbort: true };
  }
  // No error and nothing failed, but nothing applied either — the panel only opens with
  // total > 0 and every change is required, so this is still not a success.
  if (result.applied === 0) {
    return { message: 'Nothing was applied.', canAbort: false };
  }
  return null;
}

/** A human label for a preview row: "Class — edited" or "Class — recompiled". */
export function instVarChangeLabel(change: InstVarChange): string {
  return change.kind === 'classDefinitionEdit'
    ? `${change.className} (definition edited)`
    : `${change.className} (recompiled)`;
}
