import { QueryExecutor } from '../../queries/types';
import { classLookupExpr, escapeString } from '../../queries/util';

/** One accessor method to compile: its selector and full source. */
export interface Accessor {
  selector: string;
  source: string;
}

/** The getter/setter pair for a variable, and the side they belong on. The selector
 *  is lowercase-first — a no-op for an already-lowercase instance-variable name, and
 *  lowercasing a capitalized class variable (e.g. `Registry` → `registry`/`registry:`)
 *  — while the method body references the variable by its ACTUAL name. Class-variable
 *  accessors go on the class side (`isMeta`). */
export function accessorSpecsFor(
  varName: string,
  kind: 'ivar' | 'classvar',
): { isMeta: boolean; accessors: Accessor[] } {
  const sel = varName.charAt(0).toLowerCase() + varName.slice(1);
  return {
    isMeta: kind === 'classvar',
    accessors: [
      { selector: sel, source: `${sel}\n\t^${varName}` },
      { selector: `${sel}:`, source: `${sel}: aValue\n\t${varName} := aValue` },
    ],
  };
}

/** Outcome of an add-accessors run. */
export interface AddAccessorsResult {
  created: number;
  skipped: number;
  /** True when the class name could not be resolved through the dictionary. */
  noClass: boolean;
}

/** Compile the given accessor methods onto a class, skipping any whose selector the
 *  class already implements (never clobbering a hand-written accessor). `isMeta`
 *  targets the class side (class-variable accessors) vs the instance side
 *  (instance-variable accessors). Methods land in the `accessing` category. The
 *  change is not committed. */
export function addAccessors(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
  accessors: Accessor[],
  dict?: number | string,
): AddAccessorsResult {
  const target = isMeta ? 'c class' : 'c';
  const addLines = accessors
    .map((a) => `add value: #'${escapeString(a.selector)}' value: '${escapeString(a.source)}'.`)
    .join('\n');
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls ifNil: ['no-class'] ifNotNil: [:c | | tgt add created skipped |
  tgt := ${target}.
  created := 0. skipped := 0.
  add := [:sel :src | (tgt includesSelector: sel)
    ifTrue: [skipped := skipped + 1]
    ifFalse: [tgt compileMethod: src dictionaries: System myUserProfile symbolList category: 'accessing'. created := created + 1]].
${addLines}
  'created:', created printString, ' skipped:', skipped printString]`;
  const raw = execute(code).trim();
  if (raw === 'no-class') return { created: 0, skipped: 0, noClass: true };
  const created = Number(/created:(\d+)/.exec(raw)?.[1] ?? 0);
  const skipped = Number(/skipped:(\d+)/.exec(raw)?.[1] ?? 0);
  return { created, skipped, noClass: false };
}
