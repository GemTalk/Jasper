import { QueryExecutor } from '../../queries/types';
import { classLookupExpr, escapeString } from '../../queries/util';
import { recordedApplyExpr } from './undoRecording';

/** An executor whose result is fetched asynchronously (non-blocking GCI), so a
 *  slow build shows progress and keeps the extension host responsive. */
export type AsyncQueryExecutor = (label: string, code: string) => Promise<string>;

// The scope a rename-method preview runs in. #class / #hierarchy / #wholeSystem
// take no argument; #dictionary names a single SymbolDictionary.
export type RenameMethodScope =
  { kind: 'class' | 'hierarchy' | 'wholeSystem' } | { kind: 'dictionary'; dictName: string };

// Target page size (bytes of change JSON) for a paginated preview. The engine
// accumulates changes until roughly this many bytes (plus the one change that
// crosses the threshold), so a page stays safely under the non-blocking GCI
// fetch cap (256 KB) even when a method's source is large.
export const PREVIEW_PAGE_BYTES = 150 * 1024;

function scopeClauseOf(scope: RenameMethodScope): string {
  return scope.kind === 'dictionary'
    ? `dictionaryScope: '${escapeString(scope.dictName)}'`
    : `scope: #${scope.kind}`;
}

// Start a paginated rename-method preview. The engine builds the (non-committing)
// change set, stashes it in SessionTemps under `token`, and returns the totals
// plus the first page:
//
//   {"token":..,"total":N,"outOfScope":{..},"skippedMethods":[..],
//    "page":{"changes":[..],"nextOffset":M,"done":bool}}
//
// `newParts` is the new keyword parts in new order; `permutation` maps each new
// argument position to the 1-based old argument index it draws from (empty for a
// zero-argument selector). `token` is a client-generated key that later pages and
// the apply reuse. `dict` scopes the class lookup.
export function startRenameMethodPreview(
  execute: AsyncQueryExecutor,
  className: string,
  oldSelector: string,
  newParts: string[],
  permutation: number[],
  scope: RenameMethodScope,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const partsLiteral = newParts.map((p) => `'${escapeString(p)}'`).join(' ');
  const permLiteral = permutation.join(' ');
  const code = `| cls ref |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ 'Class not found: ${escapeString(className)}'].
ref := GsRenameMethodRefactoring
  class: cls
  renameSelector: '${escapeString(oldSelector)}'
  toParts: #(${partsLiteral})
  permutation: #(${permLiteral})
  ${scopeClauseOf(scope)}.
ref startPreviewToken: '${escapeString(token)}' maxBytes: ${maxBytes}`;
  return execute(
    `startRenameMethodPreview(${className}>>${oldSelector} -> ${newParts.join('')} [${scope.kind}])`,
    code,
  );
}

// Fetch the next page of a started preview, by token. Returns
// {"changes":[..],"nextOffset":M,"done":bool} (or an error envelope if the
// preview session has expired).
export function pageRenameMethodPreview(
  execute: AsyncQueryExecutor,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const code =
    `GsRenameMethodRefactoring pageForToken: '${escapeString(token)}' ` +
    `from: ${offset} maxBytes: ${maxBytes}`;
  return execute(`pageRenameMethodPreview(${token} @ ${offset})`, code);
}

// Apply a started preview server-side (compile new / remove old), skipping the
// given deselected change ids, WITHOUT committing. Returns
// {"applied":N,"failed":[{"id":..,"label":..,"error":..}],"undoRecorded":bool}.
// Routed through GsRefactoringUndo so the change is RECORDED and can be undone (#434);
// see recordedApplyExpr. The answer is the engine's own envelope plus `undoRecorded`.
export function applyRenameMethod(
  execute: AsyncQueryExecutor,
  token: string,
  deselectedIds: string[],
  undoLabel: string,
): Promise<string> {
  const code = recordedApplyExpr('GsRenameMethodRefactoring', token, deselectedIds, undoLabel);
  return execute(`applyRenameMethod(${token}, -${deselectedIds.length})`, code);
}

// Drop a finished preview from SessionTemps.
export function clearRenameMethodPreview(execute: QueryExecutor, token: string): string {
  return execute(`GsRenameMethodRefactoring clearToken: '${escapeString(token)}'`);
}
