import { QueryExecutor } from '../../queries/types';
import { escapeString } from '../../queries/util';
import type { AsyncQueryExecutor } from './previewRenameMethod';

/**
 * Server-side queries for UNDOING the last applied refactoring (issue #434).
 *
 * The undo record is an ordinary `GsRefactoringChangeSet` (the inverse of what was
 * applied), so these mirror a forward refactoring's query set exactly — start a
 * paginated preview, fetch pages, apply skipping deselected ids, drop the preview —
 * and the client parses and renders them the same way.
 *
 * Every one of them reaches `GsRefactoringUndo` through `objectNamed:` rather than
 * naming it directly, so they still COMPILE against a stone whose refactoring engine
 * predates undo; there they answer the same "nothing to undo" envelope the engine
 * itself answers, instead of failing with a compile error.
 */

const UNDO_CLASS = `(System myUserProfile symbolList objectNamed: #GsRefactoringUndo)`;

/** Is there a refactoring to undo, and what is it called?
 *  `{"available":true,"label":..,"engine":..,"sequence":N,"total":N}` or
 *  `{"available":false}`. */
export function refactoringUndoStatus(execute: QueryExecutor): string {
  return execute(
    `| c |
c := ${UNDO_CLASS}.
c isNil ifTrue: ['{"available":false}'] ifFalse: [c statusJson]`,
  );
}

/** Start a paginated preview of the recorded undo. Answers
 *  `{"token":..,"label":..,"engine":..,"sequence":N,"drifted":N,"total":N,"page":{..}}`,
 *  or an envelope carrying `error` when there is nothing to undo. */
export function startUndoRefactoringPreview(
  execute: AsyncQueryExecutor,
  token: string,
  maxBytes: number,
): Promise<string> {
  const code = `| c |
c := ${UNDO_CLASS}.
c isNil
  ifTrue: ['{"error":"This stone''s refactoring engine does not support undo.","token":"","label":"","engine":"","total":0,"page":{"changes":[],"nextOffset":0,"done":true}}']
  ifFalse: [c startPreviewToken: '${escapeString(token)}' maxBytes: ${maxBytes}]`;
  return execute(`startUndoRefactoringPreview(${token})`, code);
}

/** Fetch the next page of a started undo preview, by token. */
export function pageUndoRefactoringPreview(
  execute: AsyncQueryExecutor,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const code = `| c |
c := ${UNDO_CLASS}.
c isNil
  ifTrue: ['{"error":"preview session expired","changes":[],"nextOffset":0,"done":true}']
  ifFalse: [c pageForToken: '${escapeString(token)}' from: ${offset} maxBytes: ${maxBytes}]`;
  return execute(`pageUndoRefactoringPreview(${token} @ ${offset})`, code);
}

/** Apply a started undo preview, skipping the deselected change ids, WITHOUT
 *  committing. Answers `{"applied":N,"failed":[{"id":..,"label":..,"error":..}]}`. */
export function applyUndoRefactoring(
  execute: AsyncQueryExecutor,
  token: string,
  deselectedIds: string[],
): Promise<string> {
  const ids = deselectedIds.map((id) => `'${escapeString(id)}'`).join(' ');
  const code = `| c |
c := ${UNDO_CLASS}.
c isNil
  ifTrue: ['{"applied":0,"failed":[],"error":"preview session expired"}']
  ifFalse: [c applyForToken: '${escapeString(token)}' deselected: #(${ids})]`;
  return execute(`applyUndoRefactoring(${token}, -${deselectedIds.length})`, code);
}

/** Drop a finished undo preview. The recorded ENTRY survives — closing the preview
 *  must not throw the undo away. */
export function clearUndoRefactoringPreview(execute: QueryExecutor, token: string): string {
  return execute(
    `| c |
c := ${UNDO_CLASS}.
c isNil ifTrue: ['ok'] ifFalse: [c clearToken: '${escapeString(token)}']`,
  );
}

/** Forget the recorded undo entirely (there is nothing to undo any more). */
export function clearRefactoringUndo(execute: QueryExecutor): string {
  return execute(
    `| c |
c := ${UNDO_CLASS}.
c isNil ifTrue: ['ok'] ifFalse: [c clear]`,
  );
}
