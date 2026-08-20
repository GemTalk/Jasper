import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// The controller pulls in browserQueries (→ native GCI). Stub it; these tests only
// exercise openMethod and the syncToEditor guards, which never reach a query.
vi.mock('../browserQueries', () => ({}));

import type * as vscode from 'vscode';
import { ExplorerController, MethodItem } from '../gemstoneExplorer';
import type { ExplorerTestResult } from '../gemstoneExplorer';
import { Uri, window, commands, workspace, languages } from '../__mocks__/vscode';
import type { SessionManager, ActiveSession } from '../sessionManager';

// Structural mirror of the (unexported) SelectorInfo the tree items carry.
type SelectorInfo = {
  selector: string;
  category: string;
  overrideBits: number;
  sessionBit: number;
};

const SESSION = { id: 1 } as ActiveSession;

function controllerFor(session: ActiveSession | undefined): ExplorerController {
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.dictIndex = 1;
  ctl.state.className = 'Array';
  return ctl;
}

function makeController(): ExplorerController {
  return controllerFor(SESSION);
}

function info(over: Partial<SelectorInfo> = {}): SelectorInfo {
  return { selector: 'at:', category: 'accessing', overrideBits: 0, sessionBit: 0, ...over };
}

function methodItem(over: Partial<SelectorInfo> = {}, isMeta = false): MethodItem {
  const i = info(over);
  return new MethodItem(isMeta, i, i.category);
}

// A minimal TreeView-shaped stub for setViews.
function fakeView() {
  return { reveal: vi.fn(async () => {}), selection: [] as unknown[], description: '' };
}
function withViews(ctl: ExplorerController) {
  const method = fakeView();
  ctl.setViews({
    dict: fakeView(),
    category: fakeView(),
    klass: fakeView(),
    hierarchy: fakeView(),
    method,
  } as never);
  return method;
}

const showTextDocument = window.showTextDocument as ReturnType<typeof vi.fn>;
const executeCommand = commands.executeCommand as ReturnType<typeof vi.fn>;
const openTextDocument = workspace.openTextDocument as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  window.tabGroups.all = [];
  window.activeTextEditor = undefined;
});

describe('ExplorerController.openMethod', () => {
  it('does nothing without a selected session', async () => {
    const ctl = controllerFor(undefined);

    await ctl.openMethod(methodItem());

    expect(openTextDocument).not.toHaveBeenCalled();
    expect(showTextDocument).not.toHaveBeenCalled();
  });

  it('does nothing without a selected class', async () => {
    const ctl = makeController();
    ctl.state.className = undefined;

    await ctl.openMethod(methodItem());

    expect(openTextDocument).not.toHaveBeenCalled();
  });

  it('opens the method URI built from the node and the current dictionary/class', async () => {
    const ctl = makeController();

    await ctl.openMethod(methodItem({ selector: 'at:', category: 'accessing' }), 'preview');

    const opened = openTextDocument.mock.calls[0][0] as vscode.Uri;
    expect(String(opened)).toContain('gemstone://1/UserGlobals/Array/instance/accessing/at');
    expect(opened.query).toBe('dict=1');
  });

  it('escapes the class side into the URI for a class-side method', async () => {
    const ctl = makeController();

    await ctl.openMethod(methodItem({ selector: 'new' }, true), 'preview');

    expect(String(openTextDocument.mock.calls[0][0])).toContain(
      'gemstone://1/UserGlobals/Array/class/accessing/new',
    );
  });

  it('single-click opens the method as a preview tab, keeping focus in the tree', async () => {
    const ctl = makeController();

    await ctl.openMethod(methodItem(), 'preview');

    expect(showTextDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ preview: true, preserveFocus: true }),
    );
  });

  it('tags the doc as gemstone-smalltalk before showing it (so CodeLens does not pop in)', async () => {
    const ctl = makeController();
    const setLang = languages.setTextDocumentLanguage as ReturnType<typeof vi.fn>;

    await ctl.openMethod(methodItem(), 'preview');

    expect(setLang).toHaveBeenCalledWith(expect.anything(), 'gemstone-smalltalk');
    // Language is set before the doc is shown in the (reused) preview editor.
    expect(setLang.mock.invocationCallOrder[0]).toBeLessThan(
      showTextDocument.mock.invocationCallOrder[0],
    );
  });

  it('double-click promotes the method to a permanent tab, keeping focus in the tree', async () => {
    const ctl = makeController();

    await ctl.openMethod(methodItem(), 'keep');

    expect(showTextDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ preview: false, preserveFocus: true }),
    );
    expect(executeCommand).not.toHaveBeenCalledWith('workbench.action.pinEditor');
  });

  it('pin opens the method as a pinned tab', async () => {
    const ctl = makeController();

    await ctl.openMethod(methodItem(), 'pin');

    expect(showTextDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ preview: false, preserveFocus: false }),
    );
    expect(executeCommand).toHaveBeenCalledWith('workbench.action.pinEditor');
  });
});

