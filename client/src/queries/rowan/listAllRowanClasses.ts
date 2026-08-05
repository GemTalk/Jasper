import { QueryExecutor } from '../types';

export interface RowanClassLocation {
  name: string;
  project: string;
  package: string;
  // The class's home SymbolDictionary — needed to reveal it in the System
  // Browser (name lookup alone won't reach classes outside the user's list).
  symbolDict: string;
}

// Every class *defined* by a loaded Rowan package, with where it lives — the
// index behind cross-package class search. Extensions are excluded: they add
// methods to classes owned elsewhere, so they aren't "a class" to jump to.
export function listAllRowanClasses(execute: QueryExecutor): RowanClassLocation[] {
  const code = `| r img ws |
r := System myUserProfile symbolList objectNamed: #'Rowan'.
r isNil ifTrue: [^''].
img := r image.
ws := WriteStream on: Unicode7 new.
[r projectNames asSortedCollection do: [:pn | | proj |
  proj := [img loadedProjectNamed: pn] on: Error do: [:e | nil].
  proj ifNotNil: [:p |
    [p loadedPackages keysAndValuesDo: [:pkgName :pkg |
      pkg loadedClasses keysAndValuesDo: [:cn :lc |
        ws nextPutAll: cn asString; tab; nextPutAll: pn asString; tab; nextPutAll: pkgName asString; tab;
           nextPutAll: ([lc classSymbolDictionaryName] on: Error do: [:e | '']) asString; lf]]] on: Error do: [:e | nil]]]]
  on: Error do: [:e | nil].
ws contents`;

  const raw = execute(code);

  const classes: RowanClassLocation[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    classes.push({ name: parts[0], project: parts[1], package: parts[2], symbolDict: parts[3] });
  }
  return classes;
}
