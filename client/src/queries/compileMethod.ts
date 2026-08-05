import { QueryExecutor } from './types';
import { classLookupExpr, escapeString } from './util';

// Compile (add or update) a method via Behavior>>compileMethod:dictionaries:
// category:environmentId:. On CompileError/CompileWarning, Smalltalk raises
// and GCI surfaces the exception message (line/position/reason) through the
// executor's thrown Error — callers can parse or display it.
//
// Not committed automatically. Returns a short confirmation on success.
// `dict` is optional; when given, disambiguates shadowed class names.
export function compileMethod(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
  category: string,
  source: string,
  environmentId: number = 0,
  dict?: number | string,
): string {
  const esc = escapeString(className);
  const code = `| base target result |
base := ${classLookupExpr(className, dict)}.
base ifNil: [^ 'Class not found: ${esc}'].
base isBehavior ifFalse: [^ 'Not a class: ${esc}'].
target := ${isMeta ? 'base class' : 'base'}.
result := target
  compileMethod: '${escapeString(source)}'
  dictionaries: System myUserProfile symbolList
  category: '${escapeString(category)}'
  environmentId: ${environmentId}.
'Compiled: ' , target name , ' >> ' , result selector asString`;
  return execute(code);
}
