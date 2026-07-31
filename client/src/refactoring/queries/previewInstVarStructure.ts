import { QueryExecutor } from '../../queries/types';
import { AsyncQueryExecutor } from './previewRenameMethod';
import { classLookupExpr, escapeString } from '../../queries/util';

// Instance-variable structure (V2 push up / V3 push down / V4 move / V5 convert temporary)
// query builders. One engine (GsInstVarStructureRefactoring) parametrized by an OPERATION; the
// analyze + start builders construct the right instance, and page/apply/clear are the
// shared token entry points. `dict` scopes the class lookup (1-based SymbolList index,
// canonical for Jasper, or a name).

export type IvarStructureOp = 'convertTemp' | 'pushUp' | 'pushDown' | 'move';

/** A V5 request also carries the method + temporary name. */
export interface ConvertTempArgs {
  selector: string;
  isMeta: boolean;
  varName: string;
}

/** A V4 `move` request carries the destination class name(s) and the direction the ivar
 *  travels: `up` (a single chosen ancestor) or `down` (one or more chosen descendants). */
export interface MoveArgs {
  targets: string[];
  direction: 'up' | 'down';
}

const ENGINE = 'GsInstVarStructureRefactoring';

/** A Smalltalk Array literal of the (escaped, quoted) class names. */
function targetArrayExpr(targets: string[]): string {
  return `#(${targets.map((t) => `'${escapeString(t)}'`).join(' ')})`;
}

/** The class-message send that builds the refactoring for `op`, given a `cls` binding in
 *  scope. `varName` is the ivar (V2/V3/V4) or temporary (V5) name. */
function refExpr(
  op: IvarStructureOp,
  varName: string,
  extra?: ConvertTempArgs,
  move?: MoveArgs,
): string {
  const v = escapeString(varName);
  if (op === 'pushUp') return `${ENGINE} class: cls pushUpInstVar: '${v}'`;
  if (op === 'pushDown') return `${ENGINE} class: cls pushDownInstVar: '${v}'`;
  if (op === 'move') {
    const m = move!;
    return (
      `${ENGINE} class: cls moveInstVar: '${v}' ` +
      `toClasses: ${targetArrayExpr(m.targets)} direction: #${m.direction}`
    );
  }
  // convertTemp
  const e = extra!;
  return (
    `${ENGINE} class: cls convertTemporary: '${v}' ` +
    `inMethod: #'${escapeString(e.selector)}' meta: ${e.isMeta ? 'true' : 'false'}`
  );
}

/** True for the ivar-relocation operations that support carrying the simple accessors along
 *  with the declaration (push up/down and the general move). */
function supportsAccessors(op: IvarStructureOp): boolean {
  return op === 'pushUp' || op === 'pushDown' || op === 'move';
}

/** The refactoring send, optionally opted into moving the ivar's simple accessors (relocation
 *  ops only; `#moveAccessors:` answers the refactoring, so the result is still the instance to
 *  message). */
function refExprWithAccessors(
  op: IvarStructureOp,
  varName: string,
  extra: ConvertTempArgs | undefined,
  moveAccessors: boolean,
  move?: MoveArgs,
): string {
  const base = refExpr(op, varName, extra, move);
  if (moveAccessors && supportsAccessors(op)) {
    return `(${base}) moveAccessors: true`;
  }
  return base;
}

/** Pre-flight (before opening the preview): a decline reason (nil when viable), the top
 *  edited class, and the number of classes that will be recompiled. */
export function analyzeInstVarStructure(
  execute: AsyncQueryExecutor,
  op: IvarStructureOp,
  className: string,
  varName: string,
  dict?: number | string,
  extra?: ConvertTempArgs,
  moveAccessors = false,
  move?: MoveArgs,
): Promise<string> {
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ '{"decline":"Class not found: ${escapeString(
    className,
  )}","topClass":null,"affectedCount":0}'].
(${refExprWithAccessors(op, varName, extra, moveAccessors, move)}) analysisJsonString`;
  return execute(`analyzeIvar_${op}(${className}.${varName})`, code);
}

/** Start a paginated preview under `token`. */
export function startInstVarStructurePreview(
  execute: AsyncQueryExecutor,
  op: IvarStructureOp,
  className: string,
  varName: string,
  token: string,
  maxBytes: number,
  dict?: number | string,
  extra?: ConvertTempArgs,
  moveAccessors = false,
  move?: MoveArgs,
): Promise<string> {
  const accessorStmt = moveAccessors && supportsAccessors(op) ? 'ref moveAccessors: true.\n' : '';
  // Answer the same decline-envelope shape the analyze builder uses (not a bare string) so a
  // class that vanished between pre-flight and start surfaces its reason through the panel's
  // decline banner instead of blowing up JSON.parse with "Unexpected token 'C'".
  const code = `| cls ref |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ '{"decline":"Class not found: ${escapeString(className)}"}'].
ref := ${refExpr(op, varName, extra, move)}.
${accessorStmt}^ref startPreviewToken: '${escapeString(token)}' maxBytes: ${maxBytes}`;
  return execute(`startIvar_${op}Preview(${className}.${varName})`, code);
}

/** Fetch the next page of a started preview, by token. */
export function pageInstVarStructurePreview(
  execute: AsyncQueryExecutor,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const code =
    `${ENGINE} pageForToken: '${escapeString(token)}' ` + `from: ${offset} maxBytes: ${maxBytes}`;
  return execute(`pageIvarPreview(${token} @ ${offset})`, code);
}

/** Apply a started preview server-side (create new class versions, copy methods forward,
 *  re-parent the subtree). The default path does not commit; passing `migrateInstances` or
 *  `removeOldFromHistory` makes the engine commit (they persist instance migration / history
 *  pruning). The refactoring is all-or-nothing, so the engine ignores any deselection; the
 *  empty list documents that. */
export function applyInstVarStructure(
  execute: AsyncQueryExecutor,
  token: string,
  migrateInstances = false,
  removeOldFromHistory = false,
): Promise<string> {
  const code =
    `${ENGINE} applyForToken: '${escapeString(token)}' deselected: #() ` +
    `migrateInstances: ${migrateInstances ? 'true' : 'false'} ` +
    `removeOldFromHistory: ${removeOldFromHistory ? 'true' : 'false'}`;
  return execute(`applyIvar(${token})`, code);
}

/** Drop a finished preview from SessionTemps. */
export function clearInstVarStructurePreview(execute: QueryExecutor, token: string): string {
  return execute(`${ENGINE} clearToken: '${escapeString(token)}'`);
}