describe('MethodItem click wiring', () => {
  it('routes each click to the double-click hook, carrying the node', () => {
    const node = methodItem();

    expect(node.command).toMatchObject({
      command: 'gemstone.explorer.methodClicked',
      arguments: [node],
    });
  });
});

describe('ExplorerController.handleMethodClick', () => {
  it('leaves the first click to the single-click preview open', () => {
    const ctl = makeController();
    const open = vi.spyOn(ctl, 'openMethod').mockResolvedValue();

    ctl.handleMethodClick(methodItem());

    expect(open).not.toHaveBeenCalled();
  });

  it('promotes the preview to a permanent tab on a double-click of the same method', () => {
    const ctl = makeController();
    const open = vi.spyOn(ctl, 'openMethod').mockResolvedValue();
    const node = methodItem();

    ctl.handleMethodClick(node);
    ctl.handleMethodClick(node);

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(node, 'keep');
  });

  it('does not promote when two clicks land on different methods', () => {
    const ctl = makeController();
    const open = vi.spyOn(ctl, 'openMethod').mockResolvedValue();

    ctl.handleMethodClick(methodItem({ selector: 'at:' }));
    ctl.handleMethodClick(methodItem({ selector: 'size' }));

    expect(open).not.toHaveBeenCalled();
  });
});

describe('ExplorerController.syncToEditor', () => {
  it('ignores a non-gemstone editor', async () => {
    const ctl = makeController();
    const method = withViews(ctl);

    await ctl.syncToEditor(Uri.parse('file:///x.ts'));

    expect(method.reveal).not.toHaveBeenCalled();
  });

  // Make the target selector resolvable so a reveal WOULD fire absent the guard —
  // otherwise these negative assertions would pass trivially (empty selector set).
  function stubResolvableSelector(ctl: ExplorerController) {
    vi.spyOn(ctl as unknown as { selectorsFor: typeof info }, 'selectorsFor').mockReturnValue([
      info({ selector: 'at:' }),
    ] as never);
  }

  it('does not re-reveal the tree for an editor it opened itself', async () => {
    const ctl = makeController();
    const method = withViews(ctl);
    stubResolvableSelector(ctl);
    await ctl.openMethod(methodItem(), 'preview');
    const openedUri = openTextDocument.mock.calls[0][0] as vscode.Uri;
    method.reveal.mockClear();

    await ctl.syncToEditor(openedUri);

    expect(method.reveal).not.toHaveBeenCalled();
  });

  it('does not re-reveal when the focused method is already the tree selection', async () => {
    const ctl = makeController();
    const method = fakeView();
    method.selection = [new MethodItem(false, info({ selector: 'at:' }), 'accessing')];
    ctl.setViews({
      dict: fakeView(),
      category: fakeView(),
      klass: fakeView(),
      hierarchy: fakeView(),
      method,
    } as never);
    stubResolvableSelector(ctl);

    await ctl.syncToEditor(Uri.parse('gemstone://1/UserGlobals/Array/instance/accessing/at%3A'));

    expect(method.reveal).not.toHaveBeenCalled();
  });

  it('still follows a later focus event for a method that was already the active editor', async () => {
    // Discover the exact URI a click on this node builds, via a throwaway controller.
    const probe = makeController();
    await probe.openMethod(methodItem(), 'preview');
    const builtUri = openTextDocument.mock.calls[0][0] as vscode.Uri;
    vi.clearAllMocks();

    // The method is already the focused editor, so opening it fires no active-editor
    // change — openMethod must NOT leave a self-open mark that swallows a genuine
    // later focus event for this tab.
    const ctl = makeController();
    const method = withViews(ctl);
    stubResolvableSelector(ctl);
    window.activeTextEditor = { document: { uri: builtUri } };
    await ctl.openMethod(methodItem(), 'preview');
    method.reveal.mockClear();

    await ctl.syncToEditor(builtUri);

    expect(method.reveal).toHaveBeenCalled();
  });
});

