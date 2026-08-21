import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../browserQueries', async (orig) => ({
  ...(await orig()),
  canClassBeWritten: vi.fn(() => true),
  getClassDescendantNames: vi.fn(() => []),
  getClassesWithCategory: vi.fn(() => []),
  deleteClass: vi.fn(() => 'Deleted class: X'),
  referencesToClassInDict: vi.fn(() => []),
}));
vi.mock('../methodResultsPicker', () => ({
  showMethodResults: vi.fn(),
  describeMethodResult: (r: { className: string; isMeta: boolean; selector: string }) =>
    `${r.className}${r.isMeta ? ' class' : ''} >> #${r.selector}`,
}));

import { window } from '../__mocks__/vscode';
import { ExplorerController } from '../gemstoneExplorer';
import {
  canClassBeWritten,
  getClassDescendantNames,
  deleteClass,
  referencesToClassInDict,
} from '../browserQueries';
import type { SessionManager, ActiveSession } from '../sessionManager';
import type { MethodSearchResult } from '../queries/methodSearch';

function makeController(onClassRemoved?: (sessionId: number, className: string) => void) {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager, undefined, onClassRemoved);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.dictIndex = 1;
  ctl.state.className = 'Doomed';
  return ctl;
}

const warn = window.showWarningMessage as ReturnType<typeof vi.fn>;
const info = window.showInformationMessage as ReturnType<typeof vi.fn>;
const error = window.showErrorMessage as ReturnType<typeof vi.fn>;
const deleteClassMock = deleteClass as ReturnType<typeof vi.fn>;
const descendantsMock = getClassDescendantNames as ReturnType<typeof vi.fn>;
const writableMock = canClassBeWritten as ReturnType<typeof vi.fn>;
const referencesMock = referencesToClassInDict as ReturnType<typeof vi.fn>;

// A descendant now carries the dictionary that binds it (resolved by object identity
// in the query layer), so removeClass never has to guess by name.
const descendant = (className: string, dictIndex: number, dictName = 'UserGlobals') => ({
  className,
  parentName: 'Doomed',
  dictIndex,
  dictName,
});

const reference = (over: Partial<MethodSearchResult> = {}): MethodSearchResult => ({
  dictName: 'UserGlobals',
  className: 'Caller',
  isMeta: false,
  selector: 'buildsOne',
  category: 'instance creation',
  environmentId: 0,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  writableMock.mockReturnValue(true);
  deleteClassMock.mockReturnValue('Deleted class: X');
  descendantsMock.mockReturnValue([]);
  referencesMock.mockReturnValue([]);
});

describe('ExplorerController.removeClass — nothing references the class', () => {
  it('deletes a leaf class dict-scoped without asking', async () => {
    const ctl = makeController();

    await ctl.removeClass();

    expect(warn).not.toHaveBeenCalled();
    expect(deleteClassMock).toHaveBeenCalledTimes(1);
    expect(deleteClassMock).toHaveBeenCalledWith(expect.anything(), 1, 'Doomed');
    expect(ctl.state.className).toBeUndefined();
  });

  it('announces the removal so it is not silent', async () => {
    const ctl = makeController();

    await ctl.removeClass();

    expect(info).toHaveBeenCalledWith(expect.stringContaining('Removed class Doomed'));
  });

  it('does not count the class’s own methods as references to it', async () => {
    // Doomed class >> new naming Doomed goes away with the class, so it is no reason to ask.
    referencesMock.mockReturnValue([reference({ className: 'Doomed', isMeta: true })]);
    const ctl = makeController();

    await ctl.removeClass();

    expect(warn).not.toHaveBeenCalled();
    expect(deleteClassMock).toHaveBeenCalled();
  });

  it('does not count a doomed subclass’s methods as references either', async () => {
    descendantsMock.mockReturnValue([descendant('Sub1', 1)]);
    referencesMock.mockReturnValue([reference({ className: 'Sub1' })]);
    const ctl = makeController();
    warn.mockResolvedValueOnce('Remove All');

    await ctl.removeClass();

    expect(warn.mock.calls[0][1].detail).not.toContain('Sub1 >> #buildsOne');
  });
});

