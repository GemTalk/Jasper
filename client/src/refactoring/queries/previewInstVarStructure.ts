import { QueryExecutor } from '../../queries/types';
import { AsyncQueryExecutor } from './previewRenameMethod';
import { classLookupExpr, escapeString } from '../../queries/util';

// Instance-variable structure (V2 push up / V3 push down / V5 convert temporary) query
// builders. One engine (GsInstVarStructureRefactoring) parametrized by an OPERATION; the
// analyze + start builders construct the right instance, and page/apply/clear are the
// shared token entry points. `dict` scopes the class lookup (1-based SymbolList index,
// canonical for Jasper, or a name).

export type IvarStructureOp = 'convertTemp' | 'pushUp' | 'pushDown';

/** A V5 request also carries the method + temporary name. */
export interface ConvertTempArgs {
  selector: string;
  isMeta: boolean;
  varName: string;
}

const ENGINE = 'GsInstVarStructureRefactoring';

/** The class-message send that builds the refactoring for `op`, given a `cls` binding in
 *  scope. `varName` is the ivar (V2/V3) or temporary (V5) name. */
function refExpr(op: IvarStructureOp, varName: string, extra?: ConvertTempArgs): string {
  const v = escapeString(varName);
  if (op === 'pushUp') return `${ENGINE} class: cls pushUpInstVar: '${v}'`;
  if (op === 'pushDown') return `${ENGINE} class: cls pushDownInstVar: '${v}'`;
  // convertTemp
  const e = extra!;
  return (
    `${ENGINE} class: cls convertTemporary: '${v}' ` +
    `inMethod: #'${escapeString(e.selector)}' meta: ${e.isMeta ? 'true' : 'false'}`
  );
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
): Promise<string> {
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ '{"decline":"Class not found: ${escapeString(
    className,
  )}","topClass":null,"affectedCount":0}'].
${refExpr(op, varName, extra)} analysisJsonString`;
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
): Promise<string> {
  const code = `| cls ref |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ 'Class not found: ${escapeString(className)}'].
ref := ${refExpr(op, varName, extra)}.
^ref startPreviewToken: '${escapeString(token)}' maxBytes: ${maxBytes}`;
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
 *  re-parent the subtree), WITHOUT committing. The refactoring is all-or-nothing, so the
 *  engine ignores any deselection; the empty list documents that. */
export function applyInstVarStructure(execute: AsyncQueryExecutor, token: string): Promise<string> {
  const code = `${ENGINE} applyForToken: '${escapeString(token)}' deselected: #()`;
  return execute(`applyIvar(${token})`, code);
}

/** Drop a finished preview from SessionTemps. */
export function clearInstVarStructurePreview(execute: QueryExecutor, token: string): string {
  return execute(`${ENGINE} clearToken: '${escapeString(token)}'`);
}
