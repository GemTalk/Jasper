import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../gciLog', async (orig) => ({ ...(await orig()), logInfo: vi.fn() }));

import { evalPythonInScopeNb } from '../pythonQueries';
import { ensureSessionFree, NbSessionBusyError } from '../nbRunner';
import { MAX_CELL_RESULT } from '../notebookCellResult';
import { fakeActiveSession } from './fakeActiveSession';

const noErr = { number: 0, message: '' };

/** A session whose Python cell has stopped past its handlers, in process 0x99. */
function stoppedCellSession(clear: () => Promise<unknown>) {
  const gci = {
    isAvailable: (name: string) => name === 'GciTsNbPoll',
    GciTsNbExecute: vi.fn(() => ({ success: true, err: noErr })),
    GciTsNbPoll: vi.fn(() => ({ result: 1, err: noErr })),
    GciTsSocket: vi.fn(() => ({ fd: 3, err: noErr })),
    GciTsCallInProgress: vi.fn(() => ({ result: 0, err: noErr })),
    GciTsNbResult: vi.fn(() => ({
      result: 0n,
      err: { number: 6003, message: 'a Break occurred', context: 0x99n },
    })),
    GciTsClearStackAsync: vi.fn(clear),
  };
  return { session: fakeActiveSession({ id: 74, handle: {}, gci }), gci };
}

describe('a Python cell stopped past its handlers', () => {
  it('clears its process, and reports the error only once the clear is done', async () => {
    // The clear runs the process's ensure: blocks on a worker thread; a cell
    // started before it is done would be refused.
    let finish: (v: unknown) => void = () => {};
    const { session, gci } = stoppedCellSession(() => new Promise((resolve) => (finish = resolve)));
    let settled = false;
    const cell = evalPythonInScopeNb(session, 'x = 1', 'file:///nb.ipynb').finally(
      () => (settled = true),
    );
    cell.catch(() => {});

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(gci.GciTsClearStackAsync).toHaveBeenCalledWith(expect.anything(), 0x99n);
    expect(settled).toBe(false);
    expect(() => ensureSessionFree(session)).toThrow(NbSessionBusyError);

    finish({ success: true, err: noErr });
    await expect(cell).rejects.toThrow('a Break occurred');
    expect(() => ensureSessionFree(session)).not.toThrow();
  });
});

describe('a Python cell that answers', () => {
  it('fetches its printed result with the limit Smalltalk cells use', async () => {
    const { session, gci } = stoppedCellSession(async () => ({ success: true, err: noErr }));
    gci.GciTsNbResult.mockReturnValue({ result: 0x77n, err: noErr } as never);
    const fetch = vi.fn((..._args: unknown[]) => ({ data: '42', err: noErr }));
    Object.assign(gci, { GciTsFetchUtf8: fetch });

    await expect(evalPythonInScopeNb(session, 'x = 42', 'file:///nb.ipynb')).resolves.toBe('42');
    expect(fetch).toHaveBeenCalledWith(expect.anything(), 0x77n, MAX_CELL_RESULT);
  });
});
