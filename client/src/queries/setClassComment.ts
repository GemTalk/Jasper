import { QueryExecutor } from './types';
import { classLookupExpr, escapeString } from './util';

// Set the class comment (docstring equivalent). Not committed automatically.
// `dict` is optional; when given, disambiguates shadowed class names.
export function setClassComment(
  execute: QueryExecutor,
  className: string,
  comment: string,
  dict?: number | string,
): string {
  const esc = escapeString(className);
  const code = `| cls |
cls := ${classLookupExpr(className, dict)}.
cls ifNil: [^ 'Class not found: ${esc}'].
cls isBehavior ifFalse: [^ 'Not a class: ${esc}'].
cls comment: '${escapeString(comment)}'.
'Comment set: ' , cls name`;
  return execute(code);
}
