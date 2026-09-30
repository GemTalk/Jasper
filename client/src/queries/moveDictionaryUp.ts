import { QueryExecutor } from './types';

// Move a dictionary one position earlier in the user's symbolList.
// Not committed automatically.
export async function moveDictionaryUp(execute: QueryExecutor, dictIndex: number): Promise<string> {
  const code = `| sl temp |
sl := System myUserProfile symbolList.
${dictIndex} > 1 ifTrue: [
  temp := sl at: ${dictIndex}.
  sl at: ${dictIndex} put: (sl at: ${dictIndex} - 1).
  sl at: ${dictIndex} - 1 put: temp].
'ok'`;
  return await execute(code);
}
