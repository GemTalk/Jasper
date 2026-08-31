/**
 * OmniSearchPanel session binding.
 *
 * The Spotter is a singleton bound to one GemStone session: its engine — and the providers, activation
 * and preview inside it — is built from that session's `deps`. So a second `show()` for the SAME
 * session must just refocus the open panel, while anything that points it at a DIFFERENT session must
 * REBIND it: a bare reveal would keep searching and opening against the previous session with no sign
 * anything is wrong (the reported two-session bug), and the results left on screen would still look
 * live while belonging to a session the user has left.
 *
 * Two ways in, both covered here: an explicit `show()` for another session, and the user making
 * another session active while the Spotter sits there (`onSessionSelectionChanged`).
 *
 * `OmniSearchPanel.current` is a singleton, so each test opens its own panel and the `afterEach`
 * disposes it — `panel.dispose()` is how VS Code closes a tab, and the panel's own `onDidDispose`
 * handler is what clears the singleton. Without that the suite's shuffled order would let one test's
 * live panel decide what the next one sees.
 *
 * createOmniEngine is mocked so `show()`/the constructor need no real session wiring; asserting which
 * deps it was last built from is how we prove the live panel is bound to the right session.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OmniPanelDeps } from '../omniSearchPanel';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../omniEngine', () => ({
  createOmniEngine: vi.fn(() => ({
    prime: vi.fn(async () => {}),
    resync: vi.fn(async () => null),
    refresh: vi.fn(async () => null),
    // Present so the logout test can prove a keystroke never reaches it.
    search: vi.fn(async () => null),
  })),
}));

import * as vscode from 'vscode';
import { OmniSearchPanel } from '../omniSearchPanel';
import { createOmniEngine } from '../omniEngine';
import { NO_SESSION_MESSAGE } from '../omniSearchShared';

// Minimal deps: with createOmniEngine mocked, only sessionId (the identity the panel compares on) and
// the shape matter; the rest are never touched on the show()/rebind paths.
function deps(sessionId: number): OmniPanelDeps {
  return {
    sessionId,
    config: { enabledCategories: [] },
    providers: [],
    activate: vi.fn(),
    previewSource: vi.fn(() => ''),
    onError: vi.fn(),
  } as unknown as OmniPanelDeps;
}

/** Open the Spotter for `sessionId` and hand back the webview panel VS Code was asked to create. */
function open(sessionId = 1) {
  OmniSearchPanel.show(deps(sessionId));
  const created = vi.mocked(vscode.window.createWebviewPanel).mock.results;
  return created[created.length - 1].value;
}

/** The handler the panel registered for webview messages, so a test can play the user typing. */
function messagesTo(panel: { webview: { onDidReceiveMessage: { mock: { calls: unknown[][] } } } }) {
  const calls = panel.webview.onDidReceiveMessage.mock.calls;
  return calls[calls.length - 1][0] as (m: unknown) => void;
}

describe('OmniSearchPanel session binding', () => {
  let panel: ReturnType<typeof open> | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    panel = undefined;
  });
  // Closing the tab is what clears the singleton, so every test starts from no open Spotter.
  afterEach(() => panel?.dispose());

  it('refocuses the open panel when shown again for the same session', () => {
    const p = (panel = open(1));

    OmniSearchPanel.show(deps(1));

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1); // no second panel
    expect(createOmniEngine).toHaveBeenCalledTimes(1); // no needless re-prime of the same session
    expect(p.reveal).toHaveBeenCalled();
    expect(p.webview.postMessage).toHaveBeenCalledWith({ command: 'focusInput' });
    expect(p.dispose).not.toHaveBeenCalled();
  });

  it('rebinds the open panel when shown for a different session', () => {
    const p = (panel = open(1));

    // On the buggy code show() just revealed the panel with its engine still bound to session 1.
    const depsB = deps(2);
    OmniSearchPanel.show(depsB);

    expect(createOmniEngine).toHaveBeenLastCalledWith(depsB);
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1); // the user's tab survives
    expect(p.webview.postMessage).toHaveBeenCalledWith({ command: 'reset' });
  });

  it('rebinds when the user makes another session active without touching the Spotter', () => {
    const p = (panel = open(1));
    p.webview.postMessage.mockClear();

    const depsC = deps(3);
    OmniSearchPanel.onSessionSelectionChanged(() => depsC);

    // So the panel can never answer out of a session that is no longer current.
    expect(createOmniEngine).toHaveBeenLastCalledWith(depsC);
    expect(p.webview.postMessage).toHaveBeenCalledWith({ command: 'reset' });
  });

  it('does nothing when the selection lands back on the session it is already bound to', () => {
    const p = (panel = open(3));
    p.webview.postMessage.mockClear();
    const builds = vi.mocked(createOmniEngine).mock.calls.length;

    OmniSearchPanel.onSessionSelectionChanged(() => deps(3));

    // Re-priming three image-wide GCI executes to arrive where we already are, and wiping the results
    // to show the same ones again, is exactly what the session-id comparison exists to avoid.
    expect(vi.mocked(createOmniEngine).mock.calls.length).toBe(builds);
    expect(p.webview.postMessage).not.toHaveBeenCalled();
  });

  it('drops the engine and says to log in when the last session logs out', () => {
    const p = (panel = open(1));
    const built = vi.mocked(createOmniEngine).mock.results;
    const engine = built[built.length - 1].value;
    p.webview.postMessage.mockClear();

    OmniSearchPanel.onSessionSelectionChanged(() => null);

    // The tab stays (the user put it there) but is wiped and says so, rather than showing the departed
    // session's rows.
    expect(p.webview.postMessage).toHaveBeenCalledWith({ command: 'reset' });
    expect(p.webview.postMessage).toHaveBeenCalledWith({
      command: 'error',
      message: NO_SESSION_MESSAGE,
    });

    // And the engine goes with them. Wiping the screen alone left it holding the departed session's
    // primed corpora, so the next keystroke answered with rows out of a session that is gone — and
    // activating one would open a document against its dead GCI handle.
    p.webview.postMessage.mockClear();
    messagesTo(p)({ command: 'query', value: 'at:' });
    expect(engine.search).not.toHaveBeenCalled();
    expect(p.webview.postMessage).toHaveBeenCalledWith({
      command: 'error',
      message: NO_SESSION_MESSAGE,
    });
  });

  it('re-binds after a logout even when the user logs back into the same session id', () => {
    panel = open(1);
    OmniSearchPanel.onSessionSelectionChanged(() => null);
    const builds = vi.mocked(createOmniEngine).mock.calls.length;

    // Comparing session ids alone would call this a no-op and leave the Spotter engine-less for good.
    const again = deps(1);
    OmniSearchPanel.onSessionSelectionChanged(() => again);

    expect(vi.mocked(createOmniEngine).mock.calls.length).toBe(builds + 1);
    expect(createOmniEngine).toHaveBeenLastCalledWith(again);
  });

  it('builds nothing on a session change when no Spotter is open', () => {
    // The docked panel is the default UI, so this hook fires on every session switch with no Spotter in
    // sight; resolving deps would build a whole provider set for a panel that does not exist.
    const resolve = vi.fn(() => deps(9));

    OmniSearchPanel.onSessionSelectionChanged(resolve);

    expect(resolve).not.toHaveBeenCalled();
  });
});
