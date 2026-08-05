import { QueryExecutor } from './types';
import { escapeString } from './util';

// Create a new SymbolDictionary and append it to the user's symbolList.
// Not committed automatically.
export function addDictionary(execute: QueryExecutor, dictName: string): string {
  const code = `| dict |
dict := SymbolDictionary new.
dict name: #'${escapeString(dictName)}'.
System myUserProfile symbolList add: dict.
'Added dictionary: ' , dict name`;
  return execute(code);
}
