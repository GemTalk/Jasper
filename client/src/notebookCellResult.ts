import type { ActiveSession } from './activeSession';
import type { GciError } from './gciLibrary';
import { clearInBackground } from './nbRunner';

/** The most of a cell's printed result that is fetched, for every kind of cell. */
export const MAX_CELL_RESULT = 256 * 1024;

/**
 * Throw for a cell whose call ended in an error, clearing its process first. A
 * cell's code reports Smalltalk errors itself, and a halt or breakpoint goes to
 * the debugger, so this is a stop nothing else will own.
 */
export async function failCell(session: ActiveSession, err: GciError): Promise<never> {
  await clearInBackground(session, err.context);
  throw new Error(err.message || `GCI error ${err.number}`);
}

/** Fetch a cell's printed result, which the cell's code has already made a String. */
export function fetchCellResult(session: ActiveSession, resultOop: bigint): string {
  const { data, err } = session.GciTsFetchUtf8(resultOop, MAX_CELL_RESULT);
  if (err.number !== 0) throw new Error(err.message || `GCI error ${err.number}`);
  return data;
}
