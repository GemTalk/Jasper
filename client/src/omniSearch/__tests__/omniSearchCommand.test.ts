import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', async () => {
  const actual = await vi.importActual<typeof import('../../gciLog')>('../../gciLog');
  return { ...actual, logWarning: vi.fn() };
});

import * as vscode from 'vscode';
import { __resetConfig, __setConfig } from '../../__mocks__/vscode';
import { logWarning } from '../../gciLog';
import { buildOmniHandlers, registerOmniSearch, revealPanelAfterLogin } from '../omniSearchCommand';
import { OMNI_VIEW_ID, OmniSearchViewProvider } from '../omniSearchViewProvider';
import { OmniSearchPanel } from '../omniSearchPanel';

describe('buildOmniHandlers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reveals a dictionary by name via the Explorer command, threading the result session', () => {
    void buildOmniHandlers().revealDictionary({
      kind: 'revealDictionary',
      sessionId: 7,
      dictName: 'V8SplitDemo',
    });

    // The result's own sessionId (7) must be passed so the reveal targets that session, not whatever
    // session is selected now — the fix for the "click after switching sessions lands in the wrong
    // session" bug. Passing a bare pane focus, or dropping the sessionId, fails here.
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'gemstone.explorer.revealDictionary',
      'V8SplitDemo',
      7,
    );
  });

  it('jumps a global to the class of its value, threading the result session', () => {
    void buildOmniHandlers().revealGlobal({
      kind: 'revealGlobal',
      sessionId: 7,
      dictName: 'Globals',
      name: 'Transcript',
      className: 'GsTerminalStream',
    });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'gemstone.explorer.findClass',
      'GsTerminalStream',
      7,
    );
  });

  it('opens a method without stealing focus when preserveFocus is set (references-list open)', () => {
    void buildOmniHandlers({ preserveFocus: true, preview: false }).openMethod({
      kind: 'openMethod',
      sessionId: 1,
      dictName: 'UserGlobals',
      className: 'Foo',
      isMeta: false,
      category: 'accessing',
      selector: 'bar',
      environmentId: 0,
      dictIndex: 0,
    });

    const call = vi
      .mocked(vscode.commands.executeCommand)
      .mock.calls.find((c) => c[0] === 'gemstone.openDocument')!;
    expect(call[2]).toEqual({ preserveFocus: true, preview: false });
  });

  it('reveals a class category via dict + path, threading the result session', () => {
    void buildOmniHandlers().revealCategory({
      kind: 'revealCategory',
      sessionId: 7,
      dictName: 'Globals',
      dictIndex: 1,
      category: 'Kernel-Objects',
    });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'gemstone.explorer.revealCategory',
      'Globals',
      'Kernel-Objects',
      7,
    );
  });
});

describe('revealPanelAfterLogin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets the hasActiveSession context key before revealing, so the view is allowed to exist', async () => {
    // The context key the view's `when` clause reads must already be set when the reveal runs —
    // asserting it from inside focus() pins the ordering without restubbing executeCommand.
    let contextWasSetFirst = false;
    const provider = {
      focus: vi.fn<() => Promise<boolean>>(() => {
        contextWasSetFirst = vi
          .mocked(vscode.commands.executeCommand)
          .mock.calls.some(
            (c) => c[0] === 'setContext' && c[1] === 'gemstone.hasActiveSession' && c[2] === true,
          );
        return Promise.resolve(true);
      }),
    };

    await expect(revealPanelAfterLogin(provider)).resolves.toBe(true);

    expect(contextWasSetFirst).toBe(true);
  });

  it('reveals once and says nothing when the panel comes forward', async () => {
    const provider = { focus: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)) };

    await expect(revealPanelAfterLogin(provider)).resolves.toBe(true);

    expect(provider.focus).toHaveBeenCalledTimes(1); // the wait lives in focus(), not in a retry here
    expect(logWarning).not.toHaveBeenCalled();
  });

  it('logs instead of failing silently when the reveal never lands', async () => {
    const provider = { focus: vi.fn<() => Promise<boolean>>(() => Promise.resolve(false)) };

    await expect(revealPanelAfterLogin(provider)).resolves.toBe(false);

    expect(provider.focus).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logWarning).mock.calls[0][0]).toMatch(/did not appear after login/);
  });
});

