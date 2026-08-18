import { QueryExecutor } from '../../queries/types';
import { AsyncQueryExecutor } from './previewRenameMethod';
import { classLookupExpr, escapeString } from '../../queries/util';
import { recordedApplyExpr } from './undoRecording';

// Extract-method (M1) query builders. The engine (GsExtractMethodRefactoring) is
// addressed by class + selector + isMeta + a source INTERVAL (selStart..selStop,
// 1-based character offsets from the editor selection) + the new selector. It
// stages a `methodAdd` (the extracted method) + a `methodRecompile` (the rewritten
// original), plus — when replaceSimilar is on and the extraction is a safe void
// shape — a deselectable `methodRecompile` per structurally-equivalent site. It
// stashes the change set under `token` and returns totals + the first page. `dict`
// scopes the class lookup (1-based SymbolList index, canonical for Jasper, or a
// name).

/** Pre-flight (before prompting for a selector): argument count/names, return
 *  variable, safe-void-shape eligibility, and a hard decline reason if the
 *  selection cannot be extracted. */
export function analyzeExtractSelection(
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
cls isNil ifTrue: [^ '{"argCount":0,"argNames":[],"returnVar":null,"safeVoidShape":false,"decline":"Class not found: ${escapeString(className)}"}'].
GsExtractMethodRefactoring
  analyzeSelectionForClass: cls
  selector: #'${escapeString(selector)}'
  meta: ${isMeta ? 'true' : 'false'}
  selStart: ${selStart}
  selStop: ${selStop}`;
  const side = isMeta ? ' class' : '';
  return execute(
    `analyzeExtractSelection(${className}${side}>>${selector} [${selStart}..${selStop}])`,
    code,
  );
}

/** Start a paginated extract-method preview under `token`. */
export function startExtractMethodPreview(
  execute: AsyncQueryExecutor,
  className: string,
  selector: string,
  isMeta: boolean,
  selStart: number,
  selStop: number,
  newSelector: string,
  replaceSimilar: boolean,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const code = `| cls ref |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ 'Class not found: ${escapeString(className)}'].
ref := GsExtractMethodRefactoring
  class: cls
  selector: #'${escapeString(selector)}'
  meta: ${isMeta ? 'true' : 'false'}
  selStart: ${selStart}
  selStop: ${selStop}
  newSelector: '${escapeString(newSelector)}'.
ref replaceSimilar: ${replaceSimilar ? 'true' : 'false'}.
^ref startPreviewToken: '${escapeString(token)}' maxBytes: ${maxBytes}`;
  const side = isMeta ? ' class' : '';
  return execute(
    `startExtractMethodPreview(${className}${side}>>${selector} -> ${newSelector})`,
    code,
  );
}

/** Fetch the next page of a started preview, by token. */
export function pageExtractMethodPreview(
  execute: AsyncQueryExecutor,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const code =
    `GsExtractMethodRefactoring pageForToken: '${escapeString(token)}' ` +
    `from: ${offset} maxBytes: ${maxBytes}`;
  return execute(`pageExtractMethodPreview(${token} @ ${offset})`, code);
}

/** Apply a started preview server-side (compile the new method + rewrite the
 *  original + any selected duplicate sites), WITHOUT committing. The two core
 *  changes are always applied; `deselectedIds` skips only duplicate replacements. */
export function applyExtractMethod(
  execute: AsyncQueryExecutor,
  token: string,
  deselectedIds: string[],
  undoLabel: string,
): Promise<string> {
  const code = recordedApplyExpr('GsExtractMethodRefactoring', token, deselectedIds, undoLabel);
  return execute(`applyExtractMethod(${token})`, code);
}

/** Drop a finished preview from SessionTemps. */
export function clearExtractMethodPreview(execute: QueryExecutor, token: string): string {
  return execute(`GsExtractMethodRefactoring clearToken: '${escapeString(token)}'`);
}