describe('a click in the Testing view', () => {
  const TEST_URI = 'gemstone://1/UserGlobals/Array/instance/accessing/at%3A';
  const ORDINARY_URI = 'gemstone://1/UserGlobals/Array/instance/accessing/size';

  function ctl(): ExplorerController {
    const sessionManager = { getSelectedSession: () => SESSION } as unknown as SessionManager;
    const c = new ExplorerController(sessionManager, undefined, undefined, {
      isTestClass: () => true,
      isTestItemUri: (uri) => uri.toString() === TEST_URI,
      resultFor: () => undefined,
      onDidChangeResults: () => ({ dispose: () => {} }),
      revealInTestExplorer: () => Promise.resolve(true),
    });
    c.state.dictName = 'UserGlobals';
    c.state.dictIndex = 1;
    c.state.className = 'Array';
    // Both selectors resolve, so each assertion turns on the guard rather than on
    // whether a reveal was possible at all.
    vi.spyOn(c as unknown as { selectorsFor: typeof info }, 'selectorsFor').mockReturnValue([
      info({ selector: 'at:' }),
      info({ selector: 'size' }),
    ] as never);
    return c;
  }

  it('leaves the panes alone — the Testing view navigates on its own', () => {
    const c = ctl();
    const method = withViews(c);

    return c.syncToEditor(Uri.parse(TEST_URI)).then(() => {
      expect(method.reveal).not.toHaveBeenCalled();
    });
  });

  it('follows an open someone claimed, even onto a test method', async () => {
    // Reveal in GemStone Explorer, and GemStone Search via gemstone.openDocument.
    const c = ctl();
    const method = withViews(c);
    c.markAttributedOpen(Uri.parse(TEST_URI));

    await c.syncToEditor(Uri.parse(TEST_URI));

    expect(method.reveal).toHaveBeenCalled();
  });

  it('consumes a claim once, so the next unclaimed open is ignored again', async () => {
    const c = ctl();
    const method = withViews(c);
    c.markAttributedOpen(Uri.parse(TEST_URI));
    await c.syncToEditor(Uri.parse(TEST_URI));
    method.reveal.mockClear();

    await c.syncToEditor(Uri.parse(TEST_URI));

    expect(method.reveal).not.toHaveBeenCalled();
  });

  it('follows an ordinary method that no test item points at', async () => {
    const c = ctl();
    const method = withViews(c);

    await c.syncToEditor(Uri.parse(ORDINARY_URI));

    expect(method.reveal).toHaveBeenCalled();
  });
});

