import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', async (orig) => ({ ...(await orig()) }));
vi.mock('../../gciLog', async (orig) => ({
  ...(await orig()),
  logWarning: vi.fn(),
}));

import { ExplorerController, MethodItem } from '../../gemstoneExplorer';
import { window, workspace } from '../../__mocks__/vscode';
import type { SessionManager, ActiveSession } from '../../sessionManager';
import { fakeViews } from '../helpers/explorerContainerFocus';
import { settle } from '../helpers/explorerClicks';

const openTextDocument = vi.mocked(workspace.openTextDocument);
const showTextDocument = vi.mocked(window.showTextDocument);

function method(selector: string): MethodItem {
  return new MethodItem(
    false,
    { selector, category: 'accessing', overrideBits: 0, sessionBit: 0 },
    'accessing',
  );
}

function controllerOnClass() {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.setViews(fakeViews() as never);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.dictIndex = 1;
  ctl.state.className = 'Account';
  return ctl;
}

type Order = 'selection first' | 'command first';

// A click on a row that isn't highlighted: VS Code reports both a selection change and
// the row's command, in either order.
async function clickNewRow(
  ctl: ExplorerController,
  node: MethodItem,
  order: Order = 'selection first',
) {
  if (order === 'command first') ctl.handleMethodClick(node);
  const selected = ctl.clickMethod(node);
  if (order === 'selection first') ctl.handleMethodClick(node);
  await selected;
  await settle();
}

// A click on the highlighted row: VS Code reports only the row's command.
async function clickHighlightedRow(ctl: ExplorerController, node: MethodItem) {
  ctl.handleMethodClick(node);
  await settle();
}

let sessionBusy = false;
const busy = () => new Error('session busy');

// Holds the next source read until the test refuses it.
function nextReadHeldBack() {
  let refuse!: () => void;
  const held = new Promise<never>((_resolve, reject) => (refuse = () => reject(busy())));
  openTextDocument.mockImplementationOnce(() => held);
  return { refuse };
}

const openedSelectors = () =>
  openTextDocument.mock.calls.map((c) => (c[0] as { path: string }).path.split('/').at(-1));
const shownAs = () =>
  showTextDocument.mock.calls.map((c) =>
    (c[1] as { preview: boolean }).preview ? 'preview' : 'permanent',
  );
const visited = (ctl: ExplorerController) => ctl.history.entries().map((l) => l.selector);

beforeEach(() => {
  vi.clearAllMocks();
  window.activeTextEditor = undefined;
  sessionBusy = false;
  openTextDocument.mockImplementation(async (uri: unknown) => {
    if (sessionBusy) throw busy();
    return { uri, getText: () => '', isDirty: false };
  });
  // Frozen, so whether two clicks fall inside the double-click window is up to each test.
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a method click refused while the session is busy', () => {
  it('leaves the previously opened method as the selected one', async () => {
    const ctl = controllerOnClass();
    await clickNewRow(ctl, method('balance'));
    vi.advanceTimersByTime(1000);
    sessionBusy = true;

    await clickNewRow(ctl, method('deposit:'));

    expect(ctl.state.selectedSelector).toBe('balance');
  });

  it('adds nothing to the list of methods visited', async () => {
    const ctl = controllerOnClass();
    await clickNewRow(ctl, method('balance'));
    vi.advanceTimersByTime(1000);
    sessionBusy = true;

    await clickNewRow(ctl, method('deposit:'));

    expect(visited(ctl)).toEqual(['balance']);
  });

  it('opens the method as a preview when its row is clicked again once the session is free', async () => {
    const ctl = controllerOnClass();
    sessionBusy = true;
    await clickNewRow(ctl, method('balance'));
    sessionBusy = false;
    vi.advanceTimersByTime(1000);

    await clickHighlightedRow(ctl, method('balance'));

    expect(shownAs()).toEqual(['preview']);
    expect(ctl.state.selectedSelector).toBe('balance');
    expect(visited(ctl)).toEqual(['balance']);
  });

  it('opens a quick second click as a preview tab, not a permanent one', async () => {
    const ctl = controllerOnClass();
    sessionBusy = true;
    await clickNewRow(ctl, method('balance'));
    sessionBusy = false;

    await clickHighlightedRow(ctl, method('balance'));

    expect(shownAs()).toEqual(['preview']);
  });

  it('opens nothing when its row is clicked again while the session is still busy, then opens on the next click', async () => {
    const ctl = controllerOnClass();
    sessionBusy = true;
    await clickNewRow(ctl, method('balance'));
    vi.advanceTimersByTime(1000);
    await clickHighlightedRow(ctl, method('balance'));
    expect(shownAs()).toEqual([]);
    sessionBusy = false;

    await clickHighlightedRow(ctl, method('balance'));

    expect(shownAs()).toEqual(['preview']);
  });

  it('opens a preview on the next click after a double-click whose reads were both refused', async () => {
    const ctl = controllerOnClass();
    const first = nextReadHeldBack();
    const firstClick = clickNewRow(ctl, method('balance'));
    sessionBusy = true;
    await clickHighlightedRow(ctl, method('balance'));
    first.refuse();
    await firstClick;
    sessionBusy = false;

    await clickHighlightedRow(ctl, method('balance'));

    expect(shownAs()).toEqual(['preview']);
  });

  it('opens the method on its next click after another method is kept open with its pin button', async () => {
    const ctl = controllerOnClass();
    sessionBusy = true;
    await clickNewRow(ctl, method('balance'));
    sessionBusy = false;
    await ctl.openMethod(method('deposit:'), 'pin');
    vi.advanceTimersByTime(1000);

    await clickHighlightedRow(ctl, method('balance'));

    expect(openedSelectors().at(-1)).toBe('balance');
  });
});

describe('a method click when nothing is refused', () => {
  it.each<Order>(['selection first', 'command first'])(
    'reads the method once when VS Code reports the click with its %s',
    async (order) => {
      const ctl = controllerOnClass();

      await clickNewRow(ctl, method('balance'), order);

      expect(openedSelectors()).toEqual(['balance']);
      expect(shownAs()).toEqual(['preview']);
    },
  );

  it('does not open the method again when its highlighted row is clicked', async () => {
    const ctl = controllerOnClass();
    await clickNewRow(ctl, method('balance'));
    vi.advanceTimersByTime(1000);

    await clickHighlightedRow(ctl, method('balance'));

    expect(openedSelectors()).toEqual(['balance']);
  });

  it('keeps a double-clicked method open in a permanent tab', async () => {
    const ctl = controllerOnClass();
    await clickNewRow(ctl, method('balance'));

    await clickHighlightedRow(ctl, method('balance'));

    expect(shownAs()).toEqual(['preview', 'permanent']);
  });

  it('leaves a method out of the list visited when the panes move to another class while it reads', async () => {
    const ctl = controllerOnClass();
    let answer!: () => void;
    openTextDocument.mockImplementationOnce(
      (uri: unknown) =>
        new Promise(
          (resolve) => (answer = () => resolve({ uri, getText: () => '', isDirty: false })),
        ),
    );
    const click = clickNewRow(ctl, method('balance'));
    await settle();
    ctl.state.className = 'Customer';

    answer();
    await click;

    expect(visited(ctl)).toEqual([]);
  });
});
