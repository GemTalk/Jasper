import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// The controller pulls in browserQueries (→ native GCI). Stub it; these tests only
// exercise openMethod and the syncToEditor guards, which never reach a query.
vi.mock('../browserQueries', () => ({}));

import type * as vscode from 'vscode';
import { ExplorerController, MethodItem } from '../gemstoneExplorer';
import { Uri, window, commands, workspace } from '../__mocks__/vscode';
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

    await ctl.openMethod(methodItem({ selector: 'at:', category: 'accessing' }), false);

    const opened = openTextDocument.mock.calls[0][0] as vscode.Uri;
    expect(String(opened)).toContain('gemstone://1/UserGlobals/Array/instance/accessing/at');
    expect(opened.query).toBe('dict=1');
  });

  it('escapes the class side into the URI for a class-side method', async () => {
    const ctl = makeController();

    await ctl.openMethod(methodItem({ selector: 'new' }, true), false);

    expect(String(openTextDocument.mock.calls[0][0])).toContain(
      'gemstone://1/UserGlobals/Array/class/accessing/new',
    );
  });

  it('single-click opens the method as the transient tab, keeping focus in the tree', async () => {
    const ctl = makeController();

    await ctl.openMethod(methodItem(), false);

    expect(showTextDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ preview: false, preserveFocus: true }),
    );
    expect(ctl.placement.reusableTab).toBe(String(openTextDocument.mock.calls[0][0]));
  });

  it('pin opens the method as a pinned tab', async () => {
    const ctl = makeController();

    await ctl.openMethod(methodItem(), true);

    expect(showTextDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ preview: false, preserveFocus: false }),
    );
    expect(executeCommand).toHaveBeenCalledWith('workbench.action.pinEditor');
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
    await ctl.openMethod(methodItem(), false);
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
});
