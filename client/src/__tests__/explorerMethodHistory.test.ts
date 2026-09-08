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
import * as queries from '../browserQueries';
import { installMethodHistory } from '../methodHistory/methodHistoryServer';
import {
  showMethodHistoryPanel,
  refreshMethodHistoryPanel,
} from '../methodHistory/methodHistoryPanel';
import { Uri, window } from '../__mocks__/vscode';
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

describe('opening method history from an editor URI', () => {
  it('opens history for the method the gemstone editor URI names', async () => {
    const ctl = makeController();

    await ctl.openMethodHistoryForUri(
      Uri.parse('gemstone://1/UserGlobals/Array/instance/accessing/at%3A'),
    );

    expect(showMethodHistoryPanel).toHaveBeenCalledTimes(1);
  });

  it('does nothing but note it when the editor is not a method (e.g. a class definition)', async () => {
    const ctl = makeController();
    const info = window.showInformationMessage as ReturnType<typeof vi.fn>;

    await ctl.openMethodHistoryForUri(Uri.parse('gemstone://1/UserGlobals/Array/definition'));

    expect(showMethodHistoryPanel).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalled();
  });
});

// A class name alone does not identify a class — two SymbolDictionaries can each hold
// a different class called Foo. The dictionary is therefore part of a panel's identity
// and of every history read, so opening Foo>>bar from dict A never shows (or restores
// against) dict B's Foo>>bar.
describe('dictionary scoping of method-history panels', () => {
  it('opens separate tabs for same-named classes in different dictionaries', async () => {
    const ctl = makeController();

    await ctl.openMethodHistory(SESSION, 'Foo', 'bar', false, 1);
    await ctl.openMethodHistory(SESSION, 'Foo', 'bar', false, 2);

    expect(showMethodHistoryPanel).toHaveBeenCalledTimes(2);
    expect(fakePanel.reveal).not.toHaveBeenCalled();
  });

  it('still reveals the existing tab for the same class in the same dictionary', async () => {
    const ctl = makeController();

    await ctl.openMethodHistory(SESSION, 'Foo', 'bar', false, 2);
    await ctl.openMethodHistory(SESSION, 'Foo', 'bar', false, 2);

    expect(showMethodHistoryPanel).toHaveBeenCalledTimes(1);
    expect(fakePanel.reveal).toHaveBeenCalledTimes(1);
  });

  it('passes the dictionary through to the history read', async () => {
    const ctl = makeController();

    await ctl.openMethodHistory(SESSION, 'Foo', 'bar', false, 7);

    const getMethodHistory = queries.getMethodHistory as ReturnType<typeof vi.fn>;
    expect(getMethodHistory).toHaveBeenCalledWith(SESSION, 'Foo', 'bar', false, 7);
  });
});

// Each panel refresh is a blocking GCI round trip. The compile event carries the
// selector, so only the panel for the method that actually changed re-fetches.
describe('selector-targeted refresh', () => {
  it('refreshes only the panel for the recompiled selector', async () => {
    const ctl = makeController();
    await ctl.openMethodHistory(SESSION, 'Array', 'at:', false, 1);
    await ctl.openMethodHistory(SESSION, 'Array', 'size', false, 1);
    ctl.state.className = 'Other';

    ctl.onExternalMethodCompiled(1, 'Array', 'at:');

    expect(refreshMethodHistoryPanel).toHaveBeenCalledTimes(1);
  });

  it('refreshes every panel for the class when the event carries no selector', async () => {
    const ctl = makeController();
    await ctl.openMethodHistory(SESSION, 'Array', 'at:', false, 1);
    await ctl.openMethodHistory(SESSION, 'Array', 'size', false, 1);
    ctl.state.className = 'Other';

    ctl.onExternalMethodCompiled(1, 'Array');

    expect(refreshMethodHistoryPanel).toHaveBeenCalledTimes(2);
  });
});

// The helper is installed at login, so the common path must not pay a ~14-method
// compile before every read just to hit the server's already-installed short-circuit.
describe('lazy install of the method-history helper', () => {
  it('does not re-install the helper when the read succeeds', async () => {
    const ctl = makeController();

    await ctl.openMethodHistory(SESSION, 'Array', 'at:', false, 1);

    expect(installMethodHistory).not.toHaveBeenCalled();
  });

  it('installs once and retries when the session reports the helper missing', async () => {
    const ctl = makeController();
    const getMethodHistory = queries.getMethodHistory as ReturnType<typeof vi.fn>;
    getMethodHistory.mockImplementationOnce(() =>
      JSON.stringify({ error: 'Method history support is not available in this session.' }),
    );

    await ctl.openMethodHistory(SESSION, 'Array', 'at:', false, 1);

    expect(installMethodHistory).toHaveBeenCalledTimes(1);
    expect(showMethodHistoryPanel).toHaveBeenCalledTimes(1);
  });

  it('does not install for an unrelated query failure', async () => {
    const ctl = makeController();
    const getMethodHistory = queries.getMethodHistory as ReturnType<typeof vi.fn>;
    getMethodHistory.mockImplementationOnce(() => {
      throw new Error('GCI session is busy');
    });

    await ctl.openMethodHistory(SESSION, 'Array', 'at:', false, 1);

    expect(installMethodHistory).not.toHaveBeenCalled();
    expect(showMethodHistoryPanel).not.toHaveBeenCalled();
  });
});
