import { QueryExecutor } from './types';
import { escapeString } from './util';

// Move a class from one dictionary to another. Not committed automatically.
export function moveClass(
  execute: QueryExecutor,
  srcDictIndex: number,
  destDictIndex: number,
  className: string,
): string {
  const esc = escapeString(className);
  const code = `| cls srcDict destDict |
srcDict := System myUserProfile symbolList at: ${srcDictIndex}.
destDict := System myUserProfile symbolList at: ${destDictIndex}.
cls := srcDict removeKey: #'${esc}' ifAbsent: [nil].
cls ifNil: [^ 'Class not found in source dictionary: ${esc}'].
destDict at: #'${esc}' put: cls.
'Moved class: ' , cls name`;
  return execute(code);
}
