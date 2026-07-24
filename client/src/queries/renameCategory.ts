import { QueryExecutor } from './types';
import { escapeString, receiver } from './util';

// Rename a method category on a class. Not committed automatically.
export function renameCategory(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
  oldCategory: string,
  newCategory: string,
  dict?: number | string,
): string {
  const recv = receiver(className, isMeta, dict);
  const code = `${recv} renameCategory: '${escapeString(oldCategory)}' to: '${escapeString(newCategory)}'. 'ok'`;
  return execute(code);
}
