import { QueryExecutor } from './types';
import { classLookupExpr, escapeString } from './util';

// Remove a method from a class. Not committed automatically.
// `dict` is optional; when given, disambiguates shadowed class names.
export function deleteMethod(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
  selector: string,
  dict?: number | string,
): string {
  const esc = escapeString(className);
  const sel = escapeString(selector);
  const code = `| base target |
base := ${classLookupExpr(className, dict)}.
base ifNil: [^ 'Class not found: ${esc}'].
base isBehavior ifFalse: [^ 'Not a class: ${esc}'].
target := ${isMeta ? 'base class' : 'base'}.
(target includesSelector: #'${sel}') ifFalse: [^ 'Selector not found: ' , target name , ' >> ${sel}'].
target removeSelector: #'${sel}'.
'Deleted: ' , target name , ' >> ${sel}'`;
  return execute(code);
}
