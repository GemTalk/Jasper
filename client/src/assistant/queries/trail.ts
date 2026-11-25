import type { MethodSearchResult } from '../../queries/methodSearch';
import { classLookupExpr, escapeString, isValidSelector } from '../../queries/util';

export interface TrailStep {
  className: string;
  dictionary?: string;
  classSide?: boolean;
  selector: string;
  note: string;
}

export interface FoundStep {
  method: MethodSearchResult;
  note: string;
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
      found.push({ method: m, note: step.note });
      next++;
    } else {
      missing.push(step);
    }
  }
  return { found, missing };
}
