import { QueryExecutor } from '../../queries/types';
import { escapeString } from '../../queries/util';

// True when `name` is already bound to a global anywhere on the current session's
// symbol list (any dictionary). Used to reject a rename-class target that would
// collide with an existing class or other global BEFORE previewing, so the user
// can pick another name.
export function globalNameInUse(execute: QueryExecutor, name: string): boolean {
  return (
    execute(
      `(System myUserProfile symbolList objectNamed: #'${escapeString(name)}') notNil printString`,
    ).trim() === 'true'
  );
}
