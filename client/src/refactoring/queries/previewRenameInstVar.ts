import { QueryExecutor } from '../../queries/types';
import { classLookupExpr, escapeString } from '../../queries/util';

// Preview a rename of an instance variable across a class and all of its
// subclasses, over every symbol-list dictionary. Returns the server-side
// refactoring engine's change-set as a JSON array string — one entry per method
// to recompile plus one class-definition edit, each carrying its old/new source
// (see GsRefactoringChange). Building the preview compiles nothing and commits
// nothing; the client renders it and, on confirm, applies the selected changes.
//
// `dict` (a 1-based SymbolList index or name) scopes the class lookup so the same
// class name in two dictionaries resolves to the intended class.
export function previewRenameInstVar(
  execute: QueryExecutor,
  className: string,
  oldName: string,
  newName: string,
  dict?: number | string,
): string {
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ 'Class not found: ${escapeString(className)}'].
(GsRenameInstanceVariableRefactoring
  class: cls
  renameInstVar: '${escapeString(oldName)}'
  to: '${escapeString(newName)}') previewJsonString`;
  return execute(code);
}
