import { QueryExecutor } from './types';
import { escapeString } from './util';

// Destructive. Not committed automatically. Accepts a dict by 1-based index
// or by name — required because deletion must target a specific dictionary
// (otherwise a shadowed name would be ambiguous).
export function deleteClass(
  execute: QueryExecutor,
  dict: number | string,
  className: string,
): string {
  const esc = escapeString(className);
  const dictExpr =
    typeof dict === 'number'
      ? `System myUserProfile symbolList at: ${dict}`
      : `System myUserProfile symbolList objectNamed: #'${escapeString(dict)}'`;
  const code = `| d removed |
d := ${dictExpr}.
d ifNil: [^ 'Dictionary not found'].
removed := d removeKey: #'${esc}' ifAbsent: [nil].
removed ifNil: ['Class not found: ${esc}'] ifNotNil: ['Deleted class: ' , removed name]`;
  return execute(code);
}
