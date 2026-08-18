import { QueryExecutor } from '../../queries/types';
import { AsyncQueryExecutor } from './previewRenameMethod';
import { classLookupExpr, escapeString } from '../../queries/util';
import { recordedApplyExpr } from './undoRecording';

// Push-up / push-down method (M7 / M8) query builders. Both engines
// (GsPushUpMethodRefactoring / GsPushDownMethodRefactoring) share one class-side API,
// so these builders are parametrized by `direction`. Each is addressed by a SOURCE
// class + a COLLECTION of selectors + the source side (isMeta); the target(s) — the
// superclass for push-up, the immediate subclasses for push-down — are resolved
// server-side. Per movable selector, push-up stages a `methodAdd` on the superclass +
// a `methodRemove` on the source; push-down stages a `methodAdd` per receiving subclass
// + a single `methodRemove` on the source. A selector that cannot move is dropped and
// reported. It stashes the change set under `token` and returns totals + the first
// page. `dict` scopes the source-class lookup (1-based SymbolList index, canonical for
// Jasper, or a name).

export type PushDirection = 'up' | 'down';

/** The engine class name for a direction. */
export function pushEngineClass(direction: PushDirection): string {
  return direction === 'up' ? 'GsPushUpMethodRefactoring' : 'GsPushDownMethodRefactoring';
}

/** A Smalltalk brace-array of Symbol literals, e.g. `{#'foo'. #'bar:'}` (or `#()`). */
function selectorArrayExpr(selectors: string[]): string {
  if (selectors.length === 0) return '#()';
  return `{${selectors.map((s) => `#'${escapeString(s)}'`).join('. ')}}`;
}

/** Pre-flight (before opening the preview): the resolved target (superclass name for
 *  push-up, null for push-down), a per-selector decline reason (nil when movable), a
 *  global decline (no superclass / no subclasses), and the count that will move. */
export function analyzePushMethod(
  execute: AsyncQueryExecutor,
  direction: PushDirection,
  sourceClass: string,
  selectors: string[],
  isMeta: boolean,
  dict?: number | string,
): Promise<string> {
  const engine = pushEngineClass(direction);
  const code = `| cls |
cls := ${classLookupExpr(sourceClass, dict)}.
cls isNil ifTrue: [^ '{"targetClass":null,"globalDecline":"Source class not found: ${escapeString(
    sourceClass,
  )}","movableCount":0,"selectors":[]}'].
${engine}
  analyzeForClass: cls
  selectors: ${selectorArrayExpr(selectors)}
  meta: ${isMeta ? 'true' : 'false'}`;
  const side = isMeta ? ' class' : '';
  return execute(`analyzePush${direction}(${sourceClass}${side} ${selectors.length}sel)`, code);
}

/** Start a paginated push preview under `token`. */
export function startPushMethodPreview(
  execute: AsyncQueryExecutor,
  direction: PushDirection,
  sourceClass: string,
  selectors: string[],
  isMeta: boolean,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const engine = pushEngineClass(direction);
  const code = `| cls ref |
cls := ${classLookupExpr(sourceClass, dict)}.
cls isNil ifTrue: [^ 'Source class not found: ${escapeString(sourceClass)}'].
ref := ${engine}
  sourceClass: cls
  selectors: ${selectorArrayExpr(selectors)}
  meta: ${isMeta ? 'true' : 'false'}.
^ref startPreviewToken: '${escapeString(token)}' maxBytes: ${maxBytes}`;
  const side = isMeta ? ' class' : '';
  return execute(
    `startPush${direction}Preview(${sourceClass}${side} ${selectors.length}sel)`,
    code,
  );
}

/** Fetch the next page of a started preview, by token. */
export function pagePushMethodPreview(
  execute: AsyncQueryExecutor,
  direction: PushDirection,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const engine = pushEngineClass(direction);
  const code =
    `${engine} pageForToken: '${escapeString(token)}' ` + `from: ${offset} maxBytes: ${maxBytes}`;
  return execute(`pagePush${direction}Preview(${token} @ ${offset})`, code);
}

/** Apply a started preview server-side (compile on the target(s) + remove from the
 *  source, the removal guarded so a deselected add never strands a method), WITHOUT
 *  committing. `deselectedIds` skips individual staged changes. */
export function applyPushMethod(
  execute: AsyncQueryExecutor,
  direction: PushDirection,
  token: string,
  deselectedIds: string[],
  undoLabel: string,
): Promise<string> {
  const code = recordedApplyExpr(pushEngineClass(direction), token, deselectedIds, undoLabel);
  return execute(`applyPush${direction}(${token})`, code);
}

/** Drop a finished preview from SessionTemps. */
export function clearPushMethodPreview(
  execute: QueryExecutor,
  direction: PushDirection,
  token: string,
): string {
  return execute(`${pushEngineClass(direction)} clearToken: '${escapeString(token)}'`);
}
