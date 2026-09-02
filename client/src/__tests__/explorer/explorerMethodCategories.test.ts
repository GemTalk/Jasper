import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
// The controller pulls in browserQueries; stub only what these flows touch.
vi.mock('../../browserQueries', () => ({
  renameCategory: vi.fn(),
  removeCategory: vi.fn(() => 'ok'),
  canClassBeWritten: vi.fn(() => true),
  getClassEnvironments: vi.fn(() => []),
}));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import { ExplorerController, MethodCategoryItem, MethodItem } from '../../gemstoneExplorer';
import { ALL_METHODS_CATEGORY } from '../../systemBrowser';
import type { SessionManager, ActiveSession } from '../../sessionManager';
import type { EnvCategoryLine } from '../../browserQueries';

// A minimal five-pane views mock; only the Methods view's reveal/selection are
// exercised, but setViews() → syncTitles() writes a description to each pane.
function makeViews() {
  const pane = () => ({
    description: '',
    reveal: vi.fn((_node?: unknown) => Promise.resolve()),
    selection: [] as unknown[],
  });
  const method = pane();
  const views = { dict: pane(), category: pane(), klass: pane(), hierarchy: pane(), method };
  return { views, method };
}

function makeController() {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  const { views, method } = makeViews();
  ctl.setViews(views as unknown as Parameters<ExplorerController['setViews']>[0]);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.className = 'M4Demo';
  ctl.state.dictIndex = 3;
  return { ctl, methodView: method };
}

// envLines is the private per-class method metadata the panes render from; set it
// directly rather than round-tripping a live query through the controller.
function setEnvLines(ctl: ExplorerController, lines: EnvCategoryLine[]): void {
  (ctl as unknown as { envLines: EnvCategoryLine[] }).envLines = lines;
}

function envLine(isMeta: boolean, category: string, selectors: string[]): EnvCategoryLine {
  return { isMeta, envId: 0, category, selectors };
}

// reloadIfCurrent refetches through getClassEnvironments, so a call to it for the
// browsed class IS the pane catching up. Counted rather than merely asserted called,
// because setEnvLines writes the pane data directly and never goes through a query.
function refetches(className = 'M4Demo', dictIndex = 3): number {
  return vi
    .mocked(queries.getClassEnvironments)
    .mock.calls.filter((c) => c[1] === dictIndex && c[2] === className).length;
}

const showInputBox = vi.mocked(vscode.window.showInputBox);
const openTextDocument = vi.mocked(vscode.workspace.openTextDocument);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(queries.canClassBeWritten).mockReturnValue(true);
  vi.mocked(queries.getClassEnvironments).mockReturnValue([]);
  vi.mocked(queries.removeCategory).mockReturnValue('ok');
});

describe('ExplorerController.newMethodCategory', () => {
  it('adds an instance-side category, records it, and selects it', async () => {
    const { ctl, methodView } = makeController();
    showInputBox.mockResolvedValue('accessing');

    await ctl.newMethodCategory(false);

    expect(ctl.methodCategories(false).some((c) => c.category === 'accessing')).toBe(true);
    expect(ctl.state.selectedIsMeta).toBe(false);
    expect(ctl.state.selectedMethodCategory).toBe('accessing');
    expect(methodView.reveal).toHaveBeenCalledTimes(1);
    const revealed = methodView.reveal.mock.calls[0][0] as MethodCategoryItem;
    expect(revealed.category).toBe('accessing');
    expect(revealed.isMeta).toBe(false);
  });

  it('adds the category to the class side when asked, not the instance side', async () => {
    const { ctl } = makeController();
    showInputBox.mockResolvedValue('printing');

    await ctl.newMethodCategory(true);

    expect(ctl.methodCategories(true).some((c) => c.category === 'printing')).toBe(true);
    expect(ctl.methodCategories(false).some((c) => c.category === 'printing')).toBe(false);
  });

  it('does nothing when the name prompt is cancelled', async () => {
    const { ctl, methodView } = makeController();
    showInputBox.mockResolvedValue(undefined);

    await ctl.newMethodCategory(false);

    expect(ctl.methodCategories(false).some((c) => c.category !== ALL_METHODS_CATEGORY)).toBe(
      false,
    );
    expect(methodView.reveal).not.toHaveBeenCalled();
  });
});

