import { QueryExecutor } from '../../queries/types';
import { AsyncQueryExecutor } from './previewRenameMethod';
import { classLookupExpr, escapeString } from '../../queries/util';

// Start a paginated rename-temporary/argument preview (R5). The engine
// (GsRenameTemporaryRefactoring) is method-local: it parses ONE method, resolves
// the binding at `offset` (a 1-based source index into the method), renames every
// occurrence bound to it, and stages a SINGLE methodRecompile change — no
// class-definition edit, no cross-method scan. It stashes the change set in
// SessionTemps under `token` and returns totals + the first page:
//
//   {"token":..,"total":0|1,"oldName":..,"newName":..,
//    "outOfScope":{"references":0,"skipped":0,"scope":"method",
//                  "collision":null|"..","decline":null|".."},
//    "skippedMethods":[],"page":{"changes":[..],"nextOffset":M,"done":bool}}
//
// `collision` is set when the new name is already an argument/temporary/ivar/class
// var/pseudo-variable; `decline` is set when the offset is not a local at all (an
// instance variable, a global, self, a message). `dict` scopes the class lookup
// (1-based SymbolList index, canonical for Jasper, or a name).
export function startRenameTemporaryPreview(
  execute: AsyncQueryExecutor,
  className: string,
  selector: string,
  isMeta: boolean,
  oldName: string,
  newName: string,
  offset: number,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ 'Class not found: ${escapeString(className)}'].
(GsRenameTemporaryRefactoring
  class: cls
  selector: #'${escapeString(selector)}'
  meta: ${isMeta ? 'true' : 'false'}
  renameTemp: '${escapeString(oldName)}'
  to: '${escapeString(newName)}'
  atOffset: ${offset})
  startPreviewToken: '${escapeString(token)}' maxBytes: ${maxBytes}`;
  const side = isMeta ? ' class' : '';
  return execute(
    `startRenameTemporaryPreview(${className}${side}>>${selector}: ${oldName} -> ${newName})`,
    code,
  );
}

// Ask why a rename at `offset` would be declined WITHOUT starting a preview or
// prompting for a new name. Returns the engine's classifying reason (an instance
// variable, an inherited instance variable, a class variable, a global, a
// pseudo-variable, or "not a temporary or argument at that position"), or an empty
// string when the target IS a renamable local. Lets the client refuse up front.
export function renameTemporaryDeclineReason(
  execute: AsyncQueryExecutor,
  className: string,
  selector: string,
  isMeta: boolean,
  oldName: string,
  offset: number,
  dict?: number | string,
): Promise<string> {
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ ''].
GsRenameTemporaryRefactoring
  declineReasonForClass: cls
  selector: #'${escapeString(selector)}'
  meta: ${isMeta ? 'true' : 'false'}
  name: '${escapeString(oldName)}'
  atOffset: ${offset}`;
  return execute(`renameTemporaryDeclineReason(${className}>>${selector}: ${oldName})`, code);
}

// Fetch the next page of a started preview, by token.
export function pageRenameTemporaryPreview(
  execute: AsyncQueryExecutor,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const code =
    `GsRenameTemporaryRefactoring pageForToken: '${escapeString(token)}' ` +
    `from: ${offset} maxBytes: ${maxBytes}`;
  return execute(`pageRenameTemporaryPreview(${token} @ ${offset})`, code);
}

// Apply a started preview server-side (recompile the one method with the renamed
// local), WITHOUT committing. A temporary/argument rename is a SINGLE change, so
// there is nothing to deselect; the engine ignores any deselected set and this
// always sends an empty one.
export function applyRenameTemporary(execute: AsyncQueryExecutor, token: string): Promise<string> {
  const code =
    `GsRenameTemporaryRefactoring applyForToken: '${escapeString(token)}' ` + `deselected: #()`;
  return execute(`applyRenameTemporary(${token})`, code);
}

// Drop a finished preview from SessionTemps.
export function clearRenameTemporaryPreview(execute: QueryExecutor, token: string): string {
  return execute(`GsRenameTemporaryRefactoring clearToken: '${escapeString(token)}'`);
}
