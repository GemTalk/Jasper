import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));
// The controller module pulls in browserQueries (→ native GCI). Stub it; this test drives the
// add/remove handlers with the command mocked and the tree navigation spied out.
vi.mock('../browserQueries', () => ({}));
vi.mock('../refactoring/instVarRefactorCommand', () => ({ runInstVarRefactor: vi.fn() }));

import * as vscode from 'vscode';
import { ExplorerController } from '../gemstoneExplorer';
import { runInstVarRefactor } from '../refactoring/instVarRefactorCommand';
import type { InstVarRefactorOutcome } from '../refactoring/instVarRefactorCommand';
import type { SessionManager, ActiveSession } from '../sessionManager';

/**
 * Drives ExplorerController's add / remove instance-variable handlers — the name-input
 * validation, the meta-side guard, the op/dict payload sent to the command, and the
 * post-apply refresh + reveal-the-new-ivar wiring. The command is mocked and the tree
 * navigation (refreshAfterClassReshape / views.klass.reveal) is spied, so no live tree or
 * stone is needed.
 */

function makeController(session: ActiveSession | undefined) {
  const sessionManager = {
    getSelectedSession: () => session,
  } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.className = 'Foo';
  ctl.state.dictName = 'UserGlobals';
  ctl.state.dictIndex = 1;
  const refresh = vi
    .spyOn(
      ctl as unknown as { refreshAfterClassReshape: () => Promise<void> },
      'refreshAfterClassReshape',
    )
    .mockResolvedValue();
  const reveal = vi.fn().mockResolvedValue(undefined);
  ctl.setViews({
    dict: {},
    category: {},
    klass: { reveal },
    hierarchy: {},
    method: {},
  } as never);
  return { ctl, refresh, reveal };
}

const outcome = (over: Partial<InstVarRefactorOutcome> = {}): InstVarRefactorOutcome => ({
  applied: 2,
  committed: false,
  dropped: [],
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('ExplorerController add instance variable', () => {
  it('does nothing when there is no selected session', async () => {
    const { ctl } = makeController(undefined);

    await ctl.addInstVarOnClass('Foo');

    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
    expect(runInstVarRefactor).not.toHaveBeenCalled();
  });

  it('accepts a valid name and rejects invalid ones via the input-box validator', async () => {
    const { ctl } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);

    await ctl.addInstVarOnClass('Foo');

    const opts = vi.mocked(vscode.window.showInputBox).mock.calls[0][0];
    const validate = opts?.validateInput as (v: string) => string | undefined;
    expect(validate('goodName')).toBeUndefined();
    expect(validate('_ok9')).toBeUndefined();
    expect(validate('9bad')).toBeTruthy();
    expect(validate('has space')).toBeTruthy();
    expect(validate('  ')).toBeTruthy();
  });

  it('does not run the refactor when the name prompt is cancelled', async () => {
    const { ctl, refresh } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);

    await ctl.addInstVarOnClass('Foo');

    expect(runInstVarRefactor).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('sends an add op with the trimmed name and current dict, then refreshes and reveals the new ivar', async () => {
    const { ctl, refresh, reveal } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('  newVar  ');
    vi.mocked(runInstVarRefactor).mockResolvedValue(outcome());

    await ctl.addInstVarOnClass('Foo');

    expect(runInstVarRefactor).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'add', className: 'Foo', ivarName: 'newVar', dict: 1 }),
    );
    expect(refresh).toHaveBeenCalledWith('Foo');
    expect(reveal).toHaveBeenCalledWith(
      expect.objectContaining({ className: 'Foo', ivarName: 'newVar' }),
      expect.objectContaining({ select: true }),
    );
  });

  it('does not refresh when the add is declined or cancelled downstream', async () => {
    const { ctl, refresh, reveal } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('newVar');
    vi.mocked(runInstVarRefactor).mockResolvedValue(undefined);

    await ctl.addInstVarOnClass('Foo');

    expect(refresh).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
  });
});

describe('ExplorerController add instance variable from the variable-side node', () => {
  it('ignores the class-variable side', async () => {
    const { ctl } = makeController({} as ActiveSession);

    await ctl.addInstVarFromSide({ isMeta: true, className: 'Foo' });

    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
    expect(runInstVarRefactor).not.toHaveBeenCalled();
  });

  it('adds to the class named by the instance side', async () => {
    const { ctl } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('freshIvar');
    vi.mocked(runInstVarRefactor).mockResolvedValue(outcome());

    await ctl.addInstVarFromSide({ isMeta: false, className: 'Bar' });

    expect(runInstVarRefactor).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'add', className: 'Bar', ivarName: 'freshIvar' }),
    );
  });
});

describe('ExplorerController remove instance variable', () => {
  it('does nothing when there is no selected session', async () => {
    const { ctl, refresh } = makeController(undefined);

    await ctl.removeInstVar({ className: 'Foo', ivarName: 'count' });

    expect(runInstVarRefactor).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('sends a remove op for the row and refreshes on success', async () => {
    const { ctl, refresh } = makeController({} as ActiveSession);
    vi.mocked(runInstVarRefactor).mockResolvedValue(outcome());

    await ctl.removeInstVar({ className: 'Foo', ivarName: 'count' });

    expect(runInstVarRefactor).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'remove', className: 'Foo', ivarName: 'count', dict: 1 }),
    );
    expect(refresh).toHaveBeenCalledWith('Foo');
  });

  it('does not refresh when the remove is declined or cancelled', async () => {
    const { ctl, refresh } = makeController({} as ActiveSession);
    vi.mocked(runInstVarRefactor).mockResolvedValue(undefined);

    await ctl.removeInstVar({ className: 'Foo', ivarName: 'count' });

    expect(refresh).not.toHaveBeenCalled();
  });
});
