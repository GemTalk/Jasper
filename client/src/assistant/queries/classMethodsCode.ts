import { ClassNameEntry } from '../../queries/getAllClassNames';
import { classLookupExpr } from '../../queries/util';

/** Smalltalk answering the methods of `classes`, for methodsFromCode: each class's instance side
 *  then its class side, sorted by selector. */
export function classMethodsCode(classes: readonly ClassNameEntry[]): string {
  const lookups = classes.map((c) => `(${classLookupExpr(c.className, c.dictIndex)})`).join('. ');
  return `| ms |
ms := OrderedCollection new.
{ ${lookups} } do: [:cls |
  { cls. cls class } do: [:beh |
    beh selectors asSortedCollection do: [:sel | ms add: (beh compiledMethodAt: sel)]]].
ms`;
}
