import { QueryExecutor } from '../types';
import { escapeString } from '../util';

export interface RowanExportResult {
  success: boolean;
  // On success, the directory written to; on failure, the error message.
  detail: string;
}

// Export a loaded Rowan project as a self-sufficient standalone copy into
// `targetDir`, without touching the image or the project's own repository.
//
// The recipe (verified against a 3.7.5 stone as a deterministic, reload-faithful
// fixpoint): take the loaded project's definition (a copy), redirect its disk
// repository root to the target, write the project artifacts, then ALSO write the
// load specification — `writeResolvedProject:` deliberately omits the load spec,
// and without it the copy cannot be reloaded. `asDefinition` + `writeResolvedProject:`
// have no image side effects (no dirty-flag changes, unlike `writeProjectNamed:`).
export function exportRowanProject(
  execute: QueryExecutor,
  projectName: string,
  targetDir: string,
): RowanExportResult {
  const code = `| r lp def sep |
sep := String with: Character tab.
r := System myUserProfile symbolList objectNamed: #'Rowan'.
r isNil ifTrue: [^'ERR' , sep , 'Rowan is not installed in this image'].
lp := r image loadedProjectNamed: '${escapeString(projectName)}' ifAbsent: [nil].
lp isNil ifTrue: [^'ERR' , sep , 'Project ${escapeString(projectName)} is not loaded'].
[def := lp asDefinition.
 def diskRepositoryRoot: '${escapeString(targetDir)}'.
 r projectTools write writeResolvedProject: def.
 def exportLoadSpecification]
  on: Error do: [:e | ^'ERR' , sep , e messageText].
'OK' , sep , '${escapeString(targetDir)}'`;

  const raw = execute(code);
  const tab = raw.indexOf('\t');
  const status = tab === -1 ? raw.trim() : raw.slice(0, tab);
  const detail = tab === -1 ? '' : raw.slice(tab + 1).trim();
  return { success: status === 'OK', detail };
}
