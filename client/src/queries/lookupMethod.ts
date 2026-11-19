import { QueryExecutor } from './types';
import { escapeString, isValidSelector, splitLines } from './util';
import { SelectorSearchResult } from './searchSelectors';

/**
 * Find the one method a `Class>>selector` reference names — on that class, or on the ancestor it
 * inherits it from. The backend for pasting a method reference into GemStone Search (issue #677).
 *
 * One row per method found: normally one, two only when two dictionaries hold different classes
 * under the same name and they reach different methods. Two such classes that inherit the same
 * method give one row, since both rows would read and open the same. Exact case, environment 0 (the
 * environment the Methods scope reports).
 *
 * Row: `dictName<TAB>className<TAB>isMeta(0|1)<TAB>selector<TAB>category<TAB>inheritedBy`, where the
 * class and dictionary are the DEFINING class's and `inheritedBy` is empty when the named class
 * defines the method itself. A class-side reference can resolve to an instance-side method: the
 * metaclass chain ends in `Class`, so `Foo class>>new` may be `Behavior>>new`.
 */
export interface MethodLookupResult extends SelectorSearchResult {
  /** The class the reference named (`Foo` or `Foo class`), when it inherits the method. */
  inheritedBy?: string;
}

const CLASS_NAME = /^[A-Za-z_]\w*$/;

export function buildMethodLookupCode(
  className: string,
  isMeta: boolean,
  selector: string,
): string {
  return `| ws sl sel seen definers |
ws := WriteStream on: String new.
sl := System myUserProfile symbolList.
sel := #'${escapeString(selector)}'.
seen := IdentitySet new.
definers := IdentitySet new.
sl do: [:dict | | v cls definer home homeDict |
  v := dict at: #'${escapeString(className)}' ifAbsent: [nil].
  (v ~~ nil and: [v isBehavior and: [(seen includes: v) not]]) ifTrue: [
    seen add: v.
    cls := ${isMeta ? 'v class' : 'v'}.
    definer := cls whichClassIncludesSelector: sel environmentId: 0.
    (definer ~~ nil and: [(definers includes: definer) not]) ifTrue: [
      definers add: definer.
      home := definer theNonMetaClass.
      homeDict := sl detect: [:d | (d at: home name ifAbsent: [nil]) == home] ifNone: [dict].
      ws nextPutAll: homeDict name; tab;
         nextPutAll: home name; tab;
         nextPutAll: (definer isMeta ifTrue: ['1'] ifFalse: ['0']); tab;
         nextPutAll: sel; tab;
         nextPutAll: ((definer categoryOfSelector: sel environmentId: 0) ifNil: ['']); tab.
      definer == cls ifFalse: [ws nextPutAll: v name. ${isMeta ? "ws nextPutAll: ' class'" : ''}].
      ws lf]]].
ws contents`;
}

export function parseMethodLookupResults(raw: string): MethodLookupResult[] {
  return splitLines(raw).flatMap((line) => {
    const [dictName, className, meta, selector, category, inheritedBy] = line.split('\t');
    if (selector === undefined) return [];
    const row: MethodLookupResult = {
      dictName,
      className,
      isMeta: meta === '1',
      selector,
      category: category ?? '',
    };
    if (inheritedBy) row.inheritedBy = inheritedBy;
    return [row];
  });
}

export function lookupMethod(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
  selector: string,
): MethodLookupResult[] {
  if (!CLASS_NAME.test(className) || !isValidSelector(selector)) return [];
  return parseMethodLookupResults(execute(buildMethodLookupCode(className, isMeta, selector)));
}
