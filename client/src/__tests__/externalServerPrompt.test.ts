import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  showWarningMessage: vi.fn(async (..._args: unknown[]) => undefined as string | undefined),
}));

vi.mock('vscode', () => ({
  window: { showWarningMessage: mocks.showWarningMessage },
}));

import { confirmReconcileExternalServers } from '../externalServerPrompt';
import { ExternalServerReport } from '../externalServerReconcile';

function report(confirmed = true, mayRestart = confirmed): ExternalServerReport {
  return {
    stoneName: 'gs64stone',
    ldiName: 'gs64ldi',
    jasperRoot: '/home/u/jasperStones',
    confirmed,
    mayRestart,
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

  it('withholds the restart when an unidentifiable stone is involved', async () => {
    // Stopping a stone that merely shares the name would take down an unrelated
    // database and lose whatever it had not committed, so it is not offered.
    await confirmReconcileExternalServers(report(false, false));

    expect(offered()).toEqual(['Connect as-is']);
  });

  it('still offers the restart for a netldi it cannot identify', async () => {
    // A netldi started without -l can never be identified, so refusing here
    // would make the action permanently unreachable in the ordinary case — and
    // it holds no data, so the worst outcome is dropped connections.
    await confirmReconcileExternalServers(report(false, true));

    expect(offered()).toEqual(['Restart & Connect', 'Connect as-is']);
  });

  it('interrupts rather than passing by in a toast', async () => {
    // This asks about stopping a running stone, during a connect the user is
    // waiting on; a toast auto-hides and is suppressed under Do Not Disturb.
    await confirmReconcileExternalServers(report());

    expect(mocks.showWarningMessage.mock.calls[0][1]).toMatchObject({ modal: true });
  });

  it('names what was actually started outside Jasper in the title', async () => {
    // The title used to name the database's stone, so it announced that the
    // stone had been started outside Jasper while the body correctly said it
    // was the NetLDI.
    await confirmReconcileExternalServers(report());

    expect(mocks.showWarningMessage.mock.calls[0][0]).toBe(
      'Stone "gs64stone" was started outside Jasper',
    );
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

  it('does not promise a connect when no login is waiting', async () => {
    // The Databases row's own action has nothing to connect to, so offering
    // "Restart & Connect" there promises something that will not happen — and
    // a dialog doing careful work cannot afford a small lie in its buttons.
    await confirmReconcileExternalServers(report(), { connects: false });

    expect(offered()).toEqual(['Restart', 'Leave as-is']);
  });

  it('still reports the choices correctly without a connect', async () => {
    mocks.showWarningMessage.mockResolvedValueOnce('Restart');
    expect(await confirmReconcileExternalServers(report(), { connects: false })).toBe('restart');

    mocks.showWarningMessage.mockResolvedValueOnce('Leave as-is');
    expect(await confirmReconcileExternalServers(report(), { connects: false })).toBe('as-is');
  });

  it('names the offered action in the body, whichever it is', async () => {
    await confirmReconcileExternalServers(report(false, true), { connects: false });

    const options = mocks.showWarningMessage.mock.calls[0][1] as { detail: string };
    expect(options.detail).toContain('"Restart" is offered');
    expect(options.detail).not.toContain('Restart & Connect');
  });

  it('treats a dismissed dialog as a cancel', async () => {
    expect(await confirmReconcileExternalServers(report())).toBe('cancel');
  });
});
