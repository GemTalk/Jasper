import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
// The controller module pulls in browserQueries (→ native GCI). Stub it; this test drives the
// add/remove handlers with the command mocked and the tree navigation spied out. The accessor
// path uses addAccessors + getClassEnvironments, so those are stubbed too.
vi.mock('../../browserQueries', () => ({
  addAccessors: vi.fn(),
  getClassEnvironments: vi.fn(() => []),
  methodsAccessingInstVar: vi.fn(() => []),
}));
vi.mock('../../refactoring/instVarRefactorCommand', () => ({ runInstVarRefactor: vi.fn() }));
vi.mock('../../methodResultsPicker', () => ({
  showMethodResults: vi.fn(),
  describeMethodResult: (r: { className: string; isMeta: boolean; selector: string }) =>
    `${r.className}${r.isMeta ? ' class' : ''} >> #${r.selector}`,
}));

import * as vscode from 'vscode';
import { ExplorerController } from '../../gemstoneExplorer';
import { runInstVarRefactor } from '../../refactoring/instVarRefactorCommand';
import type { InstVarRefactorOutcome } from '../../refactoring/instVarRefactorCommand';
import * as queries from '../../browserQueries';
import type { SessionManager, ActiveSession } from '../../sessionManager';

/**
 * Drives ExplorerController's add / remove instance-variable handlers — the name-input
 * validation, the meta-side guard, the op/dict payload sent to the command, and the
 * post-apply refresh + reveal-the-new-ivar wiring. The command is mocked and the tree
 * navigation (refreshAfterClassReshape / views.klass.reveal) is spied, so no live tree or
 * stone is needed.
 */

function makeController(session: ActiveSession | undefined) {
  // Adding an instance variable reshapes the class, so addInstVarOnClass asks
  // `ensureRbSupport` before prompting for a name — the single engine gate for every
  // route in, replacing the menu clauses that used to hide the action (see
  // refactoringMenuGating.test.ts). These tests are about what happens PAST that
  // gate, so the fixture session has the engine unless a test overrides the flag.
  const withEngine = session && ({ rbSupportAvailable: true, ...session } as ActiveSession);
  const sessionManager = {
    getSelectedSession: () => withEngine,
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
  autoApplied: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default the accessors prompt to "No accessors" so the add flows through without
  // generating them; individual tests override to opt in or to escape.
  vi.mocked(vscode.window.showQuickPick).mockResolvedValue('No accessors' as never);
  // clearAllMocks drops call history but keeps implementations, so restore the two a
  // remove test overrides — otherwise the override leaks into a shuffled neighbour.
  vi.mocked(queries.methodsAccessingInstVar).mockReturnValue([]);
  vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);
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
  const accessor = (selector: string) => ({
    dictName: 'UserGlobals',
    className: 'Foo',
    isMeta: false,
    selector,
    category: 'accessing',
    environmentId: 0,
  });

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

  it('removes a variable no method accesses without a preview or a question', async () => {
    const { ctl } = makeController({} as ActiveSession);
    vi.mocked(runInstVarRefactor).mockResolvedValue(outcome());

    await ctl.removeInstVar({ className: 'Foo', ivarName: 'count' });

    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(runInstVarRefactor).toHaveBeenCalledWith(expect.objectContaining({ autoApply: true }));
  });

  it('announces a removal nothing had to be asked about', async () => {
    const { ctl } = makeController({} as ActiveSession);
    vi.mocked(runInstVarRefactor).mockResolvedValue(outcome());

    await ctl.removeInstVar({ className: 'Foo', ivarName: 'count' });

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Removed instance variable count from Foo'),
    );
  });

  it('asks before removing a variable methods still access', async () => {
    vi.mocked(queries.methodsAccessingInstVar).mockReturnValue([accessor('total')]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);
    const { ctl } = makeController({} as ActiveSession);

    await ctl.removeInstVar({ className: 'Foo', ivarName: 'count' });

    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    expect(runInstVarRefactor).not.toHaveBeenCalled();
  });

  it('names the accessing methods in the confirmation', async () => {
    vi.mocked(queries.methodsAccessingInstVar).mockReturnValue([accessor('total')]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);
    const { ctl } = makeController({} as ActiveSession);

    await ctl.removeInstVar({ className: 'Foo', ivarName: 'count' });

    const detail = vi.mocked(vscode.window.showWarningMessage).mock.calls[0][1] as {
      detail: string;
    };
    expect(detail.detail).toContain('Foo >> #total');
  });

  it('opens the preview once the user chooses to remove an accessed variable anyway', async () => {
    vi.mocked(queries.methodsAccessingInstVar).mockReturnValue([accessor('total')]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Remove Anyway' as never);
    vi.mocked(runInstVarRefactor).mockResolvedValue(outcome({ autoApplied: false }));
    const { ctl } = makeController({} as ActiveSession);

    await ctl.removeInstVar({ className: 'Foo', ivarName: 'count' });

    expect(runInstVarRefactor).toHaveBeenCalledWith(expect.objectContaining({ autoApply: false }));
  });

  it('does not announce a removal the engine sent to the preview after all', async () => {
    // The client scan found no accessors, but the engine reported methods that will not
    // recompile — so the panel opened and the user was asked. That is not a silent delete.
    vi.mocked(runInstVarRefactor).mockResolvedValue(outcome({ autoApplied: false }));
    const { ctl } = makeController({} as ActiveSession);

    await ctl.removeInstVar({ className: 'Foo', ivarName: 'count' });

    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('asks rather than removing unasked when the access scan fails', async () => {
    vi.mocked(queries.methodsAccessingInstVar).mockImplementation(() => {
      throw new Error('a SecurityError occurred');
    });
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);
    const { ctl } = makeController({} as ActiveSession);

    await ctl.removeInstVar({ className: 'Foo', ivarName: 'count' });

    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    expect(runInstVarRefactor).not.toHaveBeenCalled();
  });
});