describe('ExplorerController.removeClass — methods still reference the class', () => {
  beforeEach(() => {
    referencesMock.mockReturnValue([reference()]);
  });

  it('asks before deleting', async () => {
    const ctl = makeController();
    warn.mockResolvedValueOnce(undefined);

    await ctl.removeClass();

    expect(warn).toHaveBeenCalled();
    expect(deleteClassMock).not.toHaveBeenCalled();
    expect(ctl.state.className).toBe('Doomed');
  });

  it('names the referencing methods in the confirmation', async () => {
    const ctl = makeController();
    warn.mockResolvedValueOnce(undefined);

    await ctl.removeClass();

    expect(warn.mock.calls[0][1].detail).toContain('Caller >> #buildsOne');
  });

  it('deletes when the user chooses to remove it anyway', async () => {
    const ctl = makeController();
    warn.mockResolvedValueOnce('Remove Anyway');

    await ctl.removeClass();

    expect(deleteClassMock).toHaveBeenCalledWith(expect.anything(), 1, 'Doomed');
  });

  it('asks rather than deleting unasked when the reference scan fails', async () => {
    referencesMock.mockImplementation(() => {
      throw new Error('a SecurityError occurred');
    });
    const ctl = makeController();
    warn.mockResolvedValueOnce(undefined);

    await ctl.removeClass();

    expect(warn).toHaveBeenCalled();
    expect(deleteClassMock).not.toHaveBeenCalled();
  });
});

describe('ExplorerController.removeClass — the class has subclasses', () => {
  it('removes the whole subtree, deleting each member in its OWN dictionary', async () => {
    const ctl = makeController();
    // Sub2 lives in a different dictionary (index 3) than the root (index 1).
    descendantsMock.mockReturnValue([descendant('Sub1', 1), descendant('Sub2', 3, 'OtherDict')]);
    warn.mockResolvedValueOnce('Remove All');

    await ctl.removeClass();

    expect(deleteClassMock).toHaveBeenCalledTimes(3);
    expect(deleteClassMock).toHaveBeenCalledWith(expect.anything(), 1, 'Sub1');
    expect(deleteClassMock).toHaveBeenCalledWith(expect.anything(), 3, 'Sub2');
    expect(deleteClassMock).toHaveBeenCalledWith(expect.anything(), 1, 'Doomed');
  });

  it('always asks first, even when nothing references the subtree', async () => {
    const ctl = makeController();
    descendantsMock.mockReturnValue([descendant('Sub1', 1)]);
    warn.mockResolvedValueOnce(undefined);

    await ctl.removeClass();

    expect(warn).toHaveBeenCalled();
    expect(deleteClassMock).not.toHaveBeenCalled();
  });

  it('names the subclasses that go with it in the confirmation', async () => {
    const ctl = makeController();
    descendantsMock.mockReturnValue([descendant('Sub1', 1)]);
    warn.mockResolvedValueOnce(undefined);

    await ctl.removeClass();

    expect(warn.mock.calls[0][1].detail).toContain('Sub1');
  });

  it('deletes a subclass in its own dictionary even when its name is shadowed elsewhere', async () => {
    const ctl = makeController();
    // The real subclass "Shadowed" lives in dict index 3; a different, unrelated class
    // of the same name lives in dict index 1. The query resolved by object identity,
    // so the descendant carries dictIndex 3 — deleteClass must target 3, not 1.
    descendantsMock.mockReturnValue([descendant('Shadowed', 3, 'OtherDict')]);
    warn.mockResolvedValueOnce('Remove All');

    await ctl.removeClass();

    expect(deleteClassMock).toHaveBeenCalledWith(expect.anything(), 3, 'Shadowed');
    // Never the shadow in dict 1.
    expect(deleteClassMock).not.toHaveBeenCalledWith(expect.anything(), 1, 'Shadowed');
  });

  it('aborts (all-or-none) without deleting when a descendant cannot be located', async () => {
    const ctl = makeController();
    descendantsMock.mockReturnValue([descendant('Sub1', 1), descendant('Lost', 0, '')]);

    await ctl.removeClass();

    expect(deleteClassMock).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('all-or-none'));
    // No confirmation was even offered — we can't deliver the removal.
    expect(warn).not.toHaveBeenCalled();
  });

  it('aborts (all-or-none) without deleting when a descendant is not writable', async () => {
    const ctl = makeController();
    descendantsMock.mockReturnValue([descendant('Sub1', 1), descendant('Locked', 2, 'Kernel')]);
    // Root writable; the "Locked" descendant is not.
    writableMock.mockImplementation((_s: unknown, name: string) => name !== 'Locked');

    await ctl.removeClass();

    expect(deleteClassMock).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Locked'));
  });

  it('cancels the subtree removal when the all-or-none confirmation is dismissed', async () => {
    const ctl = makeController();
    descendantsMock.mockReturnValue([descendant('Sub1', 1)]);
    warn.mockResolvedValueOnce(undefined);

    await ctl.removeClass();

    expect(deleteClassMock).not.toHaveBeenCalled();
  });
});

