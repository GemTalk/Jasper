import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));
// The controller module pulls in browserQueries (→ native GCI). Stub it; these
// tests abort at (or just past) the rb-support gate, before any query runs.
vi.mock('../browserQueries', () => ({}));

import * as vscode from 'vscode';
import { ExplorerController } from '../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../sessionManager';

/**
 * Pins issue #340 finding #4: the rename-instance-variable and rename-method flows
 * now gate through the single shared `ensureRbSupport` helper instead of a verbatim
 * copy of the install-then-re-check block. We assert the gate fires (declining the
 * install offer aborts) and that a present engine lets the flow proceed past it.
 */
function makeController(rbSupportAvailable: boolean): ExplorerController {
  const session = { rbSupportAvailable } as unknown as ActiveSession;
  const sessionManager = {
    getSelectedSession: () => session,
  } as unknown as SessionManager;
  return new ExplorerController(sessionManager);
}

const infoMsg = vi.mocked(vscode.window.showInformationMessage);
const inputBox = vi.mocked(vscode.window.showInputBox);

beforeEach(() => vi.clearAllMocks());

describe('the RB engine-availability gate on the rename flows (issue #340 #4)', () => {
  it('cancels an instance-variable rename before prompting for a new name when the engine is missing and its install is declined', async () => {
    infoMsg.mockResolvedValueOnce(undefined); // user dismisses "Install GemStone Support…"
    const ctl = makeController(false);

    const applied = await ctl.renameInstVarNamed('Foo', 'count', 1);

    expect(applied).toBe(false);
    // The gate fired (offered the install) and stopped before the name prompt.
    expect(infoMsg).toHaveBeenCalledTimes(1);
    expect(String(infoMsg.mock.calls[0][0])).toContain('refactoring engine');
    expect(inputBox).not.toHaveBeenCalled();
  });

  it('prompts for a new instance-variable name when the engine is already available', async () => {
    inputBox.mockResolvedValueOnce(undefined); // got past the gate, user then cancels the name prompt
    const ctl = makeController(true);

    const applied = await ctl.renameInstVarNamed('Foo', 'count', 1);

    expect(applied).toBe(false);
    expect(infoMsg).not.toHaveBeenCalled(); // no install prompt when already available
    expect(inputBox).toHaveBeenCalledTimes(1); // reached the name prompt → gate passed
  });

  it('cancels a method rename when the engine is missing and its install is declined', async () => {
    infoMsg.mockResolvedValueOnce(undefined);
    const ctl = makeController(false);

    const applied = await ctl.renameMethodNamed('Sub', 'area', false, 1, 'UserGlobals');

    expect(applied).toBe(false);
    expect(infoMsg).toHaveBeenCalledTimes(1);
    expect(String(infoMsg.mock.calls[0][0])).toContain('refactoring engine');
  });
});
