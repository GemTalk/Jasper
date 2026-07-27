import { QueryExecutor } from '../../queries/types';
import { AsyncQueryExecutor, RenameMethodScope } from './previewRenameMethod';
import { classLookupExpr, escapeString } from '../../queries/util';

// Change-method-signature (M5) query builders. The engine
// (GsChangeSignatureRefactoring) is addressed by class + meta + the OLD selector +
// the new (newParts, permutation, argNames, defaults) — mirroring R2's rename-method
// envelope, generalized so arity can change (add / remove / reorder parameters). It
// stages a `methodRename` per implementor and a `methodRecompile` per sender, stashes
// the change set under `token`, and returns totals + the first page. `dict` scopes
// the class lookup (1-based SymbolList index, canonical for Jasper, or a name).
//
// The scope model is R2's exactly, so the scope type is reused.
export type ChangeSignatureScope = RenameMethodScope;

function scopeClauseOf(scope: ChangeSignatureScope): string {
  return scope.kind === 'dictionary'
    ? `dictionaryScope: '${escapeString(scope.dictName)}'`
    : `scope: #${scope.kind}`;
}

function stringArrayLiteral(items: string[]): string {
  return items.map((s) => `'${escapeString(s)}'`).join(' ');
}

/** Pre-flight (before opening the editor): the defining implementor's selector kind,
 *  arity, and argument names, so the client pre-populates the editor rows without
 *  parsing on its side. Returns a `decline` when the method is absent/unparseable. */
export function analyzeChangeSignature(
  execute: AsyncQueryExecutor,
  className: string,
  selector: string,
  isMeta: boolean,
  dict?: number | string,
): Promise<string> {
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ '{"selectorKind":null,"arity":0,"argNames":[],"decline":"Class not found: ${escapeString(className)}"}'].
GsChangeSignatureRefactoring
  analyzeForClass: cls
  selector: '${escapeString(selector)}'
  meta: ${isMeta ? 'true' : 'false'}`;
  const side = isMeta ? ' class' : '';
  return execute(`analyzeChangeSignature(${className}${side}>>${selector})`, code);
}

// Start a paginated change-signature preview. The engine builds the (non-committing)
// change set, stashes it in SessionTemps under `token`, and returns the totals plus
// the first page:
//
//   {"token":..,"total":N,"outOfScope":{..,"collision":..,"decline":..},
//    "skippedMethods":[..],"page":{"changes":[..],"nextOffset":M,"done":bool}}
//
// `newParts` is the new selector parts in new order; `permutation` maps each new
// argument position to the 1-based old argument index it draws from (0 for a
// brand-new parameter); `argNames` names each new position (only new positions are
// honoured server-side); `defaults` is the source spliced at send sites for a new
// position ('' for a reused one). `token` is a client-generated key that later pages
// and the apply reuse. `dict` scopes the class lookup.
export function startChangeSignaturePreview(
  execute: AsyncQueryExecutor,
  className: string,
  oldSelector: string,
  newParts: string[],
  permutation: number[],
  argNames: string[],
  defaults: string[],
  scope: ChangeSignatureScope,
  token: string,
  maxBytes: number,
  isMeta: boolean,
  dict?: number | string,
): Promise<string> {
  const code = `| cls ref |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ 'Class not found: ${escapeString(className)}'].
ref := GsChangeSignatureRefactoring
  class: cls
  meta: ${isMeta ? 'true' : 'false'}
  changeSelector: '${escapeString(oldSelector)}'
  toParts: #(${stringArrayLiteral(newParts)})
  permutation: #(${permutation.join(' ')})
  argNames: #(${stringArrayLiteral(argNames)})
  defaults: #(${stringArrayLiteral(defaults)})
  ${scopeClauseOf(scope)}.
^ref startPreviewToken: '${escapeString(token)}' maxBytes: ${maxBytes}`;
  return execute(
    `startChangeSignaturePreview(${className}>>${oldSelector} -> ${newParts.join('')} [${scope.kind}])`,
    code,
  );
}

// Fetch the next page of a started preview, by token. Returns
// {"changes":[..],"nextOffset":M,"done":bool} (or an error envelope if the preview
// session has expired).
export function pageChangeSignaturePreview(
  execute: AsyncQueryExecutor,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const code =
    `GsChangeSignatureRefactoring pageForToken: '${escapeString(token)}' ` +
    `from: ${offset} maxBytes: ${maxBytes}`;
  return execute(`pageChangeSignaturePreview(${token} @ ${offset})`, code);
}

// Apply a started preview server-side (compile new / remove old), skipping the given
// deselected change ids, WITHOUT committing. Returns
// {"applied":N,"failed":[{"id":..,"label":..,"error":..}]}.
export function applyChangeSignature(
  execute: AsyncQueryExecutor,
  token: string,
  deselectedIds: string[],
): Promise<string> {
  const code =
    `GsChangeSignatureRefactoring applyForToken: '${escapeString(token)}' ` +
    `deselected: #(${stringArrayLiteral(deselectedIds)})`;
  return execute(`applyChangeSignature(${token}, -${deselectedIds.length})`, code);
}

// Drop a finished preview from SessionTemps.
export function clearChangeSignaturePreview(execute: QueryExecutor, token: string): string {
  return execute(`GsChangeSignatureRefactoring clearToken: '${escapeString(token)}'`);
}
