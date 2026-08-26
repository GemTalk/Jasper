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
// Method history: the JasperMethodHistory helper (installed at login via
// SessionTemps — see methodHistory/methodHistoryServer.ts, no plugin required)
// brackets the compile: it seeds the method's history with the about-to-be-replaced
// source the first time a method is edited, then records the newly-compiled source
// as a timestamped version. Both calls are guarded and skipped when the helper is
// absent (a session where its install did not run), so this stays a no-op there and
// never changes the compile's success/error contract or return string.
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
hist := SessionTemps current at: #JasperMethodHistory otherwise: nil.
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
