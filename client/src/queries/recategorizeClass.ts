import { QueryExecutor } from './types';
import { classLookupExpr, escapeString } from './util';

// Move a class to a different class category (Class>>category:). Not committed
// automatically. `dict` is optional; when given, disambiguates shadowed names.
export async function recategorizeClass(
  execute: QueryExecutor,
  className: string,
  newCategory: string,
  dict?: number | string,
): Promise<string> {
  const esc = escapeString(className);
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls ifNil: [^ 'Class not found: ${esc}'].
cls isBehavior ifFalse: [^ 'Not a class: ${esc}'].
cls category: '${escapeString(newCategory)}'.
'Recategorized: ' , cls name`;
  return await execute(code);
}
