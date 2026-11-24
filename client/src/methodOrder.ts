/**
 * The one order for every list of methods Jasper shows: VS Code's own rule for file names, so a
 * method list reads like the Explorer next to it. Symbols sort before letters, so operators and
 * private `_` methods stay together at the top; case and accents are ignored; digits compare by
 * value (`test2` before `test10`).
 *
 * Lists are sorted here rather than on the stone because GemStone's `asSortedCollection` folds
 * case to capitals first, which puts `\\`, `_foo` and `~=` after `Z`.
 */

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Selectors, method category names, and the class names of method rows. Never answers 0 for two
 *  different names: names the collator calls equal (differing only in case or accent, or
 *  canonically equal spellings) fall back to code-unit order, as VS Code's does, so a sort's
 *  result does not depend on its input order. */
export function compareNames(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

export interface MethodKey {
  className: string;
  isMeta: boolean;
  selector: string;
  dictName?: string;
  environmentId?: number;
}

/** Methods across classes: class name, instance side before class side, selector, then the
 *  dictionary and the environment for rows that carry them. */
export function compareMethods(a: MethodKey, b: MethodKey): number {
  return (
    compareNames(a.className, b.className) ||
    Number(a.isMeta) - Number(b.isMeta) ||
    compareNames(a.selector, b.selector) ||
    compareNames(a.dictName ?? '', b.dictName ?? '') ||
    (a.environmentId ?? 0) - (b.environmentId ?? 0)
  );
}
