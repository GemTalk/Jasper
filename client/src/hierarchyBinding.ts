import type { ClassHierarchyEntry } from './queries/getClassHierarchy';

type Unbound = Exclude<ClassHierarchyEntry['binding'], 'bound'>;

/** What a hierarchy row no dictionary binds under its own name shows beside its name. */
export function unboundHierarchyMarker(binding: Unbound): string {
  if (binding === 'superseded') return '(old version)';
  if (binding === 'aliased') return '(alias only)';
  return '(unbound)';
}

/** Why such a row cannot be reached through a dictionary, in full. */
export function unboundHierarchyTooltip(className: string, binding: Unbound): string {
  if (binding === 'aliased') {
    return (
      `${className} — held only under another name.\n\n` +
      'A dictionary holds this class, but not under its own name, so commands that look a class ' +
      'up by its name in a dictionary cannot reach it. Browse it through the name it is bound under.'
    );
  }
  if (binding === 'unbound') {
    return (
      `${className} — no class of this name is bound in any dictionary.\n\n` +
      'It is still this class\u2019s real superclass, but it has been removed from the symbol ' +
      'list, so commands that work through a dictionary cannot reach it.'
    );
  }
  return (
    `${className} — an older version.\n\n` +
    `The name ${className} now binds a newer version of the class. This one is still real, and ` +
    'still the superclass of the class below it, but no dictionary holds it, so Class History, ' +
    'Rename, Insert/Extract Superclass and Split cannot act on it.\n\n' +
    'Redefining a class does not carry its subclasses onto the new version. This row appears ' +
    'after a redefinition made outside a refactoring — and after a refactoring that failed ' +
    'part-way, which stops at the first failure with the classes before it already re-versioned. ' +
    'If that is what happened, Undo reverses it and puts the subtree back together.'
  );
}
