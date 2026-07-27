import { QueryExecutor } from '../../queries/types';
import { AsyncQueryExecutor } from './previewRenameMethod';
import { classLookupExpr, escapeString } from '../../queries/util';

// Client-side query builders for Inline Temporary (M4). The engine
// (GsInlineTemporaryRefactoring) is method-local: it parses ONE method, resolves the
// temporary at `offset` (a 1-based source index), replaces every read with the
// assigned expression, removes the declaration + assignment, and stages a SINGLE
// methodRecompile change — no class-definition edit, no cross-method scan.

// A pre-flight the client runs before opening the preview: the temporary's name and a
// decline reason if it cannot be inlined.
//   {"name":null|"..","decline":null|".."}
export function analyzeInlineTemporary(
  execute: AsyncQueryExecutor,
  className: string,
  selector: string,
  isMeta: boolean,
  offset: number,
  dict?: number | string,
): Promise<string> {
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ '{"name":null,"decline":"Class not found: ${escapeString(className)}"}'].
GsInlineTemporaryRefactoring
  analyzeTempForClass: cls
  selector: #'${escapeString(selector)}'
  meta: ${isMeta ? 'true' : 'false'}
  atOffset: ${offset}`;
  return execute(`analyzeInlineTemporary(${className}>>${selector} @${offset})`, code);
}

// Start a paginated inline-temporary preview. Stashes the change set in SessionTemps
// under `token` and returns totals + the first page:
//   {"token":..,"total":0|1,"name":..,
//    "outOfScope":{"references":0,"skipped":0,"scope":"method",
//                  "collision":null,"decline":null|".."},
//    "skippedMethods":[],"page":{"changes":[..],"nextOffset":M,"done":bool}}
export function startInlineTemporaryPreview(
  execute: AsyncQueryExecutor,
  className: string,
  selector: string,
  isMeta: boolean,
  offset: number,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ 'Class not found: ${escapeString(className)}'].
(GsInlineTemporaryRefactoring
  class: cls
  selector: #'${escapeString(selector)}'
  meta: ${isMeta ? 'true' : 'false'}
  atOffset: ${offset})
  startPreviewToken: '${escapeString(token)}' maxBytes: ${maxBytes}`;
  const side = isMeta ? ' class' : '';
  return execute(`startInlineTemporaryPreview(${className}${side}>>${selector} @${offset})`, code);
}

// Fetch the next page of a started preview, by token.
export function pageInlineTemporaryPreview(
  execute: AsyncQueryExecutor,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const code =
    `GsInlineTemporaryRefactoring pageForToken: '${escapeString(token)}' ` +
    `from: ${offset} maxBytes: ${maxBytes}`;
  return execute(`pageInlineTemporaryPreview(${token} @ ${offset})`, code);
}

// Apply a started preview server-side (recompile the one method), WITHOUT committing.
// A single change, so there is nothing to deselect; always sends an empty set.
export function applyInlineTemporary(execute: AsyncQueryExecutor, token: string): Promise<string> {
  const code =
    `GsInlineTemporaryRefactoring applyForToken: '${escapeString(token)}' ` + `deselected: #()`;
  return execute(`applyInlineTemporary(${token})`, code);
}

// Drop a finished preview from SessionTemps.
export function clearInlineTemporaryPreview(execute: QueryExecutor, token: string): string {
  return execute(`GsInlineTemporaryRefactoring clearToken: '${escapeString(token)}'`);
}