describe('ExplorerController.renameMethodCategory', () => {
  it('renames a still-empty category locally, without a server call', async () => {
    const { ctl } = makeController();
    showInputBox.mockResolvedValueOnce('class method category'); // create
    await ctl.newMethodCategory(true);
    showInputBox.mockResolvedValueOnce('renamed category'); // rename

    await ctl.renameMethodCategory(new MethodCategoryItem(true, 'class method category', false));

    expect(queries.renameCategory).not.toHaveBeenCalled();
    const names = ctl.methodCategories(true).map((c) => c.category);
    expect(names).toContain('renamed category');
    expect(names).not.toContain('class method category');
  });

  it('renames a populated category on the server', async () => {
    const { ctl } = makeController();
    setEnvLines(ctl, [envLine(false, 'accessing', ['bar'])]);
    showInputBox.mockResolvedValue('renamed-accessing');

    await ctl.renameMethodCategory(new MethodCategoryItem(false, 'accessing', false));

    expect(queries.renameCategory).toHaveBeenCalledWith(
      expect.anything(),
      'M4Demo',
      false,
      'accessing',
      'renamed-accessing',
      3,
    );
  });

  it('leaves a computed row (ALL METHODS) alone — no prompt, no rename', async () => {
    const { ctl } = makeController();

    await ctl.renameMethodCategory(new MethodCategoryItem(false, ALL_METHODS_CATEGORY, true));

    expect(showInputBox).not.toHaveBeenCalled();
    expect(queries.renameCategory).not.toHaveBeenCalled();
  });

  it('does not rename when the prompt is cancelled', async () => {
    const { ctl } = makeController();
    setEnvLines(ctl, [envLine(false, 'accessing', ['bar'])]);
    showInputBox.mockResolvedValue(undefined);

    await ctl.renameMethodCategory(new MethodCategoryItem(false, 'accessing', false));

    expect(queries.renameCategory).not.toHaveBeenCalled();
  });
});

describe('ExplorerController — New Method target category', () => {
  const openedUriPath = (): string => {
    const arg = openTextDocument.mock.calls[0][0] as vscode.Uri;
    return arg.path;
  };

  it('files a new instance method into the default category when nothing is selected', async () => {
    const { ctl } = makeController();

    await ctl.newInstanceMethod();

    expect(openedUriPath()).toBe('/UserGlobals/M4Demo/instance/as yet unclassified/new-method');
  });

  it('files a new class method on the class side, in the default category when nothing is selected', async () => {
    const { ctl } = makeController();

    await ctl.newClassMethod();

    expect(openedUriPath()).toBe('/UserGlobals/M4Demo/class/as yet unclassified/new-method');
  });

  it('files a new method from a category row into that exact category', async () => {
    const { ctl } = makeController();

    await ctl.newMethod(new MethodCategoryItem(false, 'accessing', false));

    expect(openedUriPath()).toBe('/UserGlobals/M4Demo/instance/accessing/new-method');
  });

  it('files a new instance method into the selected instance-side category', async () => {
    const { ctl } = makeController();
    ctl.recordMethodContext(false, 'accessing');

    await ctl.newInstanceMethod();

    expect(openedUriPath()).toBe('/UserGlobals/M4Demo/instance/accessing/new-method');
  });

  it('files a new class method into the selected class-side category', async () => {
    const { ctl } = makeController();
    ctl.recordMethodContext(true, 'instance creation');

    await ctl.newClassMethod();

    expect(openedUriPath()).toBe('/UserGlobals/M4Demo/class/instance creation/new-method');
  });

  it('ignores a selected category on the other side — categories are per-side', async () => {
    const { ctl } = makeController();
    ctl.recordMethodContext(false, 'accessing');

    await ctl.newClassMethod();

    expect(openedUriPath()).toBe('/UserGlobals/M4Demo/class/as yet unclassified/new-method');
  });

  it('uses the default category when New Method comes from the ALL METHODS row', async () => {
    const { ctl } = makeController();

    await ctl.newMethod(new MethodCategoryItem(false, ALL_METHODS_CATEGORY, true));

    expect(openedUriPath()).toBe('/UserGlobals/M4Demo/instance/as yet unclassified/new-method');
  });
});

