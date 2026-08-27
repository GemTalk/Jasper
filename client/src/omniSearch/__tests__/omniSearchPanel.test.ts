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
 * another session active while the Spotter sits there (`onSessionSelectionChanged`). It is all one
 * `it` because `OmniSearchPanel.current` is a singleton whose state would otherwise leak between
 * blocks — and the suite shuffles test order, so a later block could not rely on an earlier one.
 *
 * createOmniEngine is mocked so `show()`/the constructor need no real session wiring; asserting which
 * deps it was last built from is how we prove the live panel is bound to the right session. The whole
 * lifecycle runs as one sequential scenario because OmniSearchPanel.current is a singleton that would
 * otherwise leak between `it` blocks.
 */
import { describe, it, expect, vi } from 'vitest';
import type { OmniPanelDeps } from '../omniSearchPanel';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../omniEngine', () => ({
  createOmniEngine: vi.fn(() => ({
    prime: vi.fn(async () => {}),
    resync: vi.fn(async () => null),
  })),
}));

import * as vscode from 'vscode';
import { OmniSearchPanel } from '../omniSearchPanel';
import { createOmniEngine } from '../omniEngine';

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

describe('OmniSearchPanel session binding', () => {
  it('refocuses on the same session, rebinds on a different one, and never opens a second panel', () => {
    const created = vi.mocked(vscode.window.createWebviewPanel);
    const engine = vi.mocked(createOmniEngine);

    // First open, session 1.
    const depsA = deps(1);
    OmniSearchPanel.show(depsA);
    expect(created).toHaveBeenCalledTimes(1);
    const panelA = created.mock.results[0].value;
    expect(engine).toHaveBeenLastCalledWith(depsA);

    // Second invocation, SAME session: refocus the open panel, do not rebuild anything.
    OmniSearchPanel.show(deps(1));
    expect(created).toHaveBeenCalledTimes(1); // no second panel
    expect(engine).toHaveBeenCalledTimes(1); // no needless re-prime of the same session
    expect(panelA.reveal).toHaveBeenCalled();
    expect(panelA.webview.postMessage).toHaveBeenCalledWith({ command: 'focusInput' });
    expect(panelA.dispose).not.toHaveBeenCalled();

    // Invocation for a DIFFERENT session: re-point the open panel at it. On the buggy code show() just
    // revealed panelA with its engine still bound to session 1.
    const depsB = deps(2);
    OmniSearchPanel.show(depsB);
    expect(engine).toHaveBeenLastCalledWith(depsB);
    expect(created).toHaveBeenCalledTimes(1); // the tab the user opened survives the switch
    expect(panelA.webview.postMessage).toHaveBeenCalledWith({ command: 'reset' });

    // The user makes yet another session active WITHOUT touching the Spotter: same rebind, so the
    // panel can never answer out of a session that is no longer current.
    panelA.webview.postMessage.mockClear();
    const depsC = deps(3);
    OmniSearchPanel.onSessionSelectionChanged(() => depsC);
    expect(engine).toHaveBeenLastCalledWith(depsC);
    expect(panelA.webview.postMessage).toHaveBeenCalledWith({ command: 'reset' });

    // Re-selecting the session it is already bound to must not rebuild the engine or wipe the results.
    panelA.webview.postMessage.mockClear();
    const builds = engine.mock.calls.length;
    OmniSearchPanel.onSessionSelectionChanged(() => deps(3));
    expect(engine.mock.calls.length).toBe(builds);
    expect(panelA.webview.postMessage).not.toHaveBeenCalled();

    // Last session logged out: nothing to search. The tab stays (the user put it there) but is wiped
    // and says so, rather than showing the departed session's rows.
    OmniSearchPanel.onSessionSelectionChanged(() => null);
    expect(panelA.webview.postMessage).toHaveBeenCalledWith({ command: 'reset' });
    expect(panelA.webview.postMessage).toHaveBeenCalledWith({
      command: 'error',
      message: 'Log in to a GemStone session to search.',
    });

    // Closed Spotter: the hook must build NOTHING. The docked panel is the default UI, so this fires on
    // every session switch with no Spotter in sight, and resolving deps would build a provider set for
    // a panel that does not exist. (Closing via panel.dispose() is how VS Code does it — the panel's
    // own onDidDispose handler is what clears the singleton.)
    panelA.dispose();
    const resolve = vi.fn(() => deps(9));
    OmniSearchPanel.onSessionSelectionChanged(resolve);
    expect(resolve).not.toHaveBeenCalled();
  });
});
