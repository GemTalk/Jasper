import { QueryExecutor } from './types';
import { clearClassOrganizerStatement } from './classOrganizer';

// Execute a class-definition expression (e.g. "Object subclass: 'Foo' ... inDictionary: 'Globals'").
// The source embeds its own dictionary target, so no dict parameter is needed.
// Returns the class name on success. Not committed automatically.
export function compileClassDefinition(execute: QueryExecutor, source: string): string {
  // Wrap so the result is a String (the class name) — GciTsExecuteFetchBytes
  // requires a byte-object result, but class definitions return a Class.
  //
  // The cached ClassOrganizer goes with it, in the same doit: this is one of the
  // two things that changes the SET of classes, which is the one thing a reused
  // organizer cannot see (it captured a class list when it was built). Clearing
  // here rather than from the caller keeps the invalidation attached to the
  // mutation, so a new call site cannot forget it.
  const code = `| cls |
cls := (${source}).
${clearClassOrganizerStatement()}
cls name`;
  return execute(code);
}
