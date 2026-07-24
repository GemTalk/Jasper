import { QueryExecutor } from './types';
import { escapeString, receiver } from './util';

// Source of the PERSISTENT (base) method that a session override shadows on the
// same class. Read straight from persistentMethodDictForEnv: — NOT the merged /
// session view (compiledMethodAt:, which would return the override itself).
// Returns a placeholder when there is no persistent implementation (i.e. the
// selector is a session-only extension, not an override).
export function getBaseMethodSource(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
  selector: string,
  environmentId: number = 0,
  dict?: number | string,
): string {
  const recv = receiver(className, isMeta, dict);
  const sel = escapeString(selector);
  // Single expression, ASCII-only literal: on 3.6.x the compiler miscomputes
  // source cursor positions (ComStrmSetCursor error 1001) when the compiled
  // source contains a non-ASCII character, so keep the placeholder plain ASCII.
  const code =
    `((${recv} persistentMethodDictForEnv: ${environmentId}) ` +
    `ifNotNil: [:d | d at: #'${sel}' otherwise: nil]) ` +
    `ifNil: ['"(no base method: this selector has no persistent implementation on this class)"'] ` +
    `ifNotNil: [:m | m sourceString]`;
  return execute(code);
}
