import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
// The dispatch is what's under test, so the adds it dispatches to are usually
// stubbed on the controller; browserQueries is stubbed only enough to construct one.
vi.mock('../../browserQueries', () => ({
  getClassEnvironments: vi.fn(() => []),
}));

import * as vscode from 'vscode';
import { ExplorerController } from '../../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../../sessionManager';

/**
 * The "+" on a CLASS row (#499). It is the only route to a first variable on a class
 * that has none: such a class has no variable-side rows to host their "+", and it
 * cannot be given any — a tree row carries children only by declaring a collapsible
 * state, and any collapsible state draws an expansion chevron, which would advertise
 * variables the class does not have.
 *
 * The refactoring-engine question for the instance kind is asked by
 * `addInstVarOnClass`, whichever route reaches it — the quick pick here, the side
 * row's "+", the class row's context menu — so it is pinned here too.
 */

function makeController(rbSupportAvailable = true, stubAdds = true) {
  const session = { id: 1, rbSupportAvailable } as unknown as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.dictIndex = 1;
  // The dispatch is what's under test, so the two adds are normally stubbed. The
  // no-engine case runs the real addInstVarOnClass instead — the engine check lives
  // inside it, so stubbing it would stub away the thing being asserted.
  const addInstVar = vi.spyOn(ctl, 'addInstVarOnClass');
  const addClassVar = vi.spyOn(ctl, 'addClassVarOnClass');
  if (stubAdds) {
    addInstVar.mockResolvedValue();
    addClassVar.mockResolvedValue();
  }
  return { ctl, addInstVar, addClassVar };
}

const quickPick = () => vi.mocked(vscode.window.showQuickPick);
const pickLabelled = (label: string) =>
  quickPick().mockImplementation(((items: { label: string }[]) =>
    Promise.resolve(items.find((i) => i.label === label))) as never);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Add Variable from a class row', () => {
  it('offers both kinds', async () => {
    const { ctl } = makeController();
    pickLabelled('Class variable');

    await ctl.addVariableOnClass('Foo');

    const offered = (quickPick().mock.calls[0][0] as { label: string }[]).map((i) => i.label);
    expect(offered).toEqual(['Instance variable', 'Class variable']);
  });

  it('adds an instance variable when that kind is chosen', async () => {
    const { ctl, addInstVar, addClassVar } = makeController();
    pickLabelled('Instance variable');

    await ctl.addVariableOnClass('Foo');

    expect(addInstVar).toHaveBeenCalledWith('Foo');
    expect(addClassVar).not.toHaveBeenCalled();
  });

  it('adds a class variable when that kind is chosen', async () => {
    const { ctl, addInstVar, addClassVar } = makeController();
    pickLabelled('Class variable');

    await ctl.addVariableOnClass('Foo');

    expect(addClassVar).toHaveBeenCalledWith('Foo');
    expect(addInstVar).not.toHaveBeenCalled();
  });

  it('adds nothing when the pick is dismissed', async () => {
    const { ctl, addInstVar, addClassVar } = makeController();
    quickPick().mockResolvedValue(undefined);

    await ctl.addVariableOnClass('Foo');

    expect(addInstVar).not.toHaveBeenCalled();
    expect(addClassVar).not.toHaveBeenCalled();
  });

  it('still offers the instance kind without the refactoring engine, and explains', async () => {
    // Hiding it would leave the user guessing why one kind is missing; choosing it
    // goes through the same install-or-decline prompt as the refactorings, and a
    // declined install must not reshape anything. The prompt comes from
    // addInstVarOnClass itself, so this runs the real one.
    const { ctl } = makeController(false, false);
    pickLabelled('Instance variable');
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

    await ctl.addVariableOnClass('Foo');

    expect(vi.mocked(vscode.window.showInformationMessage)).toHaveBeenCalledWith(
      expect.stringContaining('refactoring engine'),
      expect.anything(),
    );
    // Declined: the name was never asked for, so nothing was reshaped.
    expect(vi.mocked(vscode.window.showInputBox)).not.toHaveBeenCalled();
  });

  it('asks the engine question once, not once per route in', async () => {
    // The dispatch used to ask before handing off to addInstVarOnClass, which now
    // asks for itself — two prompts for one click if both stayed.
    const { ctl } = makeController(false, false);
    pickLabelled('Instance variable');
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

    await ctl.addVariableOnClass('Foo');

    expect(vi.mocked(vscode.window.showInformationMessage)).toHaveBeenCalledTimes(1);
  });

  it('asks it too when the side row\'s "+" is the way in', async () => {
    // The empty "instance variables" row exists to host that "+", so it must not be
    // a dead end on a stone without the engine — the menu no longer gates it, and
    // this is the check that replaced the gate.
    const { ctl } = makeController(false, false);
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);

    await ctl.addInstVarOnClass('Foo');

    expect(vi.mocked(vscode.window.showInformationMessage)).toHaveBeenCalledWith(
      expect.stringContaining('refactoring engine'),
      expect.anything(),
    );
    expect(vi.mocked(vscode.window.showInputBox)).not.toHaveBeenCalled();
  });

  it('adds a class variable without the refactoring engine, unprompted', async () => {
    // A class variable is not part of instance layout, so nothing is reshaped and no
    // engine is involved — that distinction predates this button and is unchanged.
    const { ctl, addClassVar } = makeController(false);
    pickLabelled('Class variable');

    await ctl.addVariableOnClass('Foo');

    expect(addClassVar).toHaveBeenCalledWith('Foo');
    expect(vi.mocked(vscode.window.showInformationMessage)).not.toHaveBeenCalled();
  });

  it('does nothing without a session', async () => {
    const sessionManager = { getSelectedSession: () => undefined } as unknown as SessionManager;
    const ctl = new ExplorerController(sessionManager);

    await ctl.addVariableOnClass('Foo');

    expect(quickPick()).not.toHaveBeenCalled();
  });
});
