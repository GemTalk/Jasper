import { QueryExecutor } from '../../queries/types';
import { AsyncQueryExecutor } from './previewRenameMethod';
import { classLookupExpr, escapeString } from '../../queries/util';

// Split-class (V8 / extract class) query builders. GsSplitClassRefactoring extracts a chosen set of
// the source's own instance variables -- and the methods that use them -- into a new class, leaving
// the source holding a reference to it. `dict` scopes the source-class lookup (1-based SymbolList
// index, canonical for Jasper, or a name); the new class is filed in the source's own dictionary.

const ENGINE = 'GsSplitClassRefactoring';

/** A Smalltalk Array literal of the (escaped, quoted) instance-variable names. */
function nameArrayExpr(names: string[]): string {
  return `#(${names.map((n) => `'${escapeString(n)}'`).join(' ')})`;
}

/** The class-message send that builds the refactoring, given a `cls` binding in scope. */
function refExpr(newName: string, extractIvars: string[]): string {
  return (
    `${ENGINE} class: cls splitIntoClassNamed: '${escapeString(newName)}' ` +
    `extractingInstVars: ${nameArrayExpr(extractIvars)} inDictionary: nil`
  );
}

/** The source's own instance variables, for the extract-set checklist. */
export function candidatesForSplitClass(
  execute: AsyncQueryExecutor,
  className: string,
  dict?: number | string,
): Promise<string> {
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ '{"decline":"Class not found: ${escapeString(className)}"}'].
${ENGINE} candidatesForClass: cls`;
  return execute(`splitCandidates(${className})`, code);
}

/** Pre-flight (before opening the preview): a decline reason (nil when viable), the new class
 *  name, the source, the movable-method count, and the number of staged changes. */
export function analyzeSplitClass(
  execute: AsyncQueryExecutor,
  className: string,
  newName: string,
  extractIvars: string[],
  dict?: number | string,
): Promise<string> {
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ '{"decline":"Class not found: ${escapeString(
    className,
  )}","newClass":"${escapeString(newName)}","sourceClass":"${escapeString(
    className,
  )}","movableCount":0,"affectedCount":0}'].
(${refExpr(newName, extractIvars)}) analysisJsonString`;
  return execute(`analyzeSplit(${className})`, code);
}

/** Start a paginated preview under `token`. */
export function startSplitClassPreview(
  execute: AsyncQueryExecutor,
  className: string,
  newName: string,
  extractIvars: string[],
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  // Answer the decline-envelope shape (not a bare string) so a class that vanished between
  // pre-flight and start surfaces its reason through the panel's decline banner.
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ '{"decline":"Class not found: ${escapeString(className)}"}'].
(${refExpr(newName, extractIvars)}) startPreviewToken: '${escapeString(token)}' maxBytes: ${maxBytes}`;
  return execute(`startSplitPreview(${className})`, code);
}

/** Fetch the next page of a started preview, by token. */
export function pageSplitClassPreview(
  execute: AsyncQueryExecutor,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const code =
    `${ENGINE} pageForToken: '${escapeString(token)}' ` + `from: ${offset} maxBytes: ${maxBytes}`;
  return execute(`pageSplitPreview(${token} @ ${offset})`, code);
}

/** Apply a started preview server-side (create the component, move methods + ivars, reversion the
 *  source, add the accessor + delegators, reparent the subtree). All-or-nothing, so the engine
 *  ignores any deselection; the empty list documents that. Never commits. */
export function applySplitClass(execute: AsyncQueryExecutor, token: string): Promise<string> {
  const code = `${ENGINE} applyForToken: '${escapeString(token)}' deselected: #()`;
  return execute(`applySplit(${token})`, code);
}

/** Drop a finished preview from SessionTemps. */
export function clearSplitClassPreview(execute: QueryExecutor, token: string): string {
  return execute(`${ENGINE} clearToken: '${escapeString(token)}'`);
}
