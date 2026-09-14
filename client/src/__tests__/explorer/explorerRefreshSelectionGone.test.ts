import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
// refreshRetainingSelection re-resolves the selected dictionary by name and, when
// present, reloads its classes and the selected class's methods. Stub just those three
// reads; the ivar-count and hierarchy reloads swallow their own query errors, so the rest
// can stay unmocked.
vi.mock('../../browserQueries', () => ({
  getDictionaryNames: vi.fn(() => [] as string[]),
  getClassesWithCategory: vi.fn(() => [] as unknown[]),
  getClassEnvironments: vi.fn(() => [] as unknown[]),
}));

import { window } from '../../__mocks__/vscode';
import * as queries from '../../browserQueries';
import { ClassItem, ExplorerController } from '../../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../../sessionManager';

const getDictionaryNames = queries.getDictionaryNames as ReturnType<typeof vi.fn>;
const getClassesWithCategory = queries.getClassesWithCategory as ReturnType<typeof vi.fn>;
const getClassEnvironments = queries.getClassEnvironments as ReturnType<typeof vi.fn>;

// `vi.clearAllMocks` clears recorded calls but keeps whatever `mockReturnValue` a test set,
// so restore the empty defaults here — otherwise one test's class listing is still in place
// for the next one, and tests that pass alone fail in a different shuffle.
beforeEach(() => {
  vi.clearAllMocks();
  getDictionaryNames.mockReturnValue([]);
  getClassesWithCategory.mockReturnValue([]);
  getClassEnvironments.mockReturnValue([]);
});

function makeController() {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  const state = (ctl as unknown as { state: Record<string, unknown> }).state;
  // Pretend the user is sitting on the GsRefactoring dictionary (index 6).
  state.dictName = 'GsRefactoring';
  state.dictIndex = 6;
  state.className = undefined;
  // Seed the panes so "they end up empty" is an observable change rather than the initial
  // condition — otherwise the assertions below would hold even if nothing ran.
  state.classCategory = 'accessing';
  (ctl as unknown as { classCategoryEntries: unknown[] }).classCategoryEntries = [
    { category: 'accessing', className: 'Demo' },
  ];
  (ctl as unknown as { envLines: unknown[] }).envLines = [
    { isMeta: false, envId: 0, category: 'accessing', selectors: ['at:'] },
  ];
  // NB `reset` is deliberately NOT stubbed: the behaviour under test is that the panes end up
  // cleared, not that a particular private method was called. Stubbing it would make this test
  // fail on a rework that cleared the panes inline while the behaviour stayed correct.
  return { ctl, state };
}

describe('ExplorerController.refreshRetainingSelection when the selected dictionary is gone', () => {
  it('clears the class/hierarchy/method panes when the selected dictionary no longer exists', async () => {
    const { ctl, state } = makeController();
    getDictionaryNames.mockReturnValue(['UserGlobals', 'Globals', 'Published']);

    await ctl.refreshRetainingSelection({ reveal: false });

    // The observable outcome: the stale selection is gone (reset falls back to the default
    // dictionary rather than leaving nothing selected) and the dependent panes are empty.
    expect(state.dictName).not.toBe('GsRefactoring');
    expect(state.className).toBeUndefined();
    expect(state.classCategory).toBeUndefined();
    expect((ctl as unknown as { classCategoryEntries: unknown[] }).classCategoryEntries).toEqual(
      [],
    );
    expect((ctl as unknown as { envLines: unknown[] }).envLines).toEqual([]);
    // The point of the guard: the stale index 6 is never used to fetch some other dictionary's
    // classes. (Classes ARE loaded — reset selects the default dictionary — so asserting "not
    // called at all" would only have held while `reset` was stubbed out.)
    expect(getClassesWithCategory).not.toHaveBeenCalledWith(expect.anything(), 6);
  });

  it('keeps the selection and reloads by the CURRENT index when the dictionary is still present but shifted', async () => {
    const { ctl, state } = makeController();
    // GsRefactoring survives but earlier dictionaries were removed, so it is now at
    // position 3 (1-based), not its stale index 6.
    getDictionaryNames.mockReturnValue(['UserGlobals', 'Globals', 'GsRefactoring']);

    await ctl.refreshRetainingSelection({ reveal: false });

    // Selection retained — the inverse of the reset case above.
    expect(state.dictName).toBe('GsRefactoring');
    expect(getClassesWithCategory).toHaveBeenCalledWith(expect.anything(), 3);
  });
});

