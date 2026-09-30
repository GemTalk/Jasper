import type { ActiveSession } from './sessionManager';

/**
 * Evaluates `code` in `session` and answers its result as a UTF-8 decoded
 * string.
 *
 * Still backed by the blocking GCI fetch, so the event loop stays frozen for
 * the whole evaluation and the returned promise is already settled by the
 * time it is returned. It is a promise so every caller already awaits it,
 * letting the fetch behind it become non-blocking without touching them.
 *
 * @param session - The session to evaluate `code` in.
 * @param code - Smalltalk source to evaluate.
 * @returns The evaluated result, encoded as UTF-8 in GemStone and decoded
 *   here.
 * @throws {GciLibraryError} If `code` fails to compile or signals an error,
 *   or the underlying GCI calls fail. Surfaces as a rejection, never as a
 *   synchronous throw.
 */
export async function fetchString(
  session: Pick<ActiveSession, 'gci' | 'handle'>,
  code: string,
): Promise<string> {
  return session.gci.executeAndFetchString(session.handle, code);
}
