import { QueryExecutor } from './types';

// Move a dictionary one position earlier in the user's symbolList.
// Not committed automatically.
export function moveDictionaryUp(execute: QueryExecutor, dictIndex: number): string {
  const code = `| sl temp |
sl := System myUserProfile symbolList.
${dictIndex} > 1 ifTrue: [
  temp := sl at: ${dictIndex}.
  sl at: ${dictIndex} put: (sl at: ${dictIndex} - 1).
  sl at: ${dictIndex} - 1 put: temp].
'ok'`;
  return execute(code);
}