describe('ExplorerController.refreshRetainingSelection when the selected CLASS is gone', () => {
  // The dictionary itself survives every case below, so the reset path above never runs and
  // what is asserted is the class-level drop.
  function onGsRefactoring(entries: { category: string; className: string }[]) {
    const made = makeController();
    getDictionaryNames.mockReturnValue(['UserGlobals', 'Globals', 'GsRefactoring']);
    getClassesWithCategory.mockReturnValue(entries);
    return made;
  }

  it('drops a class the stone no longer has, so New Method cannot aim at it', async () => {
    const { ctl, state } = onGsRefactoring([{ category: 'accessing', className: 'Other' }]);
    state.className = 'Demo';
    state.selectedSelector = 'at:';
    state.selectedIsMeta = false;
    state.selectedMethodCategory = 'accessing';

    await ctl.refreshRetainingSelection({ reveal: false });

    expect(state.className).toBeUndefined();
    expect(state.selectedSelector).toBeUndefined();
    expect(state.selectedMethodCategory).toBeUndefined();
    // The panes that hang off the class go with it — otherwise the Methods and Hierarchy panes
    // keep listing a removed class's contents.
    expect((ctl as unknown as { envLines: unknown[] }).envLines).toEqual([]);
    expect((ctl as unknown as { hierChain: unknown[] }).hierChain).toEqual([]);
  });

  it('stops the pinned location line naming the class that has gone', async () => {
    const { ctl, state } = onGsRefactoring([{ category: 'printing', className: 'Other' }]);
    state.className = 'Demo';
    ctl.history.record({ sessionId: 1, dictName: 'GsRefactoring', className: 'Demo' });

    await ctl.refreshRetainingSelection({ reveal: false });

    // The Actions & Navigation pane pins the current landing as "In GsRefactoring · Demo";
    // clearing the panes while that line still named Demo just moves the confusion one pane over.
    expect(ctl.history.current()).toBeUndefined();
  });

  it('keeps a class that is still listed', async () => {
    const { ctl, state } = onGsRefactoring([{ category: 'accessing', className: 'Demo' }]);
    state.className = 'Demo';

    await ctl.refreshRetainingSelection({ reveal: false });

    expect(state.className).toBe('Demo');
  });

  it('keeps the class when the listing could not be read', async () => {
    const { ctl, state } = onGsRefactoring([]);
    getClassesWithCategory.mockImplementation(() => {
      throw new Error('connection lost');
    });
    state.className = 'Demo';

    await ctl.refreshRetainingSelection({ reveal: false });

    // A failed fetch leaves the stale listing behind, which says nothing about what is bound;
    // dropping the selection on it would clear the panes on every hiccup.
    expect(state.className).toBe('Demo');
  });

  it('clears a class category whose last class has gone, so the Classes pane is not filtered to nothing', async () => {
    const { ctl, state } = onGsRefactoring([{ category: 'printing', className: 'Other' }]);
    state.className = 'Demo';
    state.classCategory = 'accessing';

    await ctl.refreshRetainingSelection({ reveal: false });

    expect(state.classCategory).toBeUndefined();
    expect(ctl.classNames()).toEqual(['Other']);
  });

  it('keeps a still-empty category made with the + button', async () => {
    const { ctl, state } = onGsRefactoring([{ category: 'printing', className: 'Other' }]);
    state.classCategory = 'accessing';
    (ctl as unknown as { newClassCategories: Set<string> }).newClassCategories.add('accessing');

    await ctl.refreshRetainingSelection({ reveal: false });

    // A category with no classes in it is exactly what the + button makes; the stone never
    // knew about it, so a refresh has nothing to say against it.
    expect(state.classCategory).toBe('accessing');
  });

  it('keeps a parent category whose classes live in its sub-categories', async () => {
    const { ctl, state } = onGsRefactoring([{ category: 'Kernel-Numbers', className: 'Other' }]);
    state.classCategory = 'Kernel';

    await ctl.refreshRetainingSelection({ reveal: false });

    expect(state.classCategory).toBe('Kernel');
  });
});

describe('New Method after the selected class has been removed', () => {
  // The Classes pane keeps its highlight on an element the rebuilt tree no longer produces, so
  // the removed class is still sitting in `views.klass.selection` when New Method looks there.
  function attachClassSelection(ctl: ExplorerController, selection: unknown[]) {
    const pane = () => ({
      description: '',
      message: undefined as string | undefined,
      reveal: vi.fn(async () => {}),
      selection: [] as unknown[],
    });
    ctl.setViews({
      dict: pane(),
      category: pane(),
      klass: { ...pane(), selection },
      hierarchy: pane(),
      method: pane(),
    } as never);
  }

  it('refuses rather than compiling into a class the stone no longer has', async () => {
    const { ctl, state } = makeController();
    getDictionaryNames.mockReturnValue(['UserGlobals', 'Globals', 'GsRefactoring']);
    getClassesWithCategory.mockReturnValue([{ category: 'printing', className: 'Other' }]);
    state.className = 'Demo';
    const create = vi.fn(async () => {});
    (ctl as unknown as { createNewMethod: typeof create }).createNewMethod = create;
    attachClassSelection(ctl, [new ClassItem('Demo')]);

    await ctl.refreshRetainingSelection({ reveal: false });
    await ctl.newMethod();

    expect(create).not.toHaveBeenCalled();
    expect(window.showWarningMessage).toHaveBeenCalledWith('Select a class first.');
  });

  it('still adopts a highlighted class the dictionary does list', async () => {
    const { ctl, state } = makeController();
    getDictionaryNames.mockReturnValue(['UserGlobals', 'Globals', 'GsRefactoring']);
    getClassesWithCategory.mockReturnValue([{ category: 'printing', className: 'Other' }]);
    state.className = 'Demo';
    const create = vi.fn(async () => {});
    (ctl as unknown as { createNewMethod: typeof create }).createNewMethod = create;
    attachClassSelection(ctl, [new ClassItem('Other')]);

    await ctl.refreshRetainingSelection({ reveal: false });
    await ctl.newMethod();

    expect(state.className).toBe('Other');
    expect(create).toHaveBeenCalled();
  });
});
