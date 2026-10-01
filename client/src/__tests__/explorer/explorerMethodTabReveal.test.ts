import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
// `reloadCurrentClassMethods` re-reads the class's environments; nothing else here reaches a
// query. An empty answer is enough — the Methods pane is rendered from `selectorsFor`, which
// these tests stub, and what matters is that the reload REPLACED the list.
vi.mock('../../browserQueries', () => ({
  getClassEnvironments: vi.fn(() => []),
}));

import { ExplorerController, MethodItem } from '../../gemstoneExplorer';
import { Uri, window, workspace } from '../../__mocks__/vscode';
import type { SessionManager, ActiveSession } from '../../sessionManager';

/**
 * Clicking a method's editor tab has to bring its row back into view.
 *
 * The sync stops short when the Methods pane's selection already names the focused method, on
 * the grounds that the row must therefore be where the user can see it. Selection and
 * visibility are not the same thing: reloading the method list rebuilds the tree and sends the
 * viewport back to the top while the selection still answers the same selector, so after a
 * rebuild the one gesture that should scroll the row back is the one that is skipped.
 *
 * The guard is there for the click loop — clicking a row opens the editor, the editor's focus
 * event syncs back, and re-revealing made the pane jump under the click. That has to keep
 * working, so both halves are pinned here: the click still does not move the pane, and a tab
 * focus after a rebuild does.
 */

const SESSION = { id: 1 } as ActiveSession;
const URI = 'gemstone://1/UserGlobals/Array/instance/accessing/isNotNil';

type SelectorInfo = {
  selector: string;
  category: string;
  overrideBits: number;
  sessionBit: number;
};

const info = (selector: string): SelectorInfo => ({
  selector,
  category: 'accessing',
  overrideBits: 0,
  sessionBit: 0,
});

function fakeView() {
  return {
    reveal: vi.fn(async (_item: unknown, _opts?: { focus?: boolean }) => {}),
    selection: [] as unknown[],
    description: '',
    visible: true,
  };
}

/**
 * A controller showing `Array`, with `isNotNil` both selected in the Methods pane and
 * resolvable in the method list — so a reveal is possible and the only thing standing between
 * the sync and it is the already-selected guard.
 */
function controllerShowingSelectedMethod() {
  const sessionManager = { getSelectedSession: () => SESSION } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.dictIndex = 1;
  ctl.state.className = 'Array';

  const method = fakeView();
  method.selection = [new MethodItem(false, info('isNotNil'), 'accessing')];
  ctl.setViews({
    dict: fakeView(),
    category: fakeView(),
    klass: fakeView(),
    hierarchy: fakeView(),
    method,
  } as never);
  vi.spyOn(ctl as unknown as { selectorsFor: typeof info }, 'selectorsFor').mockReturnValue([
    info('isNotNil'),
  ] as never);

  return { ctl, method };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.tabGroups.all = [];
  window.activeTextEditor = undefined;
});

describe('focusing a method editor tab after the Methods pane was rebuilt', () => {
  it('scrolls the row back into view even though the selection still names it', async () => {
    const { ctl, method } = controllerShowingSelectedMethod();
    ctl.reloadCurrentClassMethods();
    method.reveal.mockClear();

    await ctl.syncToEditor(Uri.parse(URI));

    expect(method.reveal).toHaveBeenCalled();
  });

  it('leaves the cursor in the editor rather than pulling focus into the tree', async () => {
    const { ctl, method } = controllerShowingSelectedMethod();
    ctl.reloadCurrentClassMethods();
    method.reveal.mockClear();

    await ctl.syncToEditor(Uri.parse(URI));

    expect(method.reveal.mock.calls[0][1]).toMatchObject({ focus: false });
  });

  it('reveals the row the tab names, not whatever the pane had selected', async () => {
    const { ctl, method } = controllerShowingSelectedMethod();
    ctl.reloadCurrentClassMethods();
    method.reveal.mockClear();

    await ctl.syncToEditor(Uri.parse(URI));

    expect((method.reveal.mock.calls[0][0] as MethodItem).info.selector).toBe('isNotNil');
  });

  it('keeps following later focus events, so it works more than once', async () => {
    const { ctl, method } = controllerShowingSelectedMethod();
    ctl.reloadCurrentClassMethods();
    await ctl.syncToEditor(Uri.parse(URI));
    method.reveal.mockClear();

    ctl.reloadCurrentClassMethods();
    await ctl.syncToEditor(Uri.parse(URI));

    expect(method.reveal).toHaveBeenCalled();
  });
});

describe('clicking a row in the Methods pane', () => {
  it('does not move the pane under the click', async () => {
    // The row the user just clicked is where they are looking; a reveal fired by the editor
    // that click opened scrolls it out from under them.
    const { ctl, method } = controllerShowingSelectedMethod();
    await ctl.openMethod(new MethodItem(false, info('isNotNil'), 'accessing'), 'preview');
    // The URI the click built, rather than one spelled out here: the early return matches on
    // what was actually opened, and a near-miss would let this pass for the wrong reason.
    const opened = vi.mocked(workspace.openTextDocument).mock.calls[0][0] as Uri;
    method.reveal.mockClear();

    await ctl.syncToEditor(opened);

    expect(method.reveal).not.toHaveBeenCalled();
  });
});
