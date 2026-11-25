import type { MethodSearchResult } from '../../queries/methodSearch';
import { classLookupExpr, escapeString, isValidSelector } from '../../queries/util';

export interface TrailStep {
  className: string;
  dictionary?: string;
  classSide?: boolean;
  selector: string;
  note: string;
  /** 0 for a main step; one more than the step above for a method that step sends. */
  depth?: number;
  /** The code in the method the note is about, copied from its source. */
  focus?: string;
}

export interface FoundStep {
  method: MethodSearchResult;
  note: string;
  depth?: number;
  focus?: string;
}

/** Smalltalk answering each step's method, for methodsFromCode, in step order. A step whose class
 *  or method is not there, or whose selector is not one, answers nothing; an inherited method
 *  answers the method where it is defined. */
export function trailCode(steps: readonly TrailStep[]): string {
  const lookups = steps.map((s) => {
    if (!isValidSelector(s.selector)) return 'nil';
    const cls = `(${classLookupExpr(s.className, s.dictionary)})`;
    const beh = s.classSide ? `${cls} ifNotNil: [:c | c class]` : cls;
    const sel = `#'${escapeString(s.selector)}'`;
    return `(((${beh}) ifNotNil: [:b | b whichClassIncludesSelector: ${sel}]) ifNotNil: [:w | w compiledMethodAt: ${sel}])`;
  });
  return `{ ${lookups.join('. ')} } reject: [:m | m isNil]`;
}

/** Where `focus` (code copied from `source`) is in it, as UTF-16 offsets, or undefined when it is
 *  not there. Spaces and line breaks may differ, since a copy rarely keeps the indentation. */
export function findFocus(
  source: string,
  focus: string,
): { start: number; end: number } | undefined {
  const exact = source.indexOf(focus);
  if (exact >= 0) return { start: exact, end: exact + focus.length };
  const words = focus.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const found = new RegExp(escaped.join('\\s+')).exec(source);
  return found ? { start: found.index, end: found.index + found[0].length } : undefined;
}

/** Pair each step with its method from `methods` (trailCode's answer, so in step order with the
 *  missing ones left out), and name the steps that found none. */
export function matchTrail(
  steps: readonly TrailStep[],
  methods: readonly MethodSearchResult[],
): { found: FoundStep[]; missing: TrailStep[] } {
  const found: FoundStep[] = [];
  const missing: TrailStep[] = [];
  let next = 0;
  for (const step of steps) {
    const m = methods[next];
    // Not the side: a class-side step can find an inherited instance method (`new` in Class).
    if (m && m.selector === step.selector) {
      found.push({ method: m, note: step.note, depth: step.depth, focus: step.focus });
      next++;
    } else {
      missing.push(step);
    }
  }
  return { found, missing };
}
