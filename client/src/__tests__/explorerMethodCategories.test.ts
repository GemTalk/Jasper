import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// The controller pulls in browserQueries; stub only what these flows touch.
vi.mock('../browserQueries', () => ({
  renameCategory: vi.fn(),
  canClassBeWritten: vi.fn(() => true),
  getClassEnvironments: vi.fn(() => []),
}));

import * as vscode from 'vscode';
import * as queries from '../browserQueries';
import { ExplorerController, MethodCategoryItem, MethodItem } from '../gemstoneExplorer';
import { ALL_METHODS_CATEGORY } from '../systemBrowser';
import type { SessionManager, ActiveSession } from '../sessionManager';
import type { EnvCategoryLine } from '../browserQueries';

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

const showInputBox = vi.mocked(vscode.window.showInputBox);
const openTextDocument = vi.mocked(vscode.workspace.openTextDocument);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(queries.canClassBeWritten).mockReturnValue(true);
  vi.mocked(queries.getClassEnvironments).mockReturnValue([]);
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

  it('files a new instance method into the default category', async () => {
    const { ctl } = makeController();

    await ctl.newInstanceMethod();

    expect(openedUriPath()).toBe('/UserGlobals/M4Demo/instance/as yet unclassified/new-method');
  });

  it('files a new class method on the class side, in the default category', async () => {
    const { ctl } = makeController();

    await ctl.newClassMethod();

    expect(openedUriPath()).toBe('/UserGlobals/M4Demo/class/as yet unclassified/new-method');
  });

  it('files a new method from a category row into that exact category', async () => {
    const { ctl } = makeController();

    await ctl.newMethod(new MethodCategoryItem(false, 'accessing', false));

    expect(openedUriPath()).toBe('/UserGlobals/M4Demo/instance/accessing/new-method');
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
