import { QueryExecutor } from '../../queries/types';
import { AsyncQueryExecutor } from './previewRenameMethod';
import { classLookupExpr, escapeString } from '../../queries/util';
import { Accessor } from './addAccessors';

/** Smalltalk for an Array of #(selector source) pairs the engine compiles onto the new
 *  class version inside the apply transaction. Built via an OrderedCollection (not a `{}`
 *  brace array) so it is robust on the 3.6.x matrix regardless of accessor count. */
function accessorPairsExpr(accessors: Accessor[]): string {
  if (accessors.length === 0) return '#()';
  const adds = accessors
    .map(
      (a) => `add: (Array with: '${escapeString(a.selector)}' with: '${escapeString(a.source)}')`,
    )
    .join('; ');
  return `((OrderedCollection new) ${adds}; yourself) asArray`;
}

// Add / remove instance-variable (catalog V1) query builders. The engine
// (GsInstVarRefactoring) is addressed by an operation and a source class + variable name.
// It stages a `classDefinitionEdit` for each edited class plus a `classReparent` for every
// other affected class, stashes the change set under `token`, and returns totals + the
// first page. `dict` scopes the source-class lookup (1-based SymbolList index, canonical
// for Jasper, or a name).

export type InstVarOp = 'add' | 'remove';

/** The `(GsInstVarRefactoring class: src <op> name)` builder expression, given an
 *  already-built source lookup sub-expression. */
function buildExpr(op: InstVarOp, srcExpr: string, name: string): string {
  const n = `'${escapeString(name)}'`;
  if (op === 'add') return `GsInstVarRefactoring class: ${srcExpr} addInstVar: ${n}`;
  return `GsInstVarRefactoring class: ${srcExpr} removeInstVar: ${n}`;
}

/** Pre-flight (before opening the preview): the decline reason (nil when viable), the
 *  affected-class count, and how many methods will not recompile. */
export function analyzeInstVar(
  execute: AsyncQueryExecutor,
  op: InstVarOp,
  className: string,
  ivarName: string,
  dict?: number | string,
): Promise<string> {
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ '{"decline":"Class not found: ${escapeString(
    className,
  )}","operation":"${op}","sourceClass":null,"affectedCount":0,"willNotRecompileCount":0}'].
(${buildExpr(op, 'cls', ivarName)}) analysisJsonString`;
  return execute(`analyzeInstVar(${op} ${ivarName} on ${className})`, code);
}

/** Start a paginated preview under `token`. */
export function startInstVarPreview(
  execute: AsyncQueryExecutor,
  op: InstVarOp,
  className: string,
  ivarName: string,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const code = `| cls ref |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ 'Class not found: ${escapeString(className)}'].
ref := ${buildExpr(op, 'cls', ivarName)}.
^ref startPreviewToken: '${escapeString(token)}' maxBytes: ${maxBytes}`;
  return execute(`startInstVarPreview(${op} ${ivarName} on ${className})`, code);
}

/** Fetch the next page of a started preview, by token. */
export function pageInstVarPreview(
  execute: AsyncQueryExecutor,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const code =
    `GsInstVarRefactoring pageForToken: '${escapeString(token)}' ` +
    `from: ${offset} maxBytes: ${maxBytes}`;
  return execute(`pageInstVarPreview(${token} @ ${offset})`, code);
}

/** A Smalltalk array-of-Strings literal, e.g. `#('logCreation' 'modifiable')`, or `nil`
 *  when the options were not edited (keep the class's current options). */
function optionsExpr(options: string[] | null): string {
  if (options === null) return 'nil';
  return `#(${options.map((o) => `'${escapeString(o)}'`).join(' ')})`;
}

/** Apply a started preview server-side WITHOUT committing — UNLESS `migrate` or
 *  `deleteHistory` is set, which commit (the structural change first, then the
 *  committing step). `options` (or null) replaces the acted-on class's class options. */
export function applyInstVar(
  execute: AsyncQueryExecutor,
  token: string,
  deselectedIds: string[],
  options: string[] | null,
  migrate: boolean,
  deleteHistory: boolean,
  // Getter/setter to compile onto the new class version IN THE SAME transaction as the
  // structural change (so an add-with-accessors commits or aborts as one unit). Empty
  // when the user declined accessors.
  accessors: Accessor[] = [],
): Promise<string> {
  const ids = deselectedIds.map((id) => `'${escapeString(id)}'`).join(' ');
  const code =
    `GsInstVarRefactoring applyForToken: '${escapeString(token)}' ` +
    `deselected: #(${ids}) options: ${optionsExpr(options)} ` +
    `migrate: ${migrate ? 'true' : 'false'} deleteHistory: ${deleteHistory ? 'true' : 'false'} ` +
    `accessors: ${accessorPairsExpr(accessors)}`;
  return execute(`applyInstVar(${token} migrate=${migrate} delHist=${deleteHistory})`, code);
}

/** Drop a finished preview from SessionTemps. */
export function clearInstVarPreview(execute: QueryExecutor, token: string): string {
  return execute(`GsInstVarRefactoring clearToken: '${escapeString(token)}'`);
}
