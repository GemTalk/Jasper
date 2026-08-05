import { QueryExecutor } from '../../queries/types';
import { AsyncQueryExecutor } from './previewRenameMethod';
import { classLookupExpr, escapeString } from '../../queries/util';

// Extract-superclass (V6 insert superclass / V7 extract superclass) query builders. One engine
// (GsExtractSuperclassRefactoring) drives both: V6 is the no-sibling, no-member case. `dict`
// scopes the anchor-class lookup (1-based SymbolList index, canonical for Jasper, or a name); the
// new superclass is filed in the anchor's own dictionary.

const ENGINE = 'GsExtractSuperclassRefactoring';

/** The chosen hoist sets for a V7 extract. Empty on both for a V6 insert. */
export interface HoistSets {
  /** Instance-side selectors to pull up onto the new superclass. */
  methods: string[];
  /** Own instance variables to pull up onto the new superclass. */
  instVars: string[];
}

/** A Smalltalk Array literal of the (escaped, quoted) class names. */
function nameArrayExpr(names: string[]): string {
  return `#(${names.map((n) => `'${escapeString(n)}'`).join(' ')})`;
}

/** A Smalltalk Array literal of the (escaped, quoted) selector symbols. */
function selectorArrayExpr(selectors: string[]): string {
  return `#(${selectors.map((s) => `#'${escapeString(s)}'`).join(' ')})`;
}

/** The class-message send that builds the refactoring, given a `cls` binding in scope. */
function refExpr(newName: string, siblings: string[], hoist: HoistSets): string {
  return (
    `${ENGINE} class: cls extractSuperclassNamed: '${escapeString(newName)}' ` +
    `inDictionary: nil siblings: ${nameArrayExpr(siblings)} ` +
    `hoistMethods: ${selectorArrayExpr(hoist.methods)} ` +
    `hoistInstVars: ${nameArrayExpr(hoist.instVars)}`
  );
}

/** The classified member candidates (methods + instance variables) for the extract checklist,
 *  computed before any hoist set is chosen. */
export function candidatesForExtractSuperclass(
  execute: AsyncQueryExecutor,
  className: string,
  siblings: string[],
  dict?: number | string,
): Promise<string> {
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ '{"decline":"Class not found: ${escapeString(className)}"}'].
${ENGINE} candidatesForClass: cls siblings: ${nameArrayExpr(siblings)}`;
  return execute(`extractSuperCandidates(${className})`, code);
}

/** Pre-flight (before opening the preview): a decline reason (nil when viable), the new class
 *  name, the shared parent, and the number of staged changes. */
export function analyzeExtractSuperclass(
  execute: AsyncQueryExecutor,
  className: string,
  newName: string,
  siblings: string[],
  hoist: HoistSets,
  dict?: number | string,
): Promise<string> {
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ '{"decline":"Class not found: ${escapeString(
    className,
  )}","newClass":"${escapeString(newName)}","sharedParent":null,"affectedCount":0}'].
(${refExpr(newName, siblings, hoist)}) analysisJsonString`;
  return execute(`analyzeExtractSuper(${className})`, code);
}

/** Start a paginated preview under `token`. */
export function startExtractSuperclassPreview(
  execute: AsyncQueryExecutor,
  className: string,
  newName: string,
  siblings: string[],
  hoist: HoistSets,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  // Answer the decline-envelope shape (not a bare string) so a class that vanished between
  // pre-flight and start surfaces its reason through the panel's decline banner.
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ '{"decline":"Class not found: ${escapeString(className)}"}'].
(${refExpr(newName, siblings, hoist)}) startPreviewToken: '${escapeString(token)}' maxBytes: ${maxBytes}`;
  return execute(`startExtractSuperPreview(${className})`, code);
}

/** Fetch the next page of a started preview, by token. */
export function pageExtractSuperclassPreview(
  execute: AsyncQueryExecutor,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const code =
    `${ENGINE} pageForToken: '${escapeString(token)}' ` + `from: ${offset} maxBytes: ${maxBytes}`;
  return execute(`pageExtractSuperPreview(${token} @ ${offset})`, code);
}

/** Apply a started preview server-side (create the new superclass, re-parent + reversion the
 *  subtree, hoist members). All-or-nothing, so the engine ignores any deselection; the empty
 *  list documents that. Never commits. */
export function applyExtractSuperclass(
  execute: AsyncQueryExecutor,
  token: string,
): Promise<string> {
  const code = `${ENGINE} applyForToken: '${escapeString(token)}' deselected: #()`;
  return execute(`applyExtractSuper(${token})`, code);
}

/** Drop a finished preview from SessionTemps. */
export function clearExtractSuperclassPreview(execute: QueryExecutor, token: string): string {
  return execute(`${ENGINE} clearToken: '${escapeString(token)}'`);
}
