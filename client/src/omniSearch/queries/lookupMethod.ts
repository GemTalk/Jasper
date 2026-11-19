import { QueryExecutor } from '../../queries/types';
import {
  escapeString,
  homeDictionaryNameExpr,
  isValidSelector,
  splitLines,
} from '../../queries/util';
import { SelectorSearchResult, parseSelectorSearchResults } from '../../queries/searchSelectors';

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
 * metaclass chain ends in `Class`, so `Foo class>>new` may be `Behavior>>new`. A defining class no
 * dictionary binds gives no row, since there would be nothing to open it in.
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
  // Existing symbols only: interning the name of each half-typed selector would add it to the
  // stone for good, and a name with no symbol can't name a class or a method anyway.
  return `| ws symbols sel name seen definers |
sel := Symbol _existingWithAll: '${escapeString(selector)}'.
name := Symbol _existingWithAll: '${escapeString(className)}'.
(sel == nil or: [name == nil]) ifTrue: [^ ''].
ws := WriteStream on: String new.
symbols := System myUserProfile symbolList.
seen := IdentitySet new.
definers := IdentitySet new.
symbols do: [:dict | | v cls definer home homeName |
  v := dict at: name ifAbsent: [nil].
  (v ~~ nil and: [v isBehavior and: [(seen includes: v) not]]) ifTrue: [
    seen add: v.
    cls := ${isMeta ? 'v class' : 'v'}.
    definer := cls whichClassIncludesSelector: sel environmentId: 0.
    (definer ~~ nil and: [(definers includes: definer) not]) ifTrue: [
      definers add: definer.
      home := definer theNonMetaClass.
      homeName := ${homeDictionaryNameExpr('home')}.
      homeName isEmpty ifFalse: [
        ws nextPutAll: homeName; tab;
           nextPutAll: home name; tab;
           nextPutAll: (definer isMeta ifTrue: ['1'] ifFalse: ['0']); tab;
           nextPutAll: sel; tab;
           nextPutAll: ((definer categoryOfSelector: sel environmentId: 0) ifNil: ['']); tab.
        definer == cls ifFalse: [ws nextPutAll: v name. ${isMeta ? "ws nextPutAll: ' class'" : ''}].
        ws lf]]]].
ws contents`;
}

export function parseMethodLookupResults(raw: string): MethodLookupResult[] {
  return splitLines(raw).flatMap((line) => {
    const [row] = parseSelectorSearchResults(line);
    if (!row) return [];
    const inheritedBy = line.split('\t')[5];
    return [inheritedBy ? { ...row, inheritedBy } : row];
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
