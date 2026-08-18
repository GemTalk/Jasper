import { QueryExecutor } from '../../queries/types';
import { AsyncQueryExecutor } from './previewRenameMethod';
import { classLookupExpr, escapeString } from '../../queries/util';
import { recordedApplyExpr } from './undoRecording';

// Move-method (M6) query builders. The engine (GsMoveMethodRefactoring) is addressed
// by a SOURCE class + a COLLECTION of selectors + the source side (isMeta), plus a
// TARGET class name + the target side (toMeta). Per selector it stages a `methodAdd`
// on the target (compile the same source there) plus a `methodRemove` on the source;
// a selector that cannot move is dropped and reported. It stashes the change set under
// `token` and returns totals + the first page. `dict` scopes the source-class lookup
// (1-based SymbolList index, canonical for Jasper, or a name).

/** A Smalltalk brace-array of Symbol literals, e.g. `{#'foo'. #'bar:'}` (or `#()`). */
function selectorArrayExpr(selectors: string[]): string {
  if (selectors.length === 0) return '#()';
  return `{${selectors.map((s) => `#'${escapeString(s)}'`).join('. ')}}`;
}

/** Pre-flight (before opening the preview): the resolved target class, a per-selector
 *  decline reason (nil when movable), a global decline (target missing / no-op), and
 *  the count that will actually move. */
export function analyzeMoveMethod(
  execute: AsyncQueryExecutor,
  sourceClass: string,
  selectors: string[],
  isMeta: boolean,
  targetName: string,
  toMeta: boolean,
  dict?: number | string,
): Promise<string> {
  const code = `| cls |
cls := ${classLookupExpr(sourceClass, dict)}.
cls isNil ifTrue: [^ '{"targetClass":null,"globalDecline":"Source class not found: ${escapeString(
    sourceClass,
  )}","movableCount":0,"selectors":[]}'].
GsMoveMethodRefactoring
  analyzeForClass: cls
  selectors: ${selectorArrayExpr(selectors)}
  meta: ${isMeta ? 'true' : 'false'}
  toClassNamed: '${escapeString(targetName)}'
  toMeta: ${toMeta ? 'true' : 'false'}`;
  const side = isMeta ? ' class' : '';
  const toSide = toMeta ? ' class' : '';
  return execute(
    `analyzeMoveMethod(${sourceClass}${side} ${selectors.length}sel -> ${targetName}${toSide})`,
    code,
  );
}

/** Start a paginated move-method preview under `token`. */
export function startMoveMethodPreview(
  execute: AsyncQueryExecutor,
  sourceClass: string,
  selectors: string[],
  isMeta: boolean,
  targetName: string,
  toMeta: boolean,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const code = `| cls ref |
cls := ${classLookupExpr(sourceClass, dict)}.
cls isNil ifTrue: [^ 'Source class not found: ${escapeString(sourceClass)}'].
ref := GsMoveMethodRefactoring
  sourceClass: cls
  selectors: ${selectorArrayExpr(selectors)}
  meta: ${isMeta ? 'true' : 'false'}
  toClassNamed: '${escapeString(targetName)}'
  toMeta: ${toMeta ? 'true' : 'false'}.
^ref startPreviewToken: '${escapeString(token)}' maxBytes: ${maxBytes}`;
  const side = isMeta ? ' class' : '';
  const toSide = toMeta ? ' class' : '';
  return execute(
    `startMoveMethodPreview(${sourceClass}${side} ${selectors.length}sel -> ${targetName}${toSide})`,
    code,
  );
}

/** Fetch the next page of a started preview, by token. */
export function pageMoveMethodPreview(
  execute: AsyncQueryExecutor,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const code =
    `GsMoveMethodRefactoring pageForToken: '${escapeString(token)}' ` +
    `from: ${offset} maxBytes: ${maxBytes}`;
  return execute(`pageMoveMethodPreview(${token} @ ${offset})`, code);
}

/** Apply a started preview server-side (compile on the target + remove from the
 *  source, the removal guarded so a deselected add never strands a method), WITHOUT
 *  committing. `deselectedIds` skips individual staged changes. */
export function applyMoveMethod(
  execute: AsyncQueryExecutor,
  token: string,
  deselectedIds: string[],
  undoLabel: string,
): Promise<string> {
  const code = recordedApplyExpr('GsMoveMethodRefactoring', token, deselectedIds, undoLabel);
  return execute(`applyMoveMethod(${token})`, code);
}

/** Drop a finished preview from SessionTemps. */
export function clearMoveMethodPreview(execute: QueryExecutor, token: string): string {
  return execute(`GsMoveMethodRefactoring clearToken: '${escapeString(token)}'`);
}