describe('ExplorerController — selecting a freshly created method', () => {
  it('selects the newly compiled method under its own category, not ALL METHODS', async () => {
    const { ctl, methodView } = makeController();
    await ctl.newInstanceMethod(); // arms the pending-reveal with the side's current selectors
    methodView.reveal.mockClear();
    vi.mocked(queries.getClassEnvironments).mockReturnValue([
      envLine(false, 'as yet unclassified', ['zap']),
    ]);

    ctl.onExternalMethodCompiled(1, 'M4Demo');

    expect(methodView.reveal).toHaveBeenCalledTimes(1);
    const revealed = methodView.reveal.mock.calls[0][0] as MethodItem;
    expect(revealed).toBeInstanceOf(MethodItem);
    expect(revealed.info.selector).toBe('zap');
    expect(revealed.displayCategory).toBe('as yet unclassified');
  });

  it('reveals nothing when a compile adds no new selector (an edit, not a create)', async () => {
    const { ctl, methodView } = makeController();
    setEnvLines(ctl, [envLine(false, 'accessing', ['bar'])]);
    await ctl.newInstanceMethod();
    methodView.reveal.mockClear();
    vi.mocked(queries.getClassEnvironments).mockReturnValue([envLine(false, 'accessing', ['bar'])]);

    ctl.onExternalMethodCompiled(1, 'M4Demo');

    expect(methodView.reveal).not.toHaveBeenCalled();
  });
});

