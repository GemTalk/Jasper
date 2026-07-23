import { QueryExecutor } from './types';

// Move a dictionary one position later in the user's symbolList.
// Not committed automatically.
export function moveDictionaryDown(execute: QueryExecutor, dictIndex: number): string {
  const code = `| sl temp |
sl := System myUserProfile symbolList.
${dictIndex} < sl size ifTrue: [
  temp := sl at: ${dictIndex}.
  sl at: ${dictIndex} put: (sl at: ${dictIndex} + 1).
  sl at: ${dictIndex} + 1 put: temp].
'ok'`;
  return execute(code);
}
