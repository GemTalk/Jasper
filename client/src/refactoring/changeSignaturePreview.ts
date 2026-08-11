import { asCount } from './previewCounts';
/**
 * Pure helpers for the change-method-signature (M5) preview: parsing the
 * server-side engine's combined preview envelope, the pre-flight analysis, and the
 * (newParts, permutation, argNames, defaults) the engine consumes. M5 generalizes
 * R2 (rename method, fixed arity) so the arity can CHANGE — add, remove, or reorder
 * parameters.
 *
 * Kept free of any `vscode` dependency so it unit-tests directly; the VS Code glue
 * (the signature editor, the preview panel, applying the changes) lives in the
 * command and the panel modules.
 *
 * The engine (GsChangeSignatureRefactoring) returns ONE envelope:
 *   {"changes":[ <GsRefactoringChange…> ],
 *    "outOfScope":{"implementors":N,"senders":M,"skipped":K,
 *                  "collision":<null|str>,"decline":<null|str>}}
 * A #methodRename change (an implementor) carries the old selector (in `selector`)
 * and the new selector (in `newSelector`); a #methodRecompile change (a sender)
 * leaves `newSelector` null and keeps its own selector.
 *
 * Unlike R2's OutOfScope, M5's carries a hard `collision` (the new selector is
 * already implemented on the class) and a hard `decline` (e.g. removing a used
 * parameter, or a duplicate argument name). Either blocks Apply, so the command
 * refuses to open the panel when they are non-null.
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
export interface MethodSignatureChange {
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

/** How many implementors/senders fall OUTSIDE the chosen scope (and so will not be
 *  changed), how many in-scope methods could not be rewritten and were skipped, and
 *  the two hard preconditions: `collision` (the new selector already exists on the
 *  class) and `decline` (e.g. removing a used parameter). Both are null when clear;
 *  either, when set, blocks Apply. */
export interface OutOfScopeCounts {
  implementors: number;
  senders: number;
  skipped: number;
  collision: string | null;
  decline: string | null;
}

/** A method the engine could not rewrite (and skipped). `className` carries the
 *  side for a class-side method (e.g. "Foo class"). */
export interface SkippedMethod {
  className: string;
  selector: string;
}

/** One page of a paginated preview: some changes, the offset of the next page, and
 *  whether that was the last page. */
export interface PreviewPage {
  changes: MethodSignatureChange[];
  nextOffset: number;
  done: boolean;
}

/** The result of starting a paginated preview: a session token, the total change
 *  count, the out-of-scope/precondition envelope, and the first page. */
export interface StartPreview {
  token: string;
  total: number;
  outOfScope: OutOfScopeCounts;
  skippedMethods: SkippedMethod[];
  page: PreviewPage;
}

/** The result of a server-side apply. */

/** The pre-flight analysis of the method being edited: enough to pre-populate the
 *  signature editor's rows (current parts + arg names) without parsing on the
 *  client. `decline` is non-null when the method can't be analysed at all (absent /
 *  unparseable). */
