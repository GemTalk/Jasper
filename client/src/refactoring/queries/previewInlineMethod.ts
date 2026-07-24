import { QueryExecutor } from '../../queries/types';
import { AsyncQueryExecutor } from './previewRenameMethod';
import { classLookupExpr, escapeString } from '../../queries/util';

// Inline-method (M2) query builders. The engine (GsInlineMethodRefactoring) is
// addressed by class + selector + isMeta + a 1-based source OFFSET (the editor
// caret) that lands on a self/super message send. It stages a `methodRecompile`
// (the rewritten caller) plus — only when the inlined call was the target's last
// sender — a deselectable `methodRemove` (delete the now-unused target). It stashes
// the change set under `token` and returns totals + the first page. `dict` scopes
// the class lookup (1-based SymbolList index, canonical for Jasper, or a name).

/** Pre-flight (before opening the preview): the target class + selector the send
 *  resolves to, whether the inlined call is the target's last sender, and a hard
 *  decline reason if the send cannot be inlined. */
export function analyzeInlineSend(
  execute: AsyncQueryExecutor,
  className: string,
  selector: string,
  isMeta: boolean,
  offset: number,
  dict?: number | string,
): Promise<string> {
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ '{"targetClass":null,"targetSelector":null,"lastSender":false,"decline":"Class not found: ${escapeString(className)}"}'].
GsInlineMethodRefactoring
  analyzeSendForClass: cls
  selector: #'${escapeString(selector)}'
  meta: ${isMeta ? 'true' : 'false'}
  atOffset: ${offset}`;
  const side = isMeta ? ' class' : '';
  return execute(`analyzeInlineSend(${className}${side}>>${selector} @ ${offset})`, code);
}

/** Start a paginated inline-method preview under `token`. */
export function startInlineMethodPreview(
  execute: AsyncQueryExecutor,
  className: string,
  selector: string,
  isMeta: boolean,
  offset: number,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const code = `| cls ref |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ 'Class not found: ${escapeString(className)}'].
ref := GsInlineMethodRefactoring
  class: cls
  selector: #'${escapeString(selector)}'
  meta: ${isMeta ? 'true' : 'false'}
  atOffset: ${offset}.
^ref startPreviewToken: '${escapeString(token)}' maxBytes: ${maxBytes}`;
  const side = isMeta ? ' class' : '';
  return execute(`startInlineMethodPreview(${className}${side}>>${selector} @ ${offset})`, code);
}

/** Fetch the next page of a started preview, by token. */
export function pageInlineMethodPreview(
  execute: AsyncQueryExecutor,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const code =
    `GsInlineMethodRefactoring pageForToken: '${escapeString(token)}' ` +
    `from: ${offset} maxBytes: ${maxBytes}`;
  return execute(`pageInlineMethodPreview(${token} @ ${offset})`, code);
}

/** Apply a started preview server-side (recompile the caller + optionally remove
 *  the now-unused target), WITHOUT committing. The caller recompile is always
 *  applied; `deselectedIds` skips only the target removal. */
export function applyInlineMethod(
  execute: AsyncQueryExecutor,
  token: string,
  deselectedIds: string[],
): Promise<string> {
  const ids = deselectedIds.map((id) => `'${escapeString(id)}'`).join(' ');
  const code =
    `GsInlineMethodRefactoring applyForToken: '${escapeString(token)}' ` + `deselected: #(${ids})`;
  return execute(`applyInlineMethod(${token})`, code);
}

/** Drop a finished preview from SessionTemps. */
export function clearInlineMethodPreview(execute: QueryExecutor, token: string): string {
  return execute(`GsInlineMethodRefactoring clearToken: '${escapeString(token)}'`);
}
