/**
 * OmniSearchPanel.show() session binding.
 *
 * The Spotter is a singleton bound to one GemStone session: its engine (and the providers, activation
 * and preview inside it) are built once from that session's `deps` in the constructor. So a second
 * `show()` for the SAME session must just refocus the open panel, but a `show()` for a DIFFERENT
 * session must REPLACE it — a bare reveal would keep searching and opening against the previous session
 * with no sign anything is wrong (the reported two-session bug).
 *
 * createOmniEngine is mocked so `show()`/the constructor need no real session wiring; asserting which
 * deps it was last built from is how we prove the live panel is bound to the right session. The whole
 * lifecycle runs as one sequential scenario because OmniSearchPanel.current is a singleton that would
 * otherwise leak between `it` blocks.
 */
import { describe, it, expect, vi } from 'vitest';
import type { OmniPanelDeps } from '../omniSearchPanel';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../omniEngine', () => ({ createOmniEngine: vi.fn(() => ({})) }));

import * as vscode from 'vscode';
import { OmniSearchPanel } from '../omniSearchPanel';
import { createOmniEngine } from '../omniEngine';

// Minimal deps: with createOmniEngine mocked, only sessionId (the identity show() compares on) and the
// shape matter; the rest are never touched on the show()/constructor path.
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

describe('OmniSearchPanel.show', () => {
  it('refocuses on the same session, but replaces + rebinds the engine on a different one', () => {
    const created = vi.mocked(vscode.window.createWebviewPanel);
    const engine = vi.mocked(createOmniEngine);

    // First open, session 1.
    const depsA = deps(1);
    OmniSearchPanel.show(depsA);
    expect(created).toHaveBeenCalledTimes(1);
    const panelA = created.mock.results[0].value;
    expect(engine).toHaveBeenLastCalledWith(depsA);

    // Second invocation, SAME session: refocus the open panel, do not open a new one.
    OmniSearchPanel.show(deps(1));
    expect(created).toHaveBeenCalledTimes(1); // no second panel
    expect(panelA.reveal).toHaveBeenCalled();
    expect(panelA.webview.postMessage).toHaveBeenCalledWith({ command: 'focusInput' });
    expect(panelA.dispose).not.toHaveBeenCalled();

    // Invocation for a DIFFERENT session: tear the old panel down and build a new one bound to it.
    // On the buggy code show() would just reveal panelA — no dispose, no new panel, engine still bound
    // to session 1 — so all three assertions below pin the fix.
    const depsB = deps(2);
    OmniSearchPanel.show(depsB);
    expect(panelA.dispose).toHaveBeenCalledTimes(1);
    expect(created).toHaveBeenCalledTimes(2);
    expect(engine).toHaveBeenLastCalledWith(depsB);
  });
});
