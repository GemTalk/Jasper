import { QueryExecutor } from './types';
import { escapeString } from './util';

// Destructive. Not committed automatically. Accepts a dict by 1-based index
// or by name.
export function removeDictionary(execute: QueryExecutor, dict: number | string): string {
  const dictExpr =
    typeof dict === 'number'
      ? `System myUserProfile symbolList at: ${dict}`
      : `System myUserProfile symbolList objectNamed: #'${escapeString(dict)}'`;
  const code = `| sl d |
sl := System myUserProfile symbolList.
d := ${dictExpr}.
d ifNil: [^ 'Dictionary not found'].
sl remove: d.
'Removed dictionary: ' , d name`;
  return execute(code);
}
