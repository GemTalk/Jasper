import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// Stub browserQueries (→ native GCI). The class-variable add + accessor paths use
// these four; each returns a benign default so the controller flow runs.
vi.mock('../browserQueries', () => ({
  addClassVariable: vi.fn(() => 'ok'),
  getVisibleClassVarNames: vi.fn(() => []),
  addAccessors: vi.fn(() => ({ created: 2, skipped: 0, noClass: false })),
  getClassEnvironments: vi.fn(() => []),
}));

import * as vscode from 'vscode';
import { ExplorerController } from '../gemstoneExplorer';
import * as queries from '../browserQueries';
import type { SessionManager, ActiveSession } from '../sessionManager';

/**
 * Drives ExplorerController's Add Class Variable and Add Accessors handlers: the
 * add sends addClassVariable and refuses an already-visible name; the accessors
 * question is asked up front (escaping it cancels the whole add); opting in
 * generates accessors on the correct side (class side for a class variable,
 * instance side for an instance variable). Queries are mocked; no live stone.
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

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks clears call history but NOT implementations, so re-establish the
  // benign defaults each test (a per-test mockReturnValue would otherwise leak into
  // the next test under the suite's randomized order).
  vi.mocked(queries.addClassVariable).mockReturnValue('ok');
  vi.mocked(queries.getVisibleClassVarNames).mockReturnValue([]);
  vi.mocked(queries.addAccessors).mockReturnValue({ created: 2, skipped: 0, noClass: false });
  vi.mocked(queries.getClassEnvironments).mockReturnValue([]);
  vi.mocked(vscode.window.showQuickPick).mockResolvedValue('No accessors' as never);
});

describe('ExplorerController add class variable', () => {
  it('adds the class variable with the trimmed name and current dict, then refreshes', async () => {
    const { ctl, refresh } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('  Registry  ');

    await ctl.addClassVarOnClass('Foo');

    expect(queries.addClassVariable).toHaveBeenCalledWith(expect.anything(), 'Foo', 'Registry', 1);
    expect(refresh).toHaveBeenCalledWith('Foo');
  });

  it('refuses a name already visible on the class instead of a silent no-op', async () => {
    const { ctl } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Registry');
    vi.mocked(queries.getVisibleClassVarNames).mockReturnValue(['Registry']);

    await ctl.addClassVarOnClass('Foo');

    expect(queries.addClassVariable).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('already a class variable'),
    );
  });

  it('cancels the whole add when the accessors prompt is escaped — nothing is added', async () => {
    const { ctl, refresh } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Registry');
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined); // escaped

    await ctl.addClassVarOnClass('Foo');

    expect(queries.addClassVariable).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('generates class-side accessors after adding when the user opts in', async () => {
    const { ctl } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Registry');
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue('Add accessors' as never);

    await ctl.addClassVarOnClass('Foo');

    expect(queries.addAccessors).toHaveBeenCalledWith(
      expect.anything(),
      'Foo',
      true, // class side
      expect.arrayContaining([expect.objectContaining({ selector: 'registry' })]),
      1,
    );
  });

  it('reports failure and does not refresh, reveal, or add accessors when the class cannot be resolved', async () => {
    // addClassVariable answers the non-throwing sentinel 'no-class' — the flow must
    // treat that as a failure, not proceed as if the variable had been added.
    const { ctl, refresh, reveal } = makeController({} as ActiveSession);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('Registry');
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue('Add accessors' as never);
    vi.mocked(queries.addClassVariable).mockReturnValue('no-class');

    await ctl.addClassVarOnClass('Foo');

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining("Couldn't resolve Foo"),
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
    expect(queries.addAccessors).not.toHaveBeenCalled();
  });
});

describe('ExplorerController add accessors (standalone row action)', () => {
  it('adds instance-side accessors for an instance variable', async () => {
    const { ctl } = makeController({} as ActiveSession);

    await ctl.generateAccessorsFor('Foo', 'count', 'ivar');

    expect(queries.addAccessors).toHaveBeenCalledWith(
      expect.anything(),
      'Foo',
      false,
      [
        { selector: 'count', source: 'count\n\t^count' },
        { selector: 'count:', source: 'count: aValue\n\tcount := aValue' },
      ],
      1,
    );
  });

  it('adds class-side accessors with a lowercased selector for a class variable', async () => {
    const { ctl } = makeController({} as ActiveSession);

    await ctl.generateAccessorsFor('Foo', 'Registry', 'classvar');

    expect(queries.addAccessors).toHaveBeenCalledWith(
      expect.anything(),
      'Foo',
      true,
      [
        { selector: 'registry', source: 'registry\n\t^Registry' },
        { selector: 'registry:', source: 'registry: aValue\n\tRegistry := aValue' },
      ],
      1,
    );
  });
});
