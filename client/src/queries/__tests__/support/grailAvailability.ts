import type { TestContext } from 'vitest';
import { QueryExecutor } from '../../types';
import { isGrailInstalled } from '../../python';

/**
 * Call at the top of a test that only applies when Grail is ABSENT: skips it, with a
 * reason, when the connected stone has Grail installed. Decided live against the
 * session via `isGrailInstalled`, so no environment flag is involved.
 */
export function requireGrailAbsent(ctx: TestContext, execute: QueryExecutor): void {
  ctx.skip(
    isGrailInstalled(execute),
    'skipping: Grail is installed; this test only applies to the absent scenario',
  );
}
