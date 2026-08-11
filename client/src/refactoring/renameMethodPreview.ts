import { asCount } from './previewCounts';
/**
 * Pure helpers for the rename-method (R2) preview: parsing the server-side
 * engine's combined preview envelope, ordering the changes for a safe apply,
 * planning the recompile/rename/delete steps, splitting and validating keyword
 * selectors, and deriving the (newParts, permutation) the engine consumes.
 *
 * Kept free of any `vscode` dependency so it unit-tests directly; the VS Code
 * glue (the keyword-part editor, the preview panel, applying the changes) lives
 * in the Explorer command and the panel modules.
 *
 * The engine (GsRenameMethodRefactoring) returns ONE envelope:
 *   {"changes":[ <GsRefactoringChange…> ], "outOfScope":{"implementors":N,"senders":M}}
 * A #methodRename change (an implementor) carries both the old selector (in
 * `selector`) and the new selector (in `newSelector`); a #methodRecompile change
 * (a sender) leaves `newSelector` null and keeps its own selector.
 */

import {
  isKeywordSelector,
  isBinarySelector,
  selectorParts,
  selectorArgCount,
  buildSelector,
} from './selectorShape';
export { parseApplyResult } from './previewEnvelope';
export type { ApplyResult } from './previewEnvelope';

/** One staged change from the engine. `selector` is the old selector for a
 *  methodRename, or the sender's own selector for a methodRecompile. */
export interface MethodRenameChange {
  id: string;
  kind: 'methodRename' | 'methodRecompile';
  dictName: string | null;
  className: string;
  isMeta: boolean;
  selector: string | null;
  newSelector: string | null;
  category: string | null;
  oldSource: string;
  newSource: string;
}

/** True when a change is structural (always applied, cannot be deselected).
 *  An implementor's rename must happen while its senders are rewritten:
 *  rewriting every call site to the new selector but leaving one implementor
 *  under the old one silently changes dispatch (instances fall through to an
 *  inherited method, or DNU). The panel renders such a change checked and
 *  DISABLED, and a disabled checkbox is never reported as deselected to the
 *  engine. Senders (methodRecompile) stay individually deselectable. */
export function isStructuralChange(change: MethodRenameChange): boolean {
  return change.kind === 'methodRename';
}

/** How many implementors/senders fall OUTSIDE the chosen scope (and so will not
 *  be changed), plus how many in-scope methods could not be rewritten and were
 *  skipped (a source the vendored AST does not accept). Surfaced as a warning in
 *  the preview. */
export interface OutOfScopeCounts {
  implementors: number;
  senders: number;
  skipped: number;
}

/** A method the engine could not rewrite (and skipped). `className` carries the
 *  side for a class-side method (e.g. "Foo class"). */
export interface SkippedMethod {
  className: string;
  selector: string;
}

/** One page of a paginated preview: some changes, the offset of the next page,
 *  and whether that was the last page. */
export interface PreviewPage {
  changes: MethodRenameChange[];
  nextOffset: number;
  done: boolean;
}

/** The result of starting a paginated preview: a session token (for later pages
 *  and the apply), the total change count, the out-of-scope/skipped warnings, and
 *  the first page. */
export interface StartPreview {
  token: string;
  total: number;
  outOfScope: OutOfScopeCounts;
  skippedMethods: SkippedMethod[];
  page: PreviewPage;
}

/** The result of a server-side apply. */