describe('ExplorerController.isTestSelector', () => {
  function ctlFor(testClasses: string[]): ExplorerController {
    const sessionManager = { getSelectedSession: () => SESSION } as unknown as SessionManager;
    const ctl = new ExplorerController(sessionManager, undefined, undefined, {
      isTestClass: (_dictName: string, className: string) => testClasses.includes(className),
      isTestItemUri: () => false,
      resultFor: () => undefined,
      onDidChangeResults: () => ({ dispose: () => {} }),
      revealInTestExplorer: () => Promise.resolve(true),
    });
    ctl.state.dictName = 'UserGlobals';
    ctl.state.className = 'AnnouncerTest';
    return ctl;
  }

  it('marks an instance-side unary test* selector of a test class', () => {
    expect(ctlFor(['AnnouncerTest']).isTestSelector(false, 'testAnnounceClass')).toBe(true);
  });

  it('leaves the class side alone — SUnit runs instance-side tests', () => {
    expect(ctlFor(['AnnouncerTest']).isTestSelector(true, 'testAnnounceClass')).toBe(false);
  });

  it('leaves a keyword selector alone, however it is spelled', () => {
    // testSelectors is unary-only; `testFoo:` is a helper, not a test.
    expect(ctlFor(['AnnouncerTest']).isTestSelector(false, 'testFoo:')).toBe(false);
  });

  it('leaves setUp and other non-test selectors alone', () => {
    const ctl = ctlFor(['AnnouncerTest']);
    expect(ctl.isTestSelector(false, 'setUp')).toBe(false);
    expect(ctl.isTestSelector(false, 'newAnnouncer')).toBe(false);
  });

  it('marks nothing on a class that is not a TestCase subclass', () => {
    expect(ctlFor([]).isTestSelector(false, 'testAnnounceClass')).toBe(false);
  });

  it('carries a .test token only for a test row, so the inline run icon lands there alone', () => {
    const ctl = ctlFor(['AnnouncerTest']);
    const plain = new MethodItem(false, info({ selector: 'setUp' }));
    const test = new MethodItem(false, info({ selector: 'testAnnounceClass' }));

    ctl.decorateTestRow(plain, 'UserGlobals', 'AnnouncerTest', 'setUp');
    ctl.decorateTestRow(test, 'UserGlobals', 'AnnouncerTest', 'testAnnounceClass');

    expect(plain.contextValue).not.toContain('.test');
    expect(test.contextValue).toContain('.test');
  });

  it('paints the last-known outcome on the row, and dims it once stale', () => {
    const sessionManager = { getSelectedSession: () => SESSION } as unknown as SessionManager;
    const results: Record<string, ExplorerTestResult> = {
      AnnouncerTest: { outcome: 'failed' },
      'AnnouncerTest/testAnnounceClass': { outcome: 'passed', stale: true },
    };
    const ctl = new ExplorerController(sessionManager, undefined, undefined, {
      isTestClass: (_d: string, c: string) => c === 'AnnouncerTest',
      isTestItemUri: () => false,
      resultFor: (_d: string, c: string, sel?: string) =>
        results[sel === undefined ? c : `${c}/${sel}`],
      onDidChangeResults: () => ({ dispose: () => {} }),
      revealInTestExplorer: () => Promise.resolve(true),
    });
    ctl.state.dictName = 'UserGlobals';
    ctl.state.className = 'AnnouncerTest';

    const classRow = new MethodItem(false, info({ selector: 'x' }));
    ctl.decorateTestRow(classRow, 'UserGlobals', 'AnnouncerTest');
    const methodRow = new MethodItem(false, info({ selector: 'testAnnounceClass' }));
    ctl.decorateTestRow(methodRow, 'UserGlobals', 'AnnouncerTest', 'testAnnounceClass');

    expect((classRow.iconPath as { id: string }).id).toBe('error');
    // Stale keeps the shape (it did pass) but takes the queued colour.
    expect((methodRow.iconPath as { id: string }).id).toBe('pass');
    expect((methodRow.iconPath as { color?: { id: string } }).color?.id).toBe('testing.iconQueued');
  });

  it('marks a running row so its run button can be swapped for a stop button', () => {
    const sessionManager = { getSelectedSession: () => SESSION } as unknown as SessionManager;
    const ctl = new ExplorerController(sessionManager, undefined, undefined, {
      isTestClass: () => true,
      isTestItemUri: () => false,
      resultFor: () => ({ outcome: 'running', stoppable: true }),
      onDidChangeResults: () => ({ dispose: () => {} }),
      revealInTestExplorer: () => Promise.resolve(true),
    });
    ctl.state.dictName = 'UserGlobals';
    ctl.state.className = 'AnnouncerTest';
    const row = new MethodItem(false, info({ selector: 'testAnnounceClass' }));

    ctl.decorateTestRow(row, 'UserGlobals', 'AnnouncerTest', 'testAnnounceClass');

    // The menus anchor on `.test$` for run and `.running$` for stop, so the token
    // has to come last.
    expect(row.contextValue?.endsWith('.test.running')).toBe(true);
  });

  it('offers no stop button for a test suspended in the debugger', () => {
    // The debugger owns the gem; its own Terminate ends the test. A ■ of ours
    // would be a button that does nothing.
    const sessionManager = { getSelectedSession: () => SESSION } as unknown as SessionManager;
    const ctl = new ExplorerController(sessionManager, undefined, undefined, {
      isTestClass: () => true,
      isTestItemUri: () => false,
      resultFor: () => ({ outcome: 'running', stoppable: false }),
      onDidChangeResults: () => ({ dispose: () => {} }),
      revealInTestExplorer: () => Promise.resolve(true),
    });
    ctl.state.dictName = 'UserGlobals';
    ctl.state.className = 'AnnouncerTest';
    const row = new MethodItem(false, info({ selector: 'testAnnounceClass' }));

    ctl.decorateTestRow(row, 'UserGlobals', 'AnnouncerTest', 'testAnnounceClass');

    expect(row.contextValue).not.toContain('.running');
    // Nor a ▶ mid-run: the row is neither runnable nor stoppable right now.
    expect(row.contextValue?.endsWith('.test')).toBe(false);
  });

  it('leaves a row that has never run with the icon it was built with', () => {
    const ctl = ctlFor(['AnnouncerTest']);
    const row = new MethodItem(false, info({ selector: 'testAnnounceClass' }));
    const built = row.iconPath;

    ctl.decorateTestRow(row, 'UserGlobals', 'AnnouncerTest', 'testAnnounceClass');

    expect(row.iconPath).toBe(built);
  });
});
