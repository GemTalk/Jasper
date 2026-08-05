import { QueryExecutor } from './types';
import { escapeString, receiver } from './util';

// Move an existing method to a different category. Not committed automatically.
export function recategorizeMethod(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
  selector: string,
  newCategory: string,
  dict?: number | string,
): string {
  const recv = receiver(className, isMeta, dict);
  const code = `${recv} moveMethod: #'${escapeString(selector)}' toCategory: '${escapeString(newCategory)}'. 'ok'`;
  return execute(code);
}
