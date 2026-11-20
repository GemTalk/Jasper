import { describe, it, expect, vi } from 'vitest';

vi.mock('../nbRunner', () => ({ clearInBackground: vi.fn() }));

import { failCell, fetchCellResult } from '../notebookCellResult';
import { GciLibraryError } from '../gciLibraryError';
import { GS_ERR_SESSION_SHUTDOWN, NET_ERROR } from '../gciConstants';
import { ERR_GEM_AUTO_ABORT } from '../queries/transactionMode';
import type { ActiveSession } from '../activeSession';
import type { GciError } from '../gciLibrary';

const session = { id: 1 } as unknown as ActiveSession;
const gciError = (number: number, message: string) =>
  ({ number, message, context: 0n }) as unknown as GciError;

describe('a cell that ends in a GemStone error', () => {
  it("keeps GemStone's error number, so Run All can tell a cell that never ran", async () => {
    const thrown = await failCell(
      session,
      gciError(GS_ERR_SESSION_SHUTDOWN, 'forcibly terminated'),
    ).catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(GciLibraryError);
    expect((thrown as GciLibraryError).number).toBe(GS_ERR_SESSION_SHUTDOWN);
    expect((thrown as Error).message).toBe('forcibly terminated');
  });

  it("says in Jasper's words that a cell refused by a refreshed view did not run", async () => {
    await expect(
      failCell(session, gciError(ERR_GEM_AUTO_ABORT, 'a TransactionBacklog occurred')),
    ).rejects.toThrow(/did not run, so try it again/);
  });

  it("keeps GemStone's error number when fetching the result fails", () => {
    const failing = {
      id: 1,
      GciTsFetchUtf8: () => ({ data: '', err: gciError(NET_ERROR, 'socket read EOF') }),
    } as unknown as ActiveSession;

    let thrown: unknown;
    try {
      fetchCellResult(failing, 1n);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(GciLibraryError);
    expect((thrown as GciLibraryError).number).toBe(NET_ERROR);
  });
});
