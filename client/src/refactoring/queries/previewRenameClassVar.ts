import { QueryExecutor } from '../../queries/types';
import { AsyncQueryExecutor } from './previewRenameMethod';
import { classLookupExpr, escapeString } from '../../queries/util';

// Start a paginated rename-class-variable preview. The engine builds the
// (non-committing) change set — the classDefinitionEdit for the defining class
// plus a methodRecompile per referencing method (both sides, whole subtree) —
// stashes it in SessionTemps under `token`, and returns totals + warnings + the
// first page:
//
//   {"token":..,"total":N,"oldName":..,"newName":..,
//    "outOfScope":{"references":0,"skipped":S,"scope":"hierarchy","collision":null|".."},
//    "skippedMethods":[..],"page":{"changes":[..],"nextOffset":M,"done":bool}}
//
// A class-variable rename is hierarchy-scoped and all-or-nothing (no scope pick,
// no per-change selection). `dict` scopes the class lookup (1-based index,
// canonical for Jasper, or a name).
export function startRenameClassVarPreview(
  execute: AsyncQueryExecutor,
  className: string,
  oldName: string,
  newName: string,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const code = `| cls ref |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ 'Class not found: ${escapeString(className)}'].
ref := GsRenameClassVariableRefactoring
  class: cls
  renameClassVar: '${escapeString(oldName)}'
  to: '${escapeString(newName)}'.
ref startPreviewToken: '${escapeString(token)}' maxBytes: ${maxBytes}`;
  return execute(`startRenameClassVarPreview(${className}: ${oldName} -> ${newName})`, code);
}

// Fetch the next page of a started preview, by token.
export function pageRenameClassVarPreview(
  execute: AsyncQueryExecutor,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const code =
    `GsRenameClassVariableRefactoring pageForToken: '${escapeString(token)}' ` +
    `from: ${offset} maxBytes: ${maxBytes}`;
  return execute(`pageRenameClassVarPreview(${token} @ ${offset})`, code);
}

// Apply a started preview server-side (value-preserving reflective rename of the
// class variable + recompile of every referencing method), WITHOUT committing.
// The rename is ALL-OR-NOTHING: the engine ignores any deselected set, so this
// deliberately takes no deselection parameter and always sends an empty set —
// the client contract cannot be misused into leaving a method naming a removed
// variable.
export function applyRenameClassVar(execute: AsyncQueryExecutor, token: string): Promise<string> {
  const code =
    `GsRenameClassVariableRefactoring applyForToken: '${escapeString(token)}' ` + `deselected: #()`;
  return execute(`applyRenameClassVar(${token})`, code);
}

// Drop a finished preview from SessionTemps.
export function clearRenameClassVarPreview(execute: QueryExecutor, token: string): string {
  return execute(`GsRenameClassVariableRefactoring clearToken: '${escapeString(token)}'`);
}
