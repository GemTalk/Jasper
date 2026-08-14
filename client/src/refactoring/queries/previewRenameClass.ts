import { QueryExecutor } from '../../queries/types';
import { AsyncQueryExecutor } from './previewRenameMethod';
import { classLookupExpr, escapeString } from '../../queries/util';

// The scope a rename-class reference rewrite runs in. #class / #hierarchy /
// #wholeSystem take no argument; #dictionary names a single SymbolDictionary.
// Re-parenting the descendant subtree and rebinding the name are NOT scoped —
// scope only governs which OUTSIDE referencing methods are rewritten.
export type RenameClassScope =
  { kind: 'class' | 'hierarchy' | 'wholeSystem' } | { kind: 'dictionary'; dictName: string };

// Runtime guard for a RenameClassScope arriving from the webview (untrusted). The
// editor validates the incoming message with this before using it, so a malformed
// shape is rejected rather than flowing into a server query.
//
// A #dictionary scope needs a NON-BLANK name: an unselected dropdown posts
// dictName: '', which would otherwise reach scopeClauseOf as dictionaryScope: '' --
// a syntactically valid query naming a dictionary that cannot exist.
export function isRenameClassScope(x: unknown): x is RenameClassScope {
  if (typeof x !== 'object' || x === null) return false;
  const kind = (x as { kind?: unknown }).kind;
  if (kind === 'class' || kind === 'hierarchy' || kind === 'wholeSystem') return true;
  if (kind === 'dictionary') {
    const dictName = (x as { dictName?: unknown }).dictName;
    return typeof dictName === 'string' && dictName.trim() !== '';
  }
  return false;
}

function scopeClauseOf(scope: RenameClassScope): string {
  return scope.kind === 'dictionary'
    ? `dictionaryScope: '${escapeString(scope.dictName)}'`
    : `scope: #${scope.kind}`;
}

// The four rename options (JadeiteForPharo issue #142). See the engine class
// comment for semantics. migrateInstances / removeOldFromHistory cause the apply
// to COMMIT (migration must be durable); the other two do not.
export interface RenameClassOptions {
  copyMethods: boolean;
  recompileSubclasses: boolean;
  migrateInstances: boolean;
  removeOldFromHistory: boolean;
}

function stBool(b: boolean): string {
  return b ? 'true' : 'false';
}

// Start a paginated rename-class preview. The engine builds the (non-committing)
// change set — a classRename for the target, a classReparent per descendant, and
// a methodRecompile per in-scope external reference — stashes it in SessionTemps
// under `token`, and returns totals + warnings + the first page:
//
//   {"token":..,"total":N,"oldName":..,"newName":..,
//    "outOfScope":{"references":R,"skipped":S,"descendants":D,"collision":null|".."},
//    "skippedMethods":[..],"page":{"changes":[..],"nextOffset":M,"done":bool}}
//
// `dict` scopes the class lookup (1-based index, canonical for Jasper, or a name).
export function startRenameClassPreview(
  execute: AsyncQueryExecutor,
  className: string,
  newName: string,
  scope: RenameClassScope,
  options: RenameClassOptions,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const code = `| cls ref |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ 'Class not found: ${escapeString(className)}'].
ref := GsRenameClassRefactoring
  class: cls
  renameTo: '${escapeString(newName)}'
  ${scopeClauseOf(scope)}.
ref
  copyMethods: ${stBool(options.copyMethods)}
  recompileSubclasses: ${stBool(options.recompileSubclasses)}
  migrateInstances: ${stBool(options.migrateInstances)}
  removeOldFromHistory: ${stBool(options.removeOldFromHistory)}.
ref startPreviewToken: '${escapeString(token)}' maxBytes: ${maxBytes}`;
  return execute(`startRenameClassPreview(${className} -> ${newName} [${scope.kind}])`, code);
}

// Fetch the next page of a started preview, by token.
export function pageRenameClassPreview(
  execute: AsyncQueryExecutor,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const code =
    `GsRenameClassRefactoring pageForToken: '${escapeString(token)}' ` +
    `from: ${offset} maxBytes: ${maxBytes}`;
  return execute(`pageRenameClassPreview(${token} @ ${offset})`, code);
}

// Apply a started preview server-side (new version + method copy-forward +
// descendant reparent + external reference rewrite + old-name unbind), skipping
// the deselected change ids, WITHOUT committing. The classRename and every
// classReparent are always applied regardless of the deselected set (structural);
// deselection only skips the optional methodRecompile reference rewrites.
export function applyRenameClass(
  execute: AsyncQueryExecutor,
  token: string,
  deselectedIds: string[],
): Promise<string> {
  const idsLiteral = deselectedIds.map((id) => `'${escapeString(id)}'`).join(' ');
  const code =
    `GsRenameClassRefactoring applyForToken: '${escapeString(token)}' ` +
    `deselected: #(${idsLiteral})`;
  return execute(`applyRenameClass(${token}, -${deselectedIds.length})`, code);
}

// Drop a finished preview from SessionTemps.
export function clearRenameClassPreview(execute: QueryExecutor, token: string): string {
  return execute(`GsRenameClassRefactoring clearToken: '${escapeString(token)}'`);
}