describe('registerOmniSearch: when a login reveals the panel', () => {
  /** Drive the real registration with a stub session manager, and hand back a way to fire its
   *  selection event with a chosen number of live sessions. */
  const registerWith = (ui: string) => {
    __setConfig('gemstone.omniSearch', 'ui', ui);

    let sessionCount = 0;
    let fire: () => void = () => {};
    const sessionManager = {
      getSessions: () => Array.from({ length: sessionCount }, (_, i) => ({ id: i + 1 })),
      getSelectedSession: () => undefined,
      onDidChangeSelection: (listener: () => void) => {
        fire = listener;
        return { dispose: () => {} };
      },
    };

    const disposable = registerOmniSearch(sessionManager as never);
    // The reveal is fire-and-forget from the listener, so let its awaits settle before asserting.
    const select = async (count: number): Promise<void> => {
      sessionCount = count;
      fire();
      await Promise.resolve();
      await Promise.resolve();
    };
    const revealed = (): boolean =>
      vi
        .mocked(vscode.commands.executeCommand)
        .mock.calls.some((c) => c[0] === `${OMNI_VIEW_ID}.focus`);
    return { select, revealed, disposable };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // focus() waits on the view resolving, which never happens under the mock; keep that wait off the
    // clock so the test does not sit out the real deadline.
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    __resetConfig();
  });

  it('reveals the panel when a session appears where there were none (a login)', async () => {
    const { select, revealed, disposable } = registerWith('panel');

    await select(1);

    expect(revealed()).toBe(true);
    disposable.dispose();
  });

  it('does not reveal when switching between sessions that already existed', async () => {
    const { select, revealed, disposable } = registerWith('panel');

    await select(2); // already logged in when the listener was wired: not a 0 -> active transition
    vi.mocked(vscode.commands.executeCommand).mockClear();
    await select(2); // a switch between the two

    expect(revealed()).toBe(false);
    disposable.dispose();
  });

  it('does not reveal the panel at all when the Spotter is the chosen UI', async () => {
    const { select, revealed, disposable } = registerWith('spotter');

    await select(1);

    expect(revealed()).toBe(false);
    disposable.dispose();
  });
});

describe('registerOmniSearch: keeping the search bound to the current session', () => {
  /** The same stub shape the reveal tests use, minus the reveal plumbing. */
  const registerWith = () => {
    let fire: () => void = () => {};
    const sessionManager = {
      getSessions: () => [{ id: 1 }, { id: 2 }],
      getSelectedSession: () => ({ id: 2 }),
      onDidChangeSelection: (listener: () => void) => {
        fire = listener;
        return { dispose: () => {} };
      },
    };
    const disposable = registerOmniSearch(sessionManager as never);
    return { fire, disposable };
  };

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => __resetConfig());

  it('tells BOTH hosts when the user makes another session active', () => {
    const onView = vi
      .spyOn(OmniSearchViewProvider.prototype, 'onSessionSelectionChanged')
      .mockResolvedValue(undefined);
    const onSpotter = vi
      .spyOn(OmniSearchPanel, 'onSessionSelectionChanged')
      .mockImplementation(() => {});
    const { fire, disposable } = registerWith();

    fire();

    // Either host can be the live one (the `ui` setting decides), and each ignores the call when it has
    // nothing open — so both are always told rather than branching on the setting here.
    expect(onView).toHaveBeenCalled();
    expect(onSpotter).toHaveBeenCalled();
    onView.mockRestore();
    onSpotter.mockRestore();
    disposable.dispose();
  });

  it('registers the refresh command alongside the open command', () => {
    const { disposable } = registerWith();

    const registered = vi.mocked(vscode.commands.registerCommand).mock.calls.map((c) => c[0]);
    // Contributed as the ⟳ in the panel title bar (package.json view/title) and as a palette entry.
    expect(registered).toContain('gemstone.search.refresh');
    disposable.dispose();
  });
});
