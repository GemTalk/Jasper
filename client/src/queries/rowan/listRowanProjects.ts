import { QueryExecutor } from '../types';

export interface RowanProject {
  name: string;
  isDirty: boolean;
  // Shipped with the GemStone image (Rowan, Cypress, STON, ...) rather than
  // loaded by the user. Built-in projects store their projectUrl with a
  // literal, unexpanded `$GEMSTONE` prefix -- that IS the discriminator; the
  // pseudo-project UnPackaged has no url at all and counts as built-in too.
  isBuiltin: boolean;
}

export interface RowanProjectList {
  // false when Rowan is not installed in the image at all.
  available: boolean;
  projects: RowanProject[];
}

const NO_ROWAN = '!NO_ROWAN';

// List every project loaded via Rowan, with its dirty flag and whether it
// shipped with the image. `Rowan projectNames` already returns the *loaded*
// project names; the dirty flag comes from the loaded project
// (Rowan image loadedProjectNamed:), which is also the object all the
// package/class traversal uses.
export function listRowanProjects(execute: QueryExecutor): RowanProjectList {
  const code = `| ws rowan img names |
rowan := System myUserProfile symbolList objectNamed: #'Rowan'.
rowan isNil ifTrue: [^'${NO_ROWAN}'].
img := rowan image.
ws := WriteStream on: Unicode7 new.
names := [rowan projectNames asSortedCollection asArray] on: Error do: [:e | #()].
names do: [:projName | | proj dirty url builtin |
  proj := [img loadedProjectNamed: projName] on: Error do: [:e | nil].
  dirty := proj isNil ifTrue: [false] ifFalse: [[proj isDirty] on: Error do: [:e | false]].
  url := proj isNil ifTrue: [nil] ifFalse: [[proj projectUrl] on: Error do: [:e | nil]].
  builtin := url isNil or: [url asString beginsWith: 'file:$GEMSTONE'].
  ws nextPutAll: projName asString; tab;
     nextPutAll: dirty printString; tab;
     nextPutAll: builtin printString; lf].
ws contents`;

  const raw = execute(code);
  if (raw.trim() === NO_ROWAN) return { available: false, projects: [] };

  const projects: RowanProject[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const [name, dirty, builtin] = line.split('\t');
    if (!name) continue;
    projects.push({
      name,
      isDirty: dirty === 'true',
      isBuiltin: builtin === 'true',
    });
  }
  return { available: true, projects };
}
