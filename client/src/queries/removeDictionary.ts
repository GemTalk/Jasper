import { QueryExecutor } from './types';
import { dictLookupExpr } from './util';

// Destructive. Not committed automatically. Accepts a dict by 1-based index
// or by name.
export async function removeDictionary(
  execute: QueryExecutor,
  dict: number | string,
): Promise<string> {
  const dictExpr = dictLookupExpr(dict);
  const code = `| sl d |
sl := System myUserProfile symbolList.
d := ${dictExpr}.
d ifNil: [^ 'Dictionary not found'].
sl remove: d.
'Removed dictionary: ' , d name`;
  return await execute(code);
}
