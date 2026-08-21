import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../browserQueries', () => ({
  canClassBeWritten: vi.fn(() => true),
  getDefinedClassVarNames: vi.fn(() => ['Registry']),
  methodsAccessingClassVar: vi.fn(() => []),
  deleteClassVariable: vi.fn(() => 'ok'),
  getClassesWithCategory: vi.fn(() => []),
  getClassEnvironments: vi.fn(() => []),
}));
vi.mock('../methodResultsPicker', () => ({
  showMethodResults: vi.fn(),
  describeMethodResult: (r: { className: string; isMeta: boolean; selector: string }) =>
    `${r.className}${r.isMeta ? ' class' : ''} >> #${r.selector}`,
}));

import { window } from '../__mocks__/vscode';
import { ExplorerController } from '../gemstoneExplorer';
import * as queries from '../browserQueries';
import type { SessionManager, ActiveSession } from '../sessionManager';
import type { MethodSearchResult } from '../queries/methodSearch';

/**
 * The Explorer's Remove Class Variable action — new alongside safe delete, and the
 * counterpart to Add Class Variable. Like adding one it is lightweight: removing a class
 * variable does not reshape the class, so there is no preview panel and no refactoring
 * engine involved. The guard is the same as every other safe delete: a variable no method
 * accesses goes without a question, one that is accessed asks first.
 */

const SESSION = { id: 1 } as ActiveSession;

// `null` means "no session selected" — an explicit `undefined` would take the default.
function makeController(session: ActiveSession | null = SESSION) {
  const selected = session ?? undefined;
  const sessionManager = { getSelectedSession: () => selected } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.className = 'Account';
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

const varRow = { className: 'Account', classVarName: 'Registry' };

const accessor = (over: Partial<MethodSearchResult> = {}): MethodSearchResult => ({
  dictName: 'UserGlobals',
  className: 'Account',
  isMeta: false,
  selector: 'record',
  category: 'accessing',
  ...over,
});

const warn = window.showWarningMessage as ReturnType<typeof vi.fn>;
const info = window.showInformationMessage as ReturnType<typeof vi.fn>;
const error = window.showErrorMessage as ReturnType<typeof vi.fn>;
const writable = queries.canClassBeWritten as ReturnType<typeof vi.fn>;
const declared = queries.getDefinedClassVarNames as ReturnType<typeof vi.fn>;
const accessors = queries.methodsAccessingClassVar as ReturnType<typeof vi.fn>;
const remove = queries.deleteClassVariable as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  writable.mockReturnValue(true);
  declared.mockReturnValue(['Registry']);
  accessors.mockReturnValue([]);
  remove.mockReturnValue('ok');
});

describe('ExplorerController.removeClassVar — nothing accesses the variable', () => {
  it('removes it without asking', async () => {
    const { ctl } = makeController();

    await ctl.removeClassVar(varRow);

    expect(warn).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith(SESSION, 'Account', 'Registry', 1);
  });

  it('announces the removal so it is not silent', async () => {
    const { ctl } = makeController();

    await ctl.removeClassVar(varRow);

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('Removed class variable Registry from Account'),
    );
  });

  it('refreshes the class panes afterwards', async () => {
    const { ctl, refresh } = makeController();

    await ctl.removeClassVar(varRow);

    expect(refresh).toHaveBeenCalledWith('Account');
  });

  it('lands the selection on the parent row after the variable row goes away', async () => {
    const { ctl, reveal } = makeController();

    await ctl.removeClassVar(varRow);

    expect(reveal).toHaveBeenCalledWith(
      expect.objectContaining({ className: 'Account', isMeta: true }),
      expect.anything(),
    );
  });

  it('falls back to the class when the parent row is no longer in the tree', async () => {
    // Removing the last class variable takes the side node with it, so revealing it rejects.
    const { ctl, reveal } = makeController();
    reveal.mockRejectedValueOnce(new Error('element not found')).mockResolvedValueOnce(undefined);

    await ctl.removeClassVar(varRow);

    expect(reveal).toHaveBeenCalledTimes(2);
    expect(reveal.mock.calls[1][0]).toEqual(expect.objectContaining({ className: 'Account' }));
  });

  it('survives both rows being unrevealable rather than failing the removal', async () => {
    const { ctl, reveal } = makeController();
    reveal.mockRejectedValue(new Error('element not found'));

    await expect(ctl.removeClassVar(varRow)).resolves.toBeUndefined();

    expect(info).toHaveBeenCalled();
  });
});

describe('ExplorerController.removeClassVar — methods still access the variable', () => {
  beforeEach(() => {
    accessors.mockReturnValue([accessor()]);
  });

  it('asks before removing anything', async () => {
    warn.mockResolvedValue(undefined);
    const { ctl } = makeController();

    await ctl.removeClassVar(varRow);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Remove class variable Registry from Account'),
      expect.objectContaining({ modal: true }),
      expect.anything(),
      expect.anything(),
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it('names the accessing methods in the confirmation', async () => {
    warn.mockResolvedValue(undefined);
    const { ctl } = makeController();

    await ctl.removeClassVar(varRow);

    expect(warn.mock.calls[0][1].detail).toContain('Account >> #record');
  });

  it('removes the variable when the user chooses to remove it anyway', async () => {
    warn.mockResolvedValue('Remove Anyway');
    const { ctl } = makeController();

    await ctl.removeClassVar(varRow);

    expect(remove).toHaveBeenCalledWith(SESSION, 'Account', 'Registry', 1);
  });

  it('does not refresh when the confirmation is dismissed', async () => {
    warn.mockResolvedValue(undefined);
    const { ctl, refresh } = makeController();

    await ctl.removeClassVar(varRow);

    expect(refresh).not.toHaveBeenCalled();
  });

  it('asks rather than removing unasked when the access scan fails', async () => {
    accessors.mockImplementation(() => {
      throw new Error('a SecurityError occurred');
    });
    warn.mockResolvedValue(undefined);
    const { ctl } = makeController();

    await ctl.removeClassVar(varRow);

    expect(warn).toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});

describe('ExplorerController.removeClassVar — guards and failures', () => {
  it('does nothing without a selected session', async () => {
    const { ctl } = makeController(null);

    await ctl.removeClassVar(varRow);

    expect(remove).not.toHaveBeenCalled();
  });

  it('refuses a class that cannot be modified in this repository', async () => {
    writable.mockReturnValue(false);
    const { ctl } = makeController();

    await ctl.removeClassVar(varRow);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cannot be modified'));
    expect(remove).not.toHaveBeenCalled();
  });

  it('refuses a variable the class inherits rather than declares', async () => {
    declared.mockReturnValue(['SomethingElse']);
    const { ctl } = makeController();

    await ctl.removeClassVar(varRow);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('is not declared in Account'));
    expect(remove).not.toHaveBeenCalled();
  });

  it('surfaces a failure status and does not refresh', async () => {
    remove.mockReturnValue('no-class');
    const { ctl, refresh } = makeController();

    await ctl.removeClassVar(varRow);

    expect(error).toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('surfaces a raised error and does not refresh', async () => {
    remove.mockImplementation(() => {
      throw new Error('a SecurityError occurred');
    });
    const { ctl, refresh } = makeController();

    await ctl.removeClassVar(varRow);

    expect(error).toHaveBeenCalledWith(expect.stringContaining('a SecurityError'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not announce a removal that failed', async () => {
    remove.mockReturnValue('no-class');
    const { ctl } = makeController();

    await ctl.removeClassVar(varRow);

    expect(info).not.toHaveBeenCalled();
  });
});
