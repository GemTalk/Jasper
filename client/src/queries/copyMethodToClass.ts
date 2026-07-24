import { QueryExecutor } from './types';
import { classLookupExpr, escapeString } from './util';

// Copy a method from one class to another (same instance/class side), preserving
// its source and category. Compiles the source into the target via
// Behavior>>compileMethod:dictionaries:category:environmentId:; on a CompileError
// the executor surfaces the thrown Error. Not committed automatically.
// `dict` is optional; when given, disambiguates shadowed class names.
export function copyMethodToClass(
  execute: QueryExecutor,
  sourceClass: string,
  targetClass: string,
  isMeta: boolean,
  selector: string,
  environmentId: number = 0,
  dict?: number | string,
): string {
  const sel = escapeString(selector);
  const side = isMeta ? ' class' : '';
  const at =
    environmentId === 0
      ? `compiledMethodAt: #'${sel}'`
      : `compiledMethodAt: #'${sel}' environmentId: ${environmentId}`;
  const code = `| src target srcRecv tgtRecv source category |
src := ${classLookupExpr(sourceClass, dict)}.
src ifNil: [^ 'Source class not found: ${escapeString(sourceClass)}'].
target := ${classLookupExpr(targetClass, dict)}.
target ifNil: [^ 'Target class not found: ${escapeString(targetClass)}'].
srcRecv := src${side}.
tgtRecv := target${side}.
(srcRecv includesSelector: #'${sel}') ifFalse: [^ 'Method not found: ${sel}'].
source := (srcRecv ${at}) sourceString.
category := srcRecv categoryOfSelector: #'${sel}'.
tgtRecv
  compileMethod: source
  dictionaries: System myUserProfile symbolList
  category: (category ifNil: ['as yet unclassified']) asString
  environmentId: ${environmentId}.
'Copied: ' , tgtRecv name , ' >> ${sel}'`;
  return execute(code);
}
