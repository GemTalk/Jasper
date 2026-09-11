import { escapeString } from '../../queries/util';

/**
 * The one place that turns a refactoring's server-side apply into a RECORDED apply
 * (issue #434).
 *
 * Every method-only refactoring used to send its own
 * `<Engine> applyForToken: '<tok>' deselected: #(…)`. They now send this instead,
 * which routes the identical call through `GsRefactoringUndo`: it snapshots the
 * method slots the change set touches, runs the engine's own `applyDeselected:`
 * untouched, snapshots again, and keeps the difference as the session's undo entry.
 * The engine's own apply-result envelope comes back unchanged apart from an added
 * `undoRecorded` boolean.
 *
 * `GsRefactoringUndo` is reached through `objectNamed:` rather than named directly,
 * so this doit still COMPILES on a stone whose refactoring engine predates it — an
 * older engine simply takes the plain apply path and records no undo. Naming the
 * class directly would have turned "your stone has an older engine" into "Apply
 * fails with a compile error", which is a far worse trade for a nice-to-have.
 */
export function recordedApplyExpr(
  engineClassName: string,
  token: string,
  deselectedIds: string[],
  /** What to call this refactoring in the undo UI, e.g. "Rename #total to #sum". */
  label: string,
): string {
  const ids = deselectedIds.map((id) => `'${escapeString(id)}'`).join(' ');
  const tokenLit = `'${escapeString(token)}'`;
  return `| undoCls |
undoCls := System myUserProfile symbolList objectNamed: #GsRefactoringUndo.
undoCls isNil
  ifTrue: [${engineClassName} applyForToken: ${tokenLit} deselected: #(${ids})]
  ifFalse: [undoCls
      perform: #recordAndApplyForToken:engine:deselected:label:
      withArguments: (Array
        with: ${tokenLit}
        with: '${escapeString(engineClassName)}'
        with: #(${ids})
        with: '${escapeString(label)}')]`;
}
