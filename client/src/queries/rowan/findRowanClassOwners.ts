import { QueryExecutor } from '../types';
import { escapeString } from '../util';

export interface RowanClassOwner {
  project: string;
  package: string;
}

export interface RowanClassOwners {
  // Packages that define the class.
  defined: RowanClassOwner[];
  // Packages that extend the class (add methods to it).
  extended: RowanClassOwner[];
}

// Reverse lookup: which loaded Rowan packages define or extend a class of the
// given name. Scans every loaded project's packages (the image-level
// loadedClassNamed: doesn't resolve classes that live outside the connected
// user's symbolList, e.g. STON's in UserGlobals). Rows are tagged D/X.
export function findRowanClassOwners(execute: QueryExecutor, className: string): RowanClassOwners {
  const esc = escapeString(className);
  const code = `| r img ws |
r := System myUserProfile symbolList objectNamed: #'Rowan'.
r isNil ifTrue: [^''].
img := r image.
ws := WriteStream on: Unicode7 new.
[r projectNames asSortedCollection do: [:pn | | proj |
  proj := [img loadedProjectNamed: pn] on: Error do: [:e | nil].
  proj ifNotNil: [:p |
    [p loadedPackages keysAndValuesDo: [:pkgName :pkg |
      (pkg loadedClasses includesKey: '${esc}') ifTrue: [ws nextPutAll: 'D'; tab; nextPutAll: pn asString; tab; nextPutAll: pkgName asString; lf].
      (pkg loadedClassExtensions includesKey: '${esc}') ifTrue: [ws nextPutAll: 'X'; tab; nextPutAll: pn asString; tab; nextPutAll: pkgName asString; lf]]] on: Error do: [:e | nil]]]]
  on: Error do: [:e | nil].
ws contents`;

  const raw = execute(code);

  const owners: RowanClassOwners = { defined: [], extended: [] };
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const entry: RowanClassOwner = { project: parts[1], package: parts[2] };
    if (parts[0] === 'D') owners.defined.push(entry);
    else if (parts[0] === 'X') owners.extended.push(entry);
  }
  return owners;
}