/** Parse one staged change object; throws on a malformed/unknown entry. */
function parseChange(raw: unknown, i: number): MethodRenameChange {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Rename preview change ${i} is malformed.`);
  }
  const c = raw as Record<string, unknown>;
  const kind = c.kind;
  if (kind !== 'methodRename' && kind !== 'methodRecompile') {
    throw new Error(`Rename preview change ${i} has an unknown kind: ${String(kind)}`);
  }
  if (
    typeof c.id !== 'string' ||
    typeof c.className !== 'string' ||
    typeof c.newSource !== 'string' ||
    typeof c.oldSource !== 'string'
  ) {
    throw new Error(`Rename preview change ${i} is missing required fields.`);
  }
  return {
    id: c.id,
    kind,
    dictName: typeof c.dictName === 'string' ? c.dictName : null,
    className: c.className,
    isMeta: c.isMeta === true,
    selector: typeof c.selector === 'string' ? c.selector : null,
    newSelector: typeof c.newSelector === 'string' ? c.newSelector : null,
    category: typeof c.category === 'string' ? c.category : null,
    oldSource: c.oldSource,
    newSource: c.newSource,
  };
}

function parseSkipped(v: unknown): SkippedMethod[] {
  return Array.isArray(v)
    ? v
        .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
        .map((m) => ({
          className: typeof m.class === 'string' ? m.class : '?',
          selector: typeof m.selector === 'string' ? m.selector : '?',
        }))
    : [];
}

/** Parse a page object (the shared shape of a start's `page` and a `pageFor:`
 *  result). Throws on the engine's error/expired envelope. */
function parsePageObject(env: Record<string, unknown>): PreviewPage {
  if (typeof env.error === 'string') throw new Error(env.error);
  if (!Array.isArray(env.changes)) {
    throw new Error('Rename preview page is missing its change list.');
  }
  return {
    changes: env.changes.map(parseChange),
    nextOffset: asCount(env.nextOffset),
    done: env.done === true,
  };
}

/**
 * Parse the start of a paginated preview. Throws if the payload isn't the
 * expected shape — callers surface that as an error. The stone returns a bare
 * error string (e.g. "Class not found: Foo") when it can't build the preview;
 * that fails JSON.parse and is reported as an error.
 */
export function parseStartPreview(json: string): StartPreview {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Rename preview did not return a preview envelope.');
  }
  const env = parsed as Record<string, unknown>;
  if (typeof env.token !== 'string') {
    throw new Error('Rename preview did not return a session token.');
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
    outOfScope: {
      implementors: asCount(oos.implementors),
      senders: asCount(oos.senders),
      skipped: asCount(oos.skipped),
    },
    skippedMethods: parseSkipped(env.skippedMethods),
    page,
  };
}

/** Parse a page fetched after the start. Throws on an error/expired envelope. */
export function parsePage(json: string): PreviewPage {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Rename preview page did not return an envelope.');
  }
  return parsePageObject(parsed as Record<string, unknown>);
}

/** Parse a server-side apply result. */

/** A human label for a preview row: "Foo>>bar:baz:" or "Foo class>>bar:baz:". */
export function methodChangeLabel(change: MethodRenameChange): string {
  const side = change.isMeta ? ' class' : '';
  return `${change.className}${side}>>${change.selector ?? '?'}`;
}

// --- selector shape helpers (shared with M5 — see selectorShape.ts) -----------

// Re-exported (imported at the top) so this module's importers keep a single import
// site; the definitions live in selectorShape.ts, shared with changeSignaturePreview.ts
// so the two refactorings can't drift.
export { isKeywordSelector, isBinarySelector, selectorParts, selectorArgCount, buildSelector };

/**
 * Validate the proposed new keyword parts against the old selector. Returns an
 * error string to show inline, or undefined when acceptable. Arity-preserving:
 * the number of parts must match the old selector's, each keyword part must be a
 * valid `identifier:`, a unary part a valid identifier, a binary part valid
 * binary characters. The result must differ from the old selector.
 */
export function validateNewParts(parts: string[], oldSelector: string): string | undefined {
  const oldParts = selectorParts(oldSelector);
  if (parts.length !== oldParts.length) {
    return `A rename must keep ${oldParts.length} selector part${oldParts.length === 1 ? '' : 's'}.`;
  }
  if (parts.some((p) => p.trim().length === 0)) return 'Selector parts cannot be empty.';
  if (isKeywordSelector(oldSelector)) {
    if (!parts.every((p) => /^[A-Za-z_][A-Za-z0-9_]*:$/.test(p))) {
      return 'Each keyword part must be a letter/underscore, then letters/digits/underscores, ending in a colon.';
    }
  } else if (isBinarySelector(oldSelector)) {
    if (!isBinarySelector(parts[0]))
      return 'A binary selector must be one or more binary characters.';
  } else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(parts[0])) {
    return 'A unary selector must be a letter or underscore followed by letters, digits, or underscores.';
  }
  const oldSel = buildSelector(oldParts);
  const newSel = buildSelector(parts);
  // Identity is allowed silently only if there is also a reorder; the caller
  // treats "same selector, identity permutation" as no-op. Here we only reject
  // an empty change at the string level when it also can't be a reorder.
  if (newSel === oldSel && oldParts.length <= 1) {
    return 'Enter a different selector.';
  }
  return undefined;
}

/**
 * The engine's permutation: for each NEW argument position, the 1-based OLD
 * argument index it draws from (permutation at: newIndex = oldArgIndex). Given
 * the editor's row order — each row carrying the original 1-based index of the
 * argument it started paired with — this is just those indices in row order.
 * Unary selectors have no arguments, so the permutation is empty.
 */
export function permutationFromOriginalIndices(originalIndices: number[]): number[] {
  return [...originalIndices];
}

/**
 * Best-effort extraction of a method's argument names from its source, for
 * display in the keyword-part editor (so each keyword row shows the argument it
 * binds). Returns names in declaration order; falls back to `arg1..argN` when the
 * signature can't be parsed. Display-only — the permutation is driven by the
 * argument's original index, not its name, so a wrong label can't corrupt a
 * rename.
 */
export function parseArgNames(source: string, oldSelector: string): string[] {
  const n = selectorArgCount(oldSelector);
  if (n === 0) return [];
  if (isKeywordSelector(oldSelector)) {
    const names: string[] = [];
    const re = /[A-Za-z_]\w*:\s*([A-Za-z_]\w*)/g;
    let m: RegExpExecArray | null;
    while (names.length < n && (m = re.exec(source)) !== null) names.push(m[1]);
    if (names.length === n) return names;
  } else if (isBinarySelector(oldSelector)) {
    const m = source.match(/^\s*[-+*/~<>=&|@%,?!]+\s*([A-Za-z_]\w*)/);
    if (m) return [m[1]];
  }
  return Array.from({ length: n }, (_, i) => `arg${i + 1}`);
}
