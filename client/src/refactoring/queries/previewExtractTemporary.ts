import { QueryExecutor } from '../../queries/types';
import { AsyncQueryExecutor } from './previewRenameMethod';
import { classLookupExpr, escapeString } from '../../queries/util';

// Client-side query builders for Extract Temporary (M3). The engine
// (GsExtractTemporaryRefactoring) is method-local: it parses ONE method, resolves
// the expression at the selection interval, introduces a new temporary assigned to
// it, replaces the occurrence(s), and stages a SINGLE methodRecompile change — no
// class-definition edit, no cross-method scan.

// A pre-flight the client runs before prompting for the new name: how many identical
// occurrences of the selected expression are in scope (so a "replace all N" option
// can be offered) and a decline reason if the selection cannot be extracted.
//   {"occurrenceCount":N,"decline":null|".."}
export function analyzeExtractTemporary(
  execute: AsyncQueryExecutor,
  className: string,
  selector: string,
  isMeta: boolean,
  selStart: number,
  selStop: number,
  dict?: number | string,
): Promise<string> {
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ '{"occurrenceCount":0,"decline":"Class not found: ${escapeString(className)}"}'].
GsExtractTemporaryRefactoring
  analyzeSelectionForClass: cls
  selector: #'${escapeString(selector)}'
  meta: ${isMeta ? 'true' : 'false'}
  selStart: ${selStart}
  selStop: ${selStop}`;
  return execute(`analyzeExtractTemporary(${className}>>${selector})`, code);
}

// Start a paginated extract-temporary preview. Stashes the change set in SessionTemps
// under `token` and returns totals + the first page:
//   {"token":..,"total":0|1,"newName":..,"occurrenceCount":N,
//    "outOfScope":{"references":0,"skipped":0,"scope":"method",
//                  "collision":null|"..","decline":null|".."},
//    "skippedMethods":[],"page":{"changes":[..],"nextOffset":M,"done":bool}}
// `replaceAll` extends the rewrite to every identical occurrence in scope.
export function startExtractTemporaryPreview(
  execute: AsyncQueryExecutor,
  className: string,
  selector: string,
  isMeta: boolean,
  selStart: number,
  selStop: number,
  newName: string,
  replaceAll: boolean,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const code = `| cls r |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ 'Class not found: ${escapeString(className)}'].
r := GsExtractTemporaryRefactoring
  class: cls
  selector: #'${escapeString(selector)}'
  meta: ${isMeta ? 'true' : 'false'}
  selStart: ${selStart}
  selStop: ${selStop}
  newName: '${escapeString(newName)}'.
r replaceAll: ${replaceAll ? 'true' : 'false'}.
r startPreviewToken: '${escapeString(token)}' maxBytes: ${maxBytes}`;
  const side = isMeta ? ' class' : '';
  return execute(
    `startExtractTemporaryPreview(${className}${side}>>${selector} -> ${newName})`,
    code,
  );
}

// Fetch the next page of a started preview, by token.
export function pageExtractTemporaryPreview(
  execute: AsyncQueryExecutor,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const code =
    `GsExtractTemporaryRefactoring pageForToken: '${escapeString(token)}' ` +
    `from: ${offset} maxBytes: ${maxBytes}`;
  return execute(`pageExtractTemporaryPreview(${token} @ ${offset})`, code);
}

// Apply a started preview server-side (recompile the one method), WITHOUT committing.
// A single change, so there is nothing to deselect; always sends an empty set.
export function applyExtractTemporary(execute: AsyncQueryExecutor, token: string): Promise<string> {
  const code =
    `GsExtractTemporaryRefactoring applyForToken: '${escapeString(token)}' ` + `deselected: #()`;
  return execute(`applyExtractTemporary(${token})`, code);
}

// Drop a finished preview from SessionTemps.
export function clearExtractTemporaryPreview(execute: QueryExecutor, token: string): string {
  return execute(
    `clearExtractTemporaryPreview(${token})`,
    `GsExtractTemporaryRefactoring clearToken: '${escapeString(token)}'`,
  );
}
