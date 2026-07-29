import { QueryExecutor } from '../../queries/types';
import { AsyncQueryExecutor } from './previewRenameMethod';
import { classLookupExpr, escapeString } from '../../queries/util';

// Add / remove / move instance-variable (catalog V1 + V4) query builders. The engine
// (GsInstVarRefactoring) is addressed by an operation, a source class + variable name,
// and — for a move — a target class. It stages a `classDefinitionEdit` for each edited
// class plus a `classReparent` for every other affected class, stashes the change set
// under `token`, and returns totals + the first page. `dict` scopes the source-class
// lookup (1-based SymbolList index, canonical for Jasper, or a name); the move target
// is resolved by name across all dictionaries.

export type InstVarOp = 'add' | 'remove' | 'move';

/** The `(GsInstVarRefactoring class: src <op> name [toClass: tgt])` builder expression,
 *  given already-built source/target lookup sub-expressions. */
function buildExpr(op: InstVarOp, srcExpr: string, name: string, tgtExpr?: string): string {
  const n = `'${escapeString(name)}'`;
  if (op === 'add') return `GsInstVarRefactoring class: ${srcExpr} addInstVar: ${n}`;
  if (op === 'remove') return `GsInstVarRefactoring class: ${srcExpr} removeInstVar: ${n}`;
  return `GsInstVarRefactoring class: ${srcExpr} moveInstVar: ${n} toClass: ${tgtExpr}`;
}

/** Pre-flight (before opening the preview): the decline reason (nil when viable), the
 *  affected-class count, and how many methods will not recompile. */
export function analyzeInstVar(
  execute: AsyncQueryExecutor,
  op: InstVarOp,
  className: string,
  ivarName: string,
  dict?: number | string,
  targetName?: string,
): Promise<string> {
  const tgtExpr = op === 'move' ? `(${classLookupExpr(targetName ?? '')})` : undefined;
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ '{"decline":"Class not found: ${escapeString(
    className,
  )}","operation":"${op}","sourceClass":null,"targetClass":null,"affectedCount":0,"willNotRecompileCount":0}'].
(${buildExpr(op, 'cls', ivarName, tgtExpr)}) analysisJsonString`;
  const to = op === 'move' ? ` -> ${targetName ?? '?'}` : '';
  return execute(`analyzeInstVar(${op} ${ivarName} on ${className}${to})`, code);
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
  targetName?: string,
): Promise<string> {
  const tgtExpr = op === 'move' ? `(${classLookupExpr(targetName ?? '')})` : undefined;
  const code = `| cls ref |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ 'Class not found: ${escapeString(className)}'].
ref := ${buildExpr(op, 'cls', ivarName, tgtExpr)}.
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
): Promise<string> {
  const ids = deselectedIds.map((id) => `'${escapeString(id)}'`).join(' ');
  const code =
    `GsInstVarRefactoring applyForToken: '${escapeString(token)}' ` +
    `deselected: #(${ids}) options: ${optionsExpr(options)} ` +
    `migrate: ${migrate ? 'true' : 'false'} deleteHistory: ${deleteHistory ? 'true' : 'false'}`;
  return execute(`applyInstVar(${token} migrate=${migrate} delHist=${deleteHistory})`, code);
}

/** Drop a finished preview from SessionTemps. */
export function clearInstVarPreview(execute: QueryExecutor, token: string): string {
  return execute(`GsInstVarRefactoring clearToken: '${escapeString(token)}'`);
}

/** The move-up / move-down targets for a class: its immediate superclass name (or null)
 *  and its immediate subclass names. Class names are identifiers, so they need no JSON
 *  escaping. Answers `{"superclass":name|null,"subclasses":[name,...]}`. */
export function getMoveTargets(
  execute: QueryExecutor,
  className: string,
  dict?: number | string,
): string {
  const code = `| cls subs |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ '{"superclass":null,"subclasses":[]}'].
subs := (cls subclasses ifNil: [#()]) asSortedCollection: [:a :b | a name <= b name].
'{"superclass":', (cls superclass isNil ifTrue: ['null'] ifFalse: ['"', cls superclass name, '"']),
',"subclasses":[', ((subs collect: [:c | '"', c name, '"']) inject: '' into: [:acc :s | acc isEmpty ifTrue: [s] ifFalse: [acc, ',', s]]), ']}'`;
  return execute(code);
}
