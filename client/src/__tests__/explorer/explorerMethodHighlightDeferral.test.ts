/**
 * A method highlight skipped while the Methods pane is hidden is DEFERRED, not lost.
 *
 * Cascade reveals are skipped while a pane is not visible — collapsed, or inside a
 * view container that is not showing, which TreeView reports as the same thing — and
 * the rule that makes that acceptable is that `reapplyPaneHighlight` re-applies the
 * highlight from state the moment the pane reappears. That rule held for the
 * Dictionaries, Class Categories and Classes panes, whose selections are all recorded
 * in state as a matter of course, and silently did NOT hold for the Methods pane:
 * only a click in the pane itself recorded the selector, so a row revealed into a
 * hidden pane by the class cascade, by an editor-driven sync, or by the New Method
 * landing was skipped and then had nothing to rebuild from. The pane came back
 * showing the right methods with none of them selected.
 *
 * These drive `revealMethodRow` directly, the one place all three of those callers go
 * through, then open the pane the way the workbench does.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({}));
vi.mock('../../gciLog', () => ({
  logInfo: vi.fn(),
  logWarning: vi.fn(),
  logError: vi.fn(),
  getGciLog: vi.fn(() => ({ show: vi.fn(), appendLine: vi.fn() })),
  _resetGciLogForTests: vi.fn(),
}));

import * as vscode from 'vscode';
import { ExplorerController } from '../../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../../sessionManager';

const SESSION = { id: 1 } as ActiveSession;
type Info = { selector: string; category: string; overrideBits: number; sessionBit: number };
const INSTANCE_INFO: Info = {
  selector: 'printString',
  category: 'printing',
  overrideBits: 0,
  sessionBit: 0,
};
const CLASS_INFO: Info = {
  selector: 'new',
  category: 'instance creation',
  overrideBits: 0,
  sessionBit: 0,
};

/** A controller whose Methods pane starts hidden, as it is while the Explorer's
 *  container is off-screen or the pane is collapsed. */
function makeController() {
  const sessionManager = { getSelectedSession: () => SESSION } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  const method = {
    reveal: vi.fn(async (_item: { isMeta: boolean }, _opts?: unknown) => {}),
    selection: [],
    description: '',
    visible: false,
  };
  ctl.setViews({
    dict: { reveal: vi.fn(), description: '' },
    category: { reveal: vi.fn(), description: '' },
    klass: { reveal: vi.fn(), description: '' },
    hierarchy: { reveal: vi.fn(), description: '' },
    method,
  } as never);
  // Both sides resolve, so an assertion turns on what was recorded rather than on
  // whether the row could be found at all.
  vi.spyOn(
    ctl as unknown as { selectorsFor: (m: boolean) => Info[] },
    'selectorsFor',
  ).mockImplementation((isMeta: boolean) => [isMeta ? CLASS_INFO : INSTANCE_INFO]);
  const revealMethodRow = (isMeta: boolean, info: Info) =>
    (
      ctl as unknown as {
        revealMethodRow: (m: boolean, i: Info) => Promise<void>;
      }
    ).revealMethodRow(isMeta, info);
  return { ctl, method, revealMethodRow };
}

/** Open the pane the way the workbench does: the flag flips, then the event fires.
 *  onPaneVisibilityChanged is void-returning, so drain the queue before asserting. */
async function openMethodsPane(
  ctl: ExplorerController,
  method: { visible: boolean },
): Promise<void> {
  method.visible = true;
  ctl.onPaneVisibilityChanged('method', true);
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(vscode.commands.executeCommand).mockReset();
});

describe('a method revealed while the Methods pane is hidden', () => {
  it('is skipped at the time', async () => {
    // The premise the deferral exists to cover. Without this the test below could
    // pass by the reveal never having been skipped in the first place.
    const { method, revealMethodRow } = makeController();

    await revealMethodRow(false, INSTANCE_INFO);

    expect(method.reveal).not.toHaveBeenCalled();
  });

  it('is re-applied when the pane opens', async () => {
    const { ctl, method, revealMethodRow } = makeController();

    await revealMethodRow(false, INSTANCE_INFO);
    await openMethodsPane(ctl, method);

    expect(method.reveal).toHaveBeenCalled();
  });

  it('comes back on the side it was revealed on', async () => {
    // The re-apply reads the recorded side to pick which list to search. Recording
    // the selector without the side lands a class-side method on the instance list,
    // where it is not found and the highlight is lost exactly as before.
    const { ctl, method, revealMethodRow } = makeController();

    await revealMethodRow(true, CLASS_INFO);
    await openMethodsPane(ctl, method);

    expect(method.reveal.mock.calls[0][0].isMeta).toBe(true);
  });
});
