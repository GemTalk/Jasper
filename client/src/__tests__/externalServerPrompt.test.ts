import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  showWarningMessage: vi.fn(async (..._args: unknown[]) => undefined as string | undefined),
}));

vi.mock('vscode', () => ({
  window: { showWarningMessage: mocks.showWarningMessage },
}));

import { confirmReconcileExternalServers } from '../externalServerPrompt';
import { ExternalServerReport } from '../externalServerReconcile';

function report(confirmed = true): ExternalServerReport {
  return {
    stoneName: 'gs64stone',
    ldiName: 'gs64ldi',
    jasperRoot: '/home/u/jasperStones',
    confirmed,
    servers: [
      {
        kind: 'Stone',
        name: 'gs64stone',
        pid: 1889606,
        registeredIn: '/elsewhere',
        identity: confirmed ? 'confirmed' : 'unknown',
      },
    ],
  };
}

/** The button labels offered, in order. */
function offered(): string[] {
  return mocks.showWarningMessage.mock.calls[0].slice(2) as string[];
}

beforeEach(() => {
  mocks.showWarningMessage.mockReset();
  mocks.showWarningMessage.mockResolvedValue(undefined);
});

describe('confirmReconcileExternalServers', () => {
  it('offers a restart and a connect when the server is confirmed', async () => {
    await confirmReconcileExternalServers(report());

    expect(offered()).toEqual(['Restart & Connect', 'Connect as-is']);
  });

  it('withholds the restart when the server could not be confirmed', async () => {
    // Stopping a stone that merely shares the name would take down an unrelated
    // database, so the action is not offered at all.
    await confirmReconcileExternalServers(report(false));

    expect(offered()).toEqual(['Connect as-is']);
  });

  it('interrupts rather than passing by in a toast', async () => {
    // This asks about stopping a running stone, during a connect the user is
    // waiting on; a toast auto-hides and is suppressed under Do Not Disturb.
    await confirmReconcileExternalServers(report());

    expect(mocks.showWarningMessage.mock.calls[0][1]).toMatchObject({ modal: true });
  });

  it('names the database in the title and explains the state in the body', async () => {
    await confirmReconcileExternalServers(report());

    const [title, options] = mocks.showWarningMessage.mock.calls[0] as [string, { detail: string }];
    expect(title).toContain('gs64stone');
    expect(options.detail).toContain("started outside Jasper's environment");
  });

  it('reports each choice the user can make', async () => {
    mocks.showWarningMessage.mockResolvedValueOnce('Restart & Connect');
    expect(await confirmReconcileExternalServers(report())).toBe('restart');

    mocks.showWarningMessage.mockResolvedValueOnce('Connect as-is');
    expect(await confirmReconcileExternalServers(report())).toBe('as-is');
  });

  it('treats a dismissed dialog as a cancel', async () => {
    expect(await confirmReconcileExternalServers(report())).toBe('cancel');
  });
});