describe('ExplorerController.removeMethodCategory', () => {
  const warning = () => vi.mocked(vscode.window.showWarningMessage);

  it('removes an emptied server-side category', async () => {
    const { ctl } = makeController();
    // A category the server still lists after its last method moved out — the
    // leftover this action exists to clear.
    setEnvLines(ctl, [envLine(false, 'accessing', []), envLine(false, 'printing', ['printOn:'])]);

    await ctl.removeMethodCategory(new MethodCategoryItem(false, 'accessing', false));

    expect(queries.removeCategory).toHaveBeenCalledWith(
      expect.anything(),
      'M4Demo',
      false,
      'accessing',
      3,
      0,
    );
  });

  it('refetches the pane after a server removal, so the row goes away', async () => {
    // The row disappearing is the whole point of the action; asserting only that the
    // query was called would pass with the pane left showing the removed category.
    const { ctl } = makeController();
    setEnvLines(ctl, [envLine(false, 'accessing', [])]);

    await ctl.removeMethodCategory(new MethodCategoryItem(false, 'accessing', false));

    expect(refetches()).toBe(1);
  });

  it('sweeps the same environment range the pane counted', async () => {
    // The server-side guard must not see fewer environments than the row the user
    // clicked was built from, or it can clear a category holding a method the pane
    // knew about. maxEnvironment comes from configuration; 0 is the mock's default.
    const { ctl } = makeController();
    setEnvLines(ctl, [envLine(false, 'accessing', [])]);

    await ctl.removeMethodCategory(new MethodCategoryItem(false, 'accessing', false));

    const maxEnv = vi.mocked(queries.removeCategory).mock.calls[0][5];
    expect(maxEnv).toBe(vi.mocked(queries.getClassEnvironments).mock.calls[0][3]);
  });

  it('addresses the class side when the row is a class-side category', async () => {
    const { ctl } = makeController();
    setEnvLines(ctl, [envLine(true, 'instance creation', [])]);

    await ctl.removeMethodCategory(new MethodCategoryItem(true, 'instance creation', false));

    expect(queries.removeCategory).toHaveBeenCalledWith(
      expect.anything(),
      'M4Demo',
      true,
      'instance creation',
      3,
      0,
    );
  });

  it('refuses a category that still holds methods, naming the count', async () => {
    const { ctl } = makeController();
    setEnvLines(ctl, [envLine(false, 'accessing', ['bar', 'baz', 'zork'])]);

    await ctl.removeMethodCategory(new MethodCategoryItem(false, 'accessing', false));

    // GemStone's removeCategory: would delete all three methods with it.
    expect(queries.removeCategory).not.toHaveBeenCalled();
    expect(warning()).toHaveBeenCalledWith(expect.stringContaining('3 methods'));
  });

  it('tells the user what to do next when it refuses', async () => {
    const { ctl } = makeController();
    setEnvLines(ctl, [envLine(false, 'accessing', ['bar', 'baz'])]);

    await ctl.removeMethodCategory(new MethodCategoryItem(false, 'accessing', false));

    expect(warning()).toHaveBeenCalledWith(
      expect.stringContaining('move or delete them first, then remove the category.'),
    );
  });

  it('counts methods filed in a non-zero environment too', async () => {
    const { ctl } = makeController();
    setEnvLines(ctl, [
      envLine(false, 'accessing', []),
      { isMeta: false, envId: 1, category: 'accessing', selectors: ['toolMethod'] },
    ]);

    await ctl.removeMethodCategory(new MethodCategoryItem(false, 'accessing', false));

    expect(queries.removeCategory).not.toHaveBeenCalled();
    expect(warning()).toHaveBeenCalledWith(expect.stringContaining('1 method'));
  });

  it("does not count the other side's same-named category", async () => {
    const { ctl } = makeController();
    setEnvLines(ctl, [envLine(false, 'accessing', []), envLine(true, 'accessing', ['default'])]);

    await ctl.removeMethodCategory(new MethodCategoryItem(false, 'accessing', false));

    expect(queries.removeCategory).toHaveBeenCalled();
  });

  it('removes a still-empty just-created category from the overlay, with no server call', async () => {
    const { ctl } = makeController();
    showInputBox.mockResolvedValueOnce('scratch');
    await ctl.newMethodCategory(false);

    await ctl.removeMethodCategory(new MethodCategoryItem(false, 'scratch', false));

    // It was never on the server, so asking would only answer 'no-category' —
    // and with nothing changed there, nothing to refetch either.
    expect(queries.removeCategory).not.toHaveBeenCalled();
    expect(ctl.methodCategories(false).map((c) => c.category)).not.toContain('scratch');
    expect(refetches()).toBe(0);
  });

  it('leaves a computed row (ALL METHODS) alone', async () => {
    const { ctl } = makeController();

    await ctl.removeMethodCategory(new MethodCategoryItem(false, ALL_METHODS_CATEGORY, true));

    expect(queries.removeCategory).not.toHaveBeenCalled();
    expect(warning()).not.toHaveBeenCalled();
  });

  it('reports the server refusing when a method arrived after the click', async () => {
    const { ctl } = makeController();
    setEnvLines(ctl, [envLine(false, 'accessing', [])]);
    vi.mocked(queries.removeCategory).mockReturnValue('has-methods:2');

    await ctl.removeMethodCategory(new MethodCategoryItem(false, 'accessing', false));

    expect(warning()).toHaveBeenCalledWith(expect.stringContaining('2 methods'));
    // The advice must not depend on which side caught it — the client-side
    // pre-check above says the same thing.
    expect(warning()).toHaveBeenCalledWith(
      expect.stringContaining('move or delete them first, then remove the category.'),
    );
  });

  it.each([
    ['has-methods:2', 'a method arrived'],
    ['not-removed', 'GemStone kept it'],
    ['no-class', 'the class no longer resolves'],
    ['no-category', 'the category is already gone'],
    ['a GsProcess', 'the answer was unreadable'],
  ])('refetches the stale pane when %s (%s)', async (answer) => {
    // Every refusal means the pane no longer matches the stone, so leaving the row
    // as it was would show the user something the last round trip disproved.
    const { ctl } = makeController();
    setEnvLines(ctl, [envLine(false, 'accessing', [])]);
    vi.mocked(queries.removeCategory).mockReturnValue(answer);

    await ctl.removeMethodCategory(new MethodCategoryItem(false, 'accessing', false));

    expect(refetches()).toBe(1);
  });

  it('says the answer was unreadable rather than claiming GemStone kept it', async () => {
    // 'not-removed' is the stone telling us what it did; this is us being unable to
    // read the reply. The raw text rides along — it is what a bug report needs.
    const { ctl } = makeController();
    setEnvLines(ctl, [envLine(false, 'accessing', [])]);
    vi.mocked(queries.removeCategory).mockReturnValue('a GsProcess');

    await ctl.removeMethodCategory(new MethodCategoryItem(false, 'accessing', false));

    const message = warning().mock.calls[0][0];
    expect(message).toContain("Couldn't understand GemStone's answer");
    expect(message).toContain('a GsProcess');
    expect(message).not.toContain('kept the method category');
  });

  it('reports GemStone keeping the category instead of claiming a removal', async () => {
    const { ctl } = makeController();
    setEnvLines(ctl, [envLine(false, 'accessing', [])]);
    vi.mocked(queries.removeCategory).mockReturnValue('not-removed');

    await ctl.removeMethodCategory(new MethodCategoryItem(false, 'accessing', false));

    expect(warning()).toHaveBeenCalledWith(
      expect.stringContaining("kept the method category 'accessing'"),
    );
  });

  it('reports a class that no longer resolves', async () => {
    const { ctl } = makeController();
    setEnvLines(ctl, [envLine(false, 'accessing', [])]);
    vi.mocked(queries.removeCategory).mockReturnValue('no-class');

    await ctl.removeMethodCategory(new MethodCategoryItem(false, 'accessing', false));

    expect(warning()).toHaveBeenCalledWith(expect.stringContaining("Couldn't resolve M4Demo"));
  });

  it('reports a category that is already gone', async () => {
    const { ctl } = makeController();
    setEnvLines(ctl, [envLine(false, 'accessing', [])]);
    vi.mocked(queries.removeCategory).mockReturnValue('no-category');

    await ctl.removeMethodCategory(new MethodCategoryItem(false, 'accessing', false));

    expect(warning()).toHaveBeenCalledWith(
      expect.stringContaining("no longer has a method category 'accessing'"),
    );
  });

  it('surfaces a failed removal as an error and keeps the selection', async () => {
    const { ctl } = makeController();
    setEnvLines(ctl, [envLine(false, 'accessing', [])]);
    ctl.state.selectedIsMeta = false;
    ctl.state.selectedMethodCategory = 'accessing';
    vi.mocked(queries.removeCategory).mockImplementation(() => {
      throw new Error('GemStone said no');
    });

    await ctl.removeMethodCategory(new MethodCategoryItem(false, 'accessing', false));

    expect(vi.mocked(vscode.window.showErrorMessage)).toHaveBeenCalledWith(
      expect.stringContaining('GemStone said no'),
    );
    expect(ctl.state.selectedMethodCategory).toBe('accessing');
    // The round trip never landed, so there is nothing newer to fetch.
    expect(refetches()).toBe(0);
  });

  it('drops the recorded selection when the removed category was the selected one', async () => {
    const { ctl } = makeController();
    setEnvLines(ctl, [envLine(false, 'accessing', [])]);
    ctl.state.selectedIsMeta = false;
    ctl.state.selectedMethodCategory = 'accessing';

    await ctl.removeMethodCategory(new MethodCategoryItem(false, 'accessing', false));

    expect(ctl.state.selectedMethodCategory).toBeUndefined();
  });

  it('does nothing without a selected class', async () => {
    const { ctl } = makeController();
    ctl.state.className = undefined;

    await ctl.removeMethodCategory(new MethodCategoryItem(false, 'accessing', false));

    expect(queries.removeCategory).not.toHaveBeenCalled();
    expect(warning()).toHaveBeenCalledWith('Select a class first.');
  });
});
