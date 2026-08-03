import { QueryExecutor } from '../../queries/types';
import { classLookupExpr, escapeString } from '../../queries/util';

// Start a rename-instance-variable preview across a class and all of its
// subclasses, over every symbol-list dictionary. The engine builds the
// (non-committing) change set — one methodRecompile per method that ACCESSES the
// variable, plus the classDefinitionEdit — stashes the refactoring in
// SessionTemps under `token`, and returns:
//
//   {"token":"..","changes":[ <GsRefactoringChange…> ]}
//
// The token matters: applying MUST happen server-side (see applyRenameInstVar),
// because renaming an instance variable reshapes the class, and a reshape means a
// new class version whose method dictionary starts EMPTY. Only the engine can
// copy the whole method dictionary forward; a client that replayed just the staged
// changes would destroy every method the change set does not mention — including
// class-side methods, which can never appear in it.
//
// Building the preview compiles nothing and commits nothing.
//
// `dict` (a 1-based SymbolList index or name) scopes the class lookup so the same
// class name in two dictionaries resolves to the intended class.
export function startRenameInstVarPreview(
  execute: QueryExecutor,
  className: string,
  oldName: string,
  newName: string,
  token: string,
  dict?: number | string,
): string {
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ 'Class not found: ${escapeString(className)}'].
(GsRenameInstanceVariableRefactoring
  class: cls
  renameInstVar: '${escapeString(oldName)}'
  to: '${escapeString(newName)}') startPreviewToken: '${escapeString(token)}'`;
  return execute(code);
}

// Apply a started preview server-side, WITHOUT committing: the engine re-versions
// the defining class and every subclass and copies all their methods forward —
// accessing methods from their rewritten source, the rest verbatim.
//
// `deselectedIds` are the changes the user unchecked. A deselected method is
// deliberately NOT carried forward, i.e. it is deleted; that is the only way a
// method disappears. The class-definition edit cannot be deselected (the panel
// renders it checked and disabled), so it is never in this list.
export function applyRenameInstVar(
  execute: QueryExecutor,
  token: string,
  deselectedIds: string[],
): string {
  const ids = deselectedIds.map((id) => `'${escapeString(id)}'`).join(' ');
  const code =
    `GsRenameInstanceVariableRefactoring applyForToken: '${escapeString(token)}' ` +
    `deselected: #(${ids})`;
  return execute(code);
}

// Drop a finished preview from SessionTemps.
export function clearRenameInstVarPreview(execute: QueryExecutor, token: string): string {
  return execute(`GsRenameInstanceVariableRefactoring clearToken: '${escapeString(token)}'. 'ok'`);
}