// The scan is capped per query, server-side, and the client cannot tell a full page from an
// exact answer — so at the cap the count has to read as a floor. Each delete kind wires the cap
// through from its own scan, so each needs its own test: one kind getting it right says nothing
// about the other three.
describe('ExplorerController.removeInstVar — reporting a scan that came back full', () => {
  const CAP = 500;
  const accessorRow = (className: string, selector: string) => ({
    dictName: 'UserGlobals',
    className,
    isMeta: false,
    selector,
    category: 'accessing',
    environmentId: 0,
  });

  beforeEach(() => {
    vi.mocked(runInstVarRefactor).mockResolvedValue(undefined);
  });

  it('states the count as a floor and says the list is incomplete', async () => {
    vi.mocked(queries.methodsAccessingInstVar).mockReturnValue(
      Array.from({ length: CAP }, (_, i) => accessorRow(`C${i}`, 'usesIt')),
    );
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);
    const { ctl } = makeController({} as ActiveSession);

    await ctl.removeInstVar({ className: 'Foo', ivarName: 'count' });

    const detail = vi.mocked(vscode.window.showWarningMessage).mock.calls[0][1] as {
      detail: string;
    };
    expect(detail.detail).toContain(`At least ${CAP} methods still reference it`);
    expect(detail.detail).toContain('not complete');
  });

  it('states a short count plainly, with no hedge', async () => {
    vi.mocked(queries.methodsAccessingInstVar).mockReturnValue([accessorRow('Foo', 'total')]);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);
    const { ctl } = makeController({} as ActiveSession);

    await ctl.removeInstVar({ className: 'Foo', ivarName: 'count' });

    const detail = vi.mocked(vscode.window.showWarningMessage).mock.calls[0][1] as {
      detail: string;
    };
    expect(detail.detail).toContain('1 method still references it:');
    expect(detail.detail).not.toContain('At least');
    expect(detail.detail).not.toContain('not complete');
  });
});
