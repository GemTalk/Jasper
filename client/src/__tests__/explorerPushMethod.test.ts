import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// The controller module pulls in browserQueries (→ native GCI). Stub it; this test spies
// out every controller method that would touch it (reveal / reload / close-stale-editors).
vi.mock('../browserQueries', () => ({}));
vi.mock('../refactoring/pushMethodCommand', () => ({ pushMethod: vi.fn() }));

import { ExplorerController } from '../gemstoneExplorer';
import { pushMethod } from '../refactoring/pushMethodCommand';
import type { SessionManager, ActiveSession } from '../sessionManager';
import type { PushOutcome } from '../refactoring/pushMethodCommand';

/**
 * Drives ExplorerController.pushMethod — the reveal-vs-reload branch after a push. Mocks the
 * pushMethod command and spies the controller's own navigation methods, so the test pins the
 * wiring (which side effect fires for which outcome) without a live tree or stone.
 */

const ITEM = { info: { selector: 'wildStatus' }, isMeta: false } as never;

function makeController(session: ActiveSession | undefined) {
  const sessionManager = {
    getSelectedSession: () => session,
  } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.className = 'Sub';
  ctl.state.dictName = 'UserGlobals';
  ctl.state.dictIndex = 1;
  const reveal = vi
    .spyOn(ctl as unknown as { revealClass: () => Promise<void> }, 'revealClass')
    .mockResolvedValue();
  const reload = vi
    .spyOn(ctl as unknown as { reloadCurrentClassMethods: () => void }, 'reloadCurrentClassMethods')
    .mockImplementation(() => {});
  const closeStale = vi
    .spyOn(
      ctl as unknown as { closeStaleSourceMethodEditors: () => Promise<void> },
      'closeStaleSourceMethodEditors',
    )
    .mockResolvedValue();
  return { ctl, reveal, reload, closeStale };
}

const outcome = (over: Partial<PushOutcome> = {}): PushOutcome => ({
  applied: 2,
  moved: ['wildStatus'],
  targetClass: 'Super',
  revealClass: 'Super',
  isMeta: false,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('ExplorerController.pushMethod', () => {
  it('does nothing when there is no selected session', async () => {
    const { ctl, reveal, reload } = makeController(undefined);

    await ctl.pushMethod(ITEM, 'up');

    expect(pushMethod).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('passes the clicked method + direction to the command', async () => {
    const { ctl } = makeController({} as ActiveSession);
    vi.mocked(pushMethod).mockResolvedValue(outcome());

    await ctl.pushMethod(ITEM, 'up');

    expect(pushMethod).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'up',
        sourceClass: 'Sub',
        selectors: ['wildStatus'],
        isMeta: false,
        dict: 1,
      }),
    );
  });

  it('reveals the target class and does not reload when the outcome names a reveal target', async () => {
    const { ctl, reveal, reload, closeStale } = makeController({} as ActiveSession);
    vi.mocked(pushMethod).mockResolvedValue(outcome({ revealClass: 'Super' }));

    await ctl.pushMethod(ITEM, 'up');

    expect(closeStale).toHaveBeenCalled();
    expect(reveal).toHaveBeenCalledWith('UserGlobals', 1, 'Super', {
      revealMethod: { selector: 'wildStatus', isMeta: false },
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads the source method list when the outcome has no reveal target', async () => {
    const { ctl, reveal, reload, closeStale } = makeController({} as ActiveSession);
    vi.mocked(pushMethod).mockResolvedValue(outcome({ revealClass: null, targetClass: null }));

    await ctl.pushMethod(ITEM, 'down');

    expect(closeStale).toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does nothing further when the push was cancelled or nothing applied', async () => {
    const { ctl, reveal, reload, closeStale } = makeController({} as ActiveSession);
    vi.mocked(pushMethod).mockResolvedValue(undefined);

    await ctl.pushMethod(ITEM, 'up');

    expect(closeStale).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