export interface SignatureAnalysis {
  selectorKind: 'keyword' | 'unary' | 'binary';
  arity: number;
  argNames: string[];
  decline: string | null;
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Parse one staged change object; throws on a malformed/unknown entry. */
function parseChange(raw: unknown, i: number): MethodSignatureChange {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Change-signature preview change ${i} is malformed.`);
  }
  const c = raw as Record<string, unknown>;
  const kind = c.kind;
  if (kind !== 'methodRename' && kind !== 'methodRecompile') {
    throw new Error(`Change-signature preview change ${i} has an unknown kind: ${String(kind)}`);
  }
  if (
    typeof c.id !== 'string' ||
    typeof c.className !== 'string' ||
    typeof c.newSource !== 'string' ||
    typeof c.oldSource !== 'string'
  ) {
    throw new Error(`Change-signature preview change ${i} is missing required fields.`);
  }
  return {
    id: c.id,
    kind,
    dictName: asStringOrNull(c.dictName),
    className: c.className,
    isMeta: c.isMeta === true,
    selector: asStringOrNull(c.selector),
    newSelector: asStringOrNull(c.newSelector),
    category: asStringOrNull(c.category),
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
    throw new Error('Change-signature preview page is missing its change list.');
  }
  return {
    changes: env.changes.map(parseChange),
    nextOffset: asCount(env.nextOffset),
    done: env.done === true,
  };
}

/** Parse an out-of-scope object (the R2 counts plus M5's collision/decline). */
function parseOutOfScope(v: unknown): OutOfScopeCounts {
  const oos = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  return {
    implementors: asCount(oos.implementors),
    senders: asCount(oos.senders),
    skipped: asCount(oos.skipped),
    collision: asStringOrNull(oos.collision),
    decline: asStringOrNull(oos.decline),
  };
}

/**
 * Parse the start of a paginated preview. Throws if the payload isn't the expected
 * shape — callers surface that as an error. The stone returns a bare error string
 * (e.g. "Class not found: Foo") when it can't build the preview; that fails
 * JSON.parse and is reported as an error.
 */
export function parseStartPreview(json: string): StartPreview {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Change-signature preview did not return a preview envelope.');
  }
  const env = parsed as Record<string, unknown>;
  if (typeof env.token !== 'string') {
    throw new Error('Change-signature preview did not return a session token.');
  }
  const page =
    typeof env.page === 'object' && env.page !== null
      ? parsePageObject(env.page as Record<string, unknown>)
      : { changes: [], nextOffset: 0, done: true };
  return {
    token: env.token,
    total: asCount(env.total),
    outOfScope: parseOutOfScope(env.outOfScope),
    skippedMethods: parseSkipped(env.skippedMethods),
    page,
  };
}

/** Parse a page fetched after the start. Throws on an error/expired envelope. */
export function parsePage(json: string): PreviewPage {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Change-signature preview page did not return an envelope.');
  }
  return parsePageObject(parsed as Record<string, unknown>);
}

/** Parse a server-side apply result. */

/** Parse the pre-flight analysis envelope. Throws on a malformed payload; a bare
 *  error string (JSON.parse failure) surfaces as an error to the caller. */
export function parseAnalysis(json: string): SignatureAnalysis {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Change-signature analysis did not return an envelope.');
  }
  const env = parsed as Record<string, unknown>;
  const kind =
    env.selectorKind === 'unary' || env.selectorKind === 'binary' ? env.selectorKind : 'keyword';
  const argNames = Array.isArray(env.argNames)
    ? env.argNames.filter((n): n is string => typeof n === 'string')
    : [];
  return {
    selectorKind: kind,
    arity: asCount(env.arity),
    argNames,
    decline: asStringOrNull(env.decline),
  };
}

/** A human label for a preview row: "Foo>>bar:baz:" or "Foo class>>bar:baz:". */
export function methodChangeLabel(change: MethodSignatureChange): string {
  const side = change.isMeta ? ' class' : '';
  return `${change.className}${side}>>${change.selector ?? '?'}`;
}

// --- selector shape helpers (shared with R2 — see selectorShape.ts) -----------

// Re-exported (imported at the top) so this module's importers keep a single import
// site; the definitions live in selectorShape.ts, shared with renameMethodPreview.ts
// so they can't drift.
export { isKeywordSelector, isBinarySelector, selectorParts, selectorArgCount, buildSelector };

// --- signature edit model -----------------------------------------------------

/** One row of the signature editor. A row is one selector part; a keyword or
 *  binary part binds an argument (`hasArg`), a unary part does not. `originalIndex`
 *  is the 1-based OLD argument index the row draws from, or 0 for a brand-new
 *  parameter (add). `defaultValue` is the source spliced at send sites for a new
 *  parameter; ignored for a reused one. */
export interface SignatureRow {
  part: string;
  hasArg: boolean;
  argName: string;
  defaultValue: string;
  originalIndex: number;
}

/** The engine arrays the editor emits: the new selector parts in new order, and —
 *  per NEW argument position — the permutation (1-based old index, or 0 for a new
 *  param), the argument name, and the default splice. `permutation`, `newArgNames`,
 *  and `defaults` all have length = new arity (= number of argument-bearing rows);
 *  `newParts` has one entry per row. */
export interface SignatureEdit {
  newParts: string[];
  permutation: number[];
  newArgNames: string[];
  defaults: string[];
}

/**
 * Build the engine arrays from the editor rows. Pure so both the webview script and
 * the tests exercise the same mapping: `newParts` are the row parts in order; the
 * argument arrays are drawn from the argument-bearing rows in order; a reused
 * position contributes an empty default (its old argument expression is kept).
 */
export function buildSignatureEdit(rows: SignatureRow[]): SignatureEdit {
  const argRows = rows.filter((r) => r.hasArg);
  return {
    newParts: rows.map((r) => r.part),
    permutation: argRows.map((r) => r.originalIndex),
    newArgNames: argRows.map((r) => r.argName),
    defaults: argRows.map((r) => (r.originalIndex === 0 ? r.defaultValue : '')),
  };
}

/** True when the permutation is the identity (each new position draws from the old
 *  position at the same index) — i.e. no reorder, add, or remove of arguments. */
export function isIdentityPermutation(permutation: number[]): boolean {
  return permutation.every((v, i) => v === i + 1);
}

/** True when the edit changes nothing: the selector is unchanged AND the arguments
 *  are in their original order with none added or removed. The caller treats this as
 *  a no-op and does nothing. */
export function isNoOpChange(
  newParts: string[],
  permutation: number[],
  oldSelector: string,
): boolean {
  return buildSelector(newParts) === oldSelector && isIdentityPermutation(permutation);
}

/**
 * Validate the proposed new selector parts. Unlike R2 the arity MAY change, so this
 * checks only that the parts form a well-shaped selector: non-empty parts, each
 * keyword part a valid `identifier:`, a unary part a valid identifier, a binary part
 * valid binary characters, and a non-keyword selector a single part. Returns an
 * error string to show inline, or undefined when acceptable.
 */
export function validateSignatureParts(parts: string[], oldSelector: string): string | undefined {
  if (parts.length === 0) return 'A selector needs at least one part.';
  if (parts.some((p) => p.trim().length === 0)) return 'Selector parts cannot be empty.';
  const anyKeyword = parts.some((p) => p.endsWith(':'));
  if (anyKeyword) {
    if (!parts.every((p) => /^[A-Za-z_][A-Za-z0-9_]*:$/.test(p))) {
      return 'Each keyword part must be a letter/underscore, then letters/digits/underscores, ending in a colon.';
    }
  } else if (parts.length === 1) {
    const p = parts[0];
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(p) && !isBinarySelector(p)) {
      return 'A unary selector must be an identifier; a binary selector one or more binary characters.';
    }
  } else {
    return 'A selector with more than one part must use keyword parts (each ending in a colon).';
  }
  if (buildSelector(parts) === oldSelector) {
    // Same selector is fine ONLY when the arguments are being reordered/added/removed
    // (checked by the caller against the permutation); at the string level a same
    // selector with a single part can't be a reorder, so reject it as no-change.
    if (parts.length <= 1) return 'Change the selector or the arguments.';
  }
  return undefined;
}

/** The first duplicate argument name among the new positions, or undefined when all
 *  are distinct. A duplicate would shadow, so the engine declines it; the client
 *  flags it early. */
export function duplicateArgName(argNames: string[]): string | undefined {
  const seen = new Set<string>();
  for (const n of argNames) {
    const name = n.trim();
    if (name.length === 0) continue;
    if (seen.has(name)) return name;
    seen.add(name);
  }
  return undefined;
}
