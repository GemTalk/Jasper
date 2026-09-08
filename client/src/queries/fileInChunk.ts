import { QueryExecutor } from './types';

/**
 * Run one `run` / `doit` / `printit` chunk of a Topaz file — a class definition, a
 * `comment:`, whatever a hand-written script does — the way Topaz would.
 *
 * Two deliberate differences from {@link executeCode}, which is the workspace's
 * Display It path:
 *
 * - **Errors are not caught.** `executeCode` folds an exception into an `'Error: …'`
 *   string so a workspace can print it; a file-in has to be able to tell a chunk that
 *   worked from one that raised, and report it against a line number. Letting the
 *   exception through means the executor throws with GemStone's own message.
 * - **The chunk's value is discarded.** Filing in a dictionary evaluates a chunk whose
 *   value is the dictionary; `printString` on that would fetch a large object across
 *   the wire for something nobody reads. `'ok'` comes back instead.
 *
 * `ensure:`, not `[…] value. 'ok'`, is what discards it. A chunk in a hand-written
 * topaz script routinely ends `^ something` — a non-local return, which exits the
 * whole doit and skips any trailing statement, so an appended `'ok'` would never run
 * and the doit would answer the chunk's own object instead of a String. An `ensure:`
 * block runs however the protected block exits, so its `^ 'ok'` wins in every case.
 * (GciLibrary's `executeDiscardingResult` guards the same hazard the same way.)
 *
 * The chunk is wrapped in a block so its temporaries — `| dict |` at the head of a
 * chunk, which both a file-out and a script emit — stay legal.
 */
export function fileInChunk(execute: QueryExecutor, code: string): string {
  return execute(`[${code}] ensure: [^ 'ok']`);
}
