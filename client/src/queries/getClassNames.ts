import { QueryExecutor } from './types';
import { escapeString, splitLines } from './util';

// Accepts a dictionary by 1-based index (canonical for Jasper's IDE) or by
// name (convenient for MCP clients that don't want to enumerate first).
// With a name, returns [] if no dict by that name exists.
export function getClassNames(execute: QueryExecutor, dict: number | string): string[] {
  const dictExpr =
    typeof dict === 'number'
      ? `System myUserProfile symbolList at: ${dict}`
      : `System myUserProfile symbolList objectNamed: #'${escapeString(dict)}'`;
  const code = `| ws dict |
dict := ${dictExpr}.
dict ifNil: [^ ''].
ws := WriteStream on: String new.
dict keysAndValuesDo: [:k :v |
  v isBehavior ifTrue: [ws nextPutAll: k; lf]].
ws contents`;
  return splitLines(execute(code)).sort();
}
