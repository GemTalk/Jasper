import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

// A controllable fake panel: openMethodHistory stores it and reveals it on a repeat
// request; the live-refresh path calls refreshMethodHistoryPanel with it.
const fakePanel = {
  reveal: vi.fn(),
  onDidDispose: vi.fn(),
  dispose: vi.fn(),
  webview: { postMessage: vi.fn() },
};
vi.mock('../methodHistory/methodHistoryPanel', () => ({
  showMethodHistoryPanel: vi.fn(() => fakePanel),
  refreshMethodHistoryPanel: vi.fn(),
}));
vi.mock('../methodHistory/methodHistoryServer', () => ({
  installMethodHistory: vi.fn(() => true),
}));
vi.mock('../methodHistory/methodHistoryDiff', () => ({ openMethodVersionDiff: vi.fn() }));
// The controller only reaches getMethodHistory on this path (restore's compileMethod
// is never triggered here). Return a single-version payload so it opens a panel.
vi.mock('../browserQueries', () => ({
  getMethodHistory: vi.fn(() =>
    JSON.stringify([
      { index: 1, timeStamp: '', userId: '', category: '', isCurrent: true, source: 'x' },
    ]),
  ),
  compileMethod: vi.fn(),
}));

import { ExplorerController } from '../gemstoneExplorer';
import {
  showMethodHistoryPanel,
  refreshMethodHistoryPanel,
} from '../methodHistory/methodHistoryPanel';
import type { SessionManager, ActiveSession } from '../sessionManager';

const SESSION = { id: 1 } as ActiveSession;

function makeController(): ExplorerController {
  const sessionManager = {
    getSelectedSession: () => SESSION,
    getSession: (id: number) => (id === 1 ? SESSION : undefined),
  } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.dictIndex = 1;
  ctl.state.className = 'Array';
  return ctl;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('one method-history tab per method', () => {
  it('opens a viewer for a method', async () => {
    const ctl = makeController();

    await ctl.openMethodHistory(SESSION, 'Array', 'at:', false, 1);

    expect(showMethodHistoryPanel).toHaveBeenCalledTimes(1);
    expect(fakePanel.reveal).not.toHaveBeenCalled();
  });

  it('reveals the existing tab instead of opening a duplicate for the same method', async () => {
    const ctl = makeController();

    await ctl.openMethodHistory(SESSION, 'Array', 'at:', false, 1);
    await ctl.openMethodHistory(SESSION, 'Array', 'at:', false, 1);

    expect(showMethodHistoryPanel).toHaveBeenCalledTimes(1);
    expect(fakePanel.reveal).toHaveBeenCalledTimes(1);
  });

  it('opens separate tabs for a different selector and for the class side of the same selector', async () => {
    const ctl = makeController();

    await ctl.openMethodHistory(SESSION, 'Array', 'at:', false, 1);
    await ctl.openMethodHistory(SESSION, 'Array', 'at:', true, 1);
    await ctl.openMethodHistory(SESSION, 'Array', 'size', false, 1);

    expect(showMethodHistoryPanel).toHaveBeenCalledTimes(3);
    expect(fakePanel.reveal).not.toHaveBeenCalled();
  });
});

describe('live refresh of an open method-history panel', () => {
  it('refreshes the matching open panel when its method is recompiled elsewhere', async () => {
    const ctl = makeController();
    await ctl.openMethodHistory(SESSION, 'Array', 'at:', false, 1);
    // Select a different class so the Methods-pane refresh path early-returns; the
    // panel refresh runs first and is independent of the current selection.
    ctl.state.className = 'Other';

    ctl.onExternalMethodCompiled(1, 'Array');

    expect(refreshMethodHistoryPanel).toHaveBeenCalledTimes(1);
  });

  it('does not refresh a panel whose class did not change', async () => {
    const ctl = makeController();
    await ctl.openMethodHistory(SESSION, 'Array', 'at:', false, 1);
    ctl.state.className = 'Other';

    ctl.onExternalMethodCompiled(1, 'Widget');

    expect(refreshMethodHistoryPanel).not.toHaveBeenCalled();
  });

  it('does not refresh a panel from a different session', async () => {
    const ctl = makeController();
    await ctl.openMethodHistory(SESSION, 'Array', 'at:', false, 1);
    ctl.state.className = 'Other';

    ctl.onExternalMethodCompiled(2, 'Array');

    expect(refreshMethodHistoryPanel).not.toHaveBeenCalled();
  });
});
