import { QueryExecutor } from './types';

// Execute a class-definition expression (e.g. "Object subclass: 'Foo' ... inDictionary: 'Globals'").
// The source embeds its own dictionary target, so no dict parameter is needed.
// Returns the class name on success. Not committed automatically.
export function compileClassDefinition(execute: QueryExecutor, source: string): string {
  // Wrap so the result is a String (the class name) — GciTsExecuteFetchBytes
  // requires a byte-object result, but class definitions return a Class.
  const code = `(${source}) name`;
  return execute(code);
}
