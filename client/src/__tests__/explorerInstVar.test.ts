import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// The controller module pulls in browserQueries (→ native GCI). Stub it; this test drives the
// add/remove handlers with the command mocked and the tree navigation spied out. The accessor
// path uses addAccessors + getClassEnvironments, so those are stubbed too.
vi.mock('../browserQueries', () => ({
  addAccessors: vi.fn(),
  getClassEnvironments: vi.fn(() => []),
}));
vi.mock('../refactoring/instVarRefactorCommand', () => ({ runInstVarRefactor: vi.fn() }));

import * as vscode from 'vscode';
import { ExplorerController } from '../gemstoneExplorer';
import { runInstVarRefactor } from '../refactoring/instVarRefactorCommand';
import type { InstVarRefactorOutcome } from '../refactoring/instVarRefactorCommand';
import * as queries from '../browserQueries';
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

beforeEach(() => {
  vi.clearAllMocks();
  // Default the accessors prompt to "No accessors" so the add flows through without
  // generating them; individual tests override to opt in or to escape.
  vi.mocked(vscode.window.showQuickPick).mockResolvedValue('No accessors' as never);
});

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
    expect(validate('9bad')).toContain('lowercase');
    expect(validate('has space')).toContain('lowercase');
    expect(validate('  ')).toContain('Enter a name');
    // Kept in step with the engine's isValidIvarName: an UPPERCASE first letter reads as a global
    // and must be rejected here too, not just declined after a round trip (#360 item 5). Assert the
    // *word* the engine's testAddDeclinesUppercaseFirstLetter also pins, so the two stay in step and
    // a regression to the old generic "not a valid name" message would fail here.
    expect(validate('Tally')).toContain('lowercase');
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

  it('cancels the whole add when the accessors prompt is escaped — nothing is added', async () => {
    const { ctl, refresh } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('newVar');
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined); // escaped

    await ctl.addInstVarOnClass('Foo');

    expect(runInstVarRefactor).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('passes the accessor specs to the ivar refactor so they compile in the same apply, not a separate call', async () => {
    const { ctl } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('amount');
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue('Add accessors' as never);
    vi.mocked(runInstVarRefactor).mockResolvedValue(outcome());

    await ctl.addInstVarOnClass('Foo');

    expect(runInstVarRefactor).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'add',
        className: 'Foo',
        ivarName: 'amount',
        accessorSpecs: expect.arrayContaining([
          expect.objectContaining({ selector: 'amount' }),
          expect.objectContaining({ selector: 'amount:' }),
        ]),
      }),
    );
    // The accessors ride the apply transaction now, so there is no separate post-apply
    // addAccessors call (the split-commit hazard the previous flow had).
    expect(queries.addAccessors).not.toHaveBeenCalled();
  });

  it('threads the accessor specs even when the add targets a class other than the shown one', async () => {
    const { ctl } = makeController({} as ActiveSession);
    ctl.state.className = 'SomethingElse'; // right-clicked a class that wasn't selected
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('amount');
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue('Add accessors' as never);
    vi.mocked(runInstVarRefactor).mockResolvedValue(outcome());

    await ctl.addInstVarOnClass('Foo');

    expect(runInstVarRefactor).toHaveBeenCalledWith(
      expect.objectContaining({
        className: 'Foo',
        accessorSpecs: expect.arrayContaining([expect.objectContaining({ selector: 'amount' })]),
      }),
    );
    expect(queries.addAccessors).not.toHaveBeenCalled();
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