describe('ExplorerController.removeClass — guards', () => {
  it('refuses to remove a root class that cannot be written in this repository', async () => {
    const ctl = makeController();
    writableMock.mockReturnValue(false);

    await ctl.removeClass();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cannot be modified'));
    expect(deleteClassMock).not.toHaveBeenCalled();
  });
});

// A removal is uncommitted, so nothing else announces it: without this hook a deleted class stayed
// listed — and clickable — in an open GemStone Search until the next commit/abort. Fired per class rather
// than per command, because Remove Class takes the whole subtree.
describe('ExplorerController.removeClass — telling cached corpora what went', () => {
  it('reports a removed leaf class with its session', async () => {
    const onClassRemoved = vi.fn();
    const ctl = makeController(onClassRemoved);

    await ctl.removeClass();

    expect(onClassRemoved).toHaveBeenCalledTimes(1);
    expect(onClassRemoved).toHaveBeenCalledWith(1, 'Doomed');
  });

  it('reports every member of a removed subtree, not just the root', async () => {
    const onClassRemoved = vi.fn();
    const ctl = makeController(onClassRemoved);
    descendantsMock.mockReturnValue([descendant('Kid', 1), descendant('GrandKid', 1)]);
    warn.mockResolvedValueOnce('Remove All');

    await ctl.removeClass();

    expect(onClassRemoved.mock.calls.map((c) => c[1])).toEqual(['Doomed', 'Kid', 'GrandKid']);
  });

  it('stays silent about a class the delete did not actually remove', async () => {
    const onClassRemoved = vi.fn();
    const ctl = makeController(onClassRemoved);
    descendantsMock.mockReturnValue([descendant('Kid', 1)]);
    warn.mockResolvedValueOnce('Remove All');
    // Root deletes; the subclass reports a failure — dropping it from the corpus would hide a class
    // that is still in the image.
    deleteClassMock
      .mockReturnValueOnce('Deleted class: Doomed')
      .mockReturnValueOnce('Error: could not delete Kid');

    await ctl.removeClass();

    expect(onClassRemoved).toHaveBeenCalledTimes(1);
    expect(onClassRemoved).toHaveBeenCalledWith(1, 'Doomed');
  });

  it('reports nothing when the confirmation is dismissed', async () => {
    const onClassRemoved = vi.fn();
    const ctl = makeController(onClassRemoved);
    referencesMock.mockReturnValue([reference()]);
    warn.mockResolvedValueOnce(undefined);

    await ctl.removeClass();

    expect(onClassRemoved).not.toHaveBeenCalled();
  });
});
