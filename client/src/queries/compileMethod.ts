import { QueryExecutor } from './types';
import { classLookupExpr, escapeString } from './util';

// Compile (add or update) a method via Behavior>>compileMethod:dictionaries:
// category:environmentId:. On CompileError/CompileWarning, Smalltalk raises
// and GCI surfaces the exception message (line/position/reason) through the
// executor's thrown Error — callers can parse or display it.
//
// Not committed automatically. Returns a short confirmation on success.
// `dict` is optional; when given, disambiguates shadowed class names.
//
// Method history: when the refactoring engine is loaded, GsMethodHistory brackets
// the compile — it seeds the method's history with the about-to-be-replaced source
// the first time a method is edited, then records the newly-compiled source as a
// timestamped version (see gs-src/refactoring/engine/GsMethodHistory.class.st).
// Both calls are guarded server-side and skipped entirely when the engine is
// absent (`objectNamed: #GsMethodHistory` is nil), so this stays a no-op on a base
// stone and never changes the compile's success/error contract or return string.
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
  const src = escapeString(source);
  const cat = escapeString(category);
  const code = `| base target result hist |
base := ${classLookupExpr(className, dict)}.
base ifNil: [^ 'Class not found: ${esc}'].
base isBehavior ifFalse: [^ 'Not a class: ${esc}'].
target := ${isMeta ? 'base class' : 'base'}.
hist := System myUserProfile symbolList objectNamed: #GsMethodHistory.
hist ifNotNil: [:h | h beforeCompileIn: target source: '${src}' environmentId: ${environmentId}].
result := target
  compileMethod: '${src}'
  dictionaries: System myUserProfile symbolList
  category: '${cat}'
  environmentId: ${environmentId}.
hist ifNotNil: [:h | h afterCompileIn: target method: result source: '${src}' category: '${cat}'].
'Compiled: ' , target name , ' >> ' , result selector asString`;
  return execute(code);
}
