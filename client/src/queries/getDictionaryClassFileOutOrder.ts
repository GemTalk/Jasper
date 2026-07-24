import { QueryExecutor } from './types';
import { escapeString, splitLines } from './util';

// Class names in a dictionary, ordered so that a class always appears after any
// of its superclasses (ascending inheritance depth, then name). Filing the
// per-class file-outs back in in this order guarantees a superclass that lives
// in the same dictionary is defined before its subclass's definition is read.
//
// Accepts a dictionary by 1-based index (canonical for Jasper's IDE) or by name.
// Returns [] when the dictionary does not exist.
export function getDictionaryClassFileOutOrder(
  execute: QueryExecutor,
  dict: number | string,
): string[] {
  const dictExpr =
    typeof dict === 'number'
      ? `System myUserProfile symbolList at: ${dict}`
      : `System myUserProfile symbolList objectNamed: #'${escapeString(dict)}'`;
  const code = `| ws dict |
dict := ${dictExpr}.
dict ifNil: [^ ''].
ws := WriteStream on: String new.
dict keysAndValuesDo: [:k :v |
  v isBehavior ifTrue: [ | depth sc |
    depth := 0.
    sc := v superclass.
    [sc notNil] whileTrue: [depth := depth + 1. sc := sc superclass].
    ws nextPutAll: depth printString; tab; nextPutAll: k; lf]].
ws contents`;
  return splitLines(execute(code))
    .map((line) => {
      const tab = line.indexOf('\t');
      return { depth: parseInt(line.slice(0, tab), 10), name: line.slice(tab + 1) };
    })
    .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name))
    .map((e) => e.name);
}
