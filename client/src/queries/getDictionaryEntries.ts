import { QueryExecutor } from './types';
import { escapeString } from './util';

export interface DictEntry {
  isClass: boolean;
  category: string;
  name: string;
}

// Accepts a dictionary by 1-based index (Jasper's IDE) or by name (MCP
// clients). With a name, returns [] if no dict by that name exists.
export function getDictionaryEntries(execute: QueryExecutor, dict: number | string): DictEntry[] {
  const dictExpr =
    typeof dict === 'number'
      ? `System myUserProfile symbolList at: ${dict}`
      : `System myUserProfile symbolList objectNamed: #'${escapeString(dict)}'`;
  const code = `| ws dict |
dict := ${dictExpr}.
dict ifNil: [^ ''].
ws := WriteStream on: Unicode7 new.
dict keysAndValuesDo: [:k :v |
  v isBehavior
    ifTrue: [ws nextPutAll: '1'; tab; nextPutAll: (v category ifNil: ['']); tab; nextPutAll: k; lf]
    ifFalse: [ws nextPutAll: '0'; tab; tab; nextPutAll: k asString; lf]].
ws contents`;

  const raw = execute(code);

  const results: DictEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const name = parts[2];
    if (name.length > 0) {
      results.push({ isClass: parts[0] === '1', category: parts[1], name });
    }
  }
  return results;
}
