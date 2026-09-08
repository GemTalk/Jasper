import { QueryExecutor } from './types';
import { escapeString, dictLookupExpr } from './util';
import { clearClassOrganizerStatement } from './classOrganizer';

// Destructive. Not committed automatically. Accepts a dict by 1-based index
// or by name — required because deletion must target a specific dictionary
// (otherwise a shadowed name would be ambiguous).
export function deleteClass(
  execute: QueryExecutor,
  dict: number | string,
  className: string,
): string {
  const esc = escapeString(className);
  const dictExpr = dictLookupExpr(dict);
  const code = `| d removed |
d := ${dictExpr}.
d ifNil: [^ 'Dictionary not found'].
removed := d removeKey: #'${esc}' ifAbsent: [nil].
${clearClassOrganizerStatement()}
removed ifNil: ['Class not found: ${esc}'] ifNotNil: ['Deleted class: ' , removed name]`;
  return execute(code);
}
