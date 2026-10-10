import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../webviewAssets', () => ({ readPreviewPanelScript: vi.fn(() => '') }));

import * as vscode from 'vscode';
import { showUndoPlanPanel } from '../undoPlanPanel';
import type { UndoPlan } from '../undoPlan';

/**
 * The panel every non-refactoring undo opens, and the promise the caller waits on.
 *
 * What it answers decides whether the entry is spent. A `false` that should have been `true`
 * loses the undo; a `true` that should have been `false` reverses something the user declined.
 * It is also the guard against a SECOND panel for the same entry: the panel is not modal, so a
 * second Undo while one is open used to raise another for the same entry, and applying both
 * reversed it twice and spent an unrelated one (#396).
 */
const plan: UndoPlan = {
  verb: 'Undo',
  label: 'Add class variable Registry to Shadowed (DictionaryB)',
  rows: [{ id: 'var', action: 'remove class variable', target: 'Shadowed  Registry' }],
};

interface FakePanel {
  webview: {
    html: string;
    onDidReceiveMessage: (cb: (m: unknown) => void) => void;
  };
  onDidDispose: (cb: () => void) => void;
  reveal: ReturnType<typeof vi.fn>;
  dispose: () => void;
  send: (m: unknown) => void;
  close: () => void;
}

let panels: FakePanel[] = [];

function makePanel(): FakePanel {
  let onMessage: ((m: unknown) => void) | undefined;
  let onDispose: (() => void) | undefined;
  let disposed = false;
  const p: FakePanel = {
    webview: {
      html: '',
      onDidReceiveMessage: (cb) => {
        onMessage = cb;
      },
    },
    onDidDispose: (cb) => {
      onDispose = cb;
    },
    reveal: vi.fn(),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      onDispose?.();
    },
    send: (m) => onMessage?.(m),
    close: () => p.dispose(),
  };
  return p;
}

beforeEach(() => {
  panels = [];
  vi.mocked(vscode.window.createWebviewPanel).mockImplementation(() => {
    const p = makePanel();
    panels.push(p);
    return p as never;
  });
});

describe('showUndoPlanPanel', () => {
  it('answers true when the user applies', async () => {
    const answer = showUndoPlanPanel(plan);
    panels[0].send({ command: 'apply' });
    await expect(answer).resolves.toBe(true);
  });

  it('answers false when the user cancels', async () => {
    const answer = showUndoPlanPanel(plan);
    panels[0].send({ command: 'cancel' });
    await expect(answer).resolves.toBe(false);
  });

  it('answers false when the user closes the panel', async () => {
    // Closing is a decline, not a hang: a caller left awaiting would leave the entry unspendable
    // and the Undo button dead.
    const answer = showUndoPlanPanel(plan);
    panels[0].close();
    await expect(answer).resolves.toBe(false);
  });

  it('ignores a message it does not understand rather than settling on it', async () => {
    const answer = showUndoPlanPanel(plan);
    panels[0].send({ command: 'something-else' });
    panels[0].send({});
    panels[0].send(undefined);
    let settled = false;
    void answer.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    panels[0].send({ command: 'apply' });
    await expect(answer).resolves.toBe(true);
  });

  it('settles once: a second apply after the first cannot change the answer', async () => {
    const answer = showUndoPlanPanel(plan);
    panels[0].send({ command: 'cancel' });
    panels[0].send({ command: 'apply' });
    await expect(answer).resolves.toBe(false);
  });

  it('reveals the open panel instead of raising a second one for the same entry', async () => {
    const first = showUndoPlanPanel(plan);
    const second = await showUndoPlanPanel(plan);

    expect(panels).toHaveLength(1);
    expect(panels[0].reveal).toHaveBeenCalled();
    // Not a decline and not an apply -- the question is already on screen, and answering THAT is
    // what spends the entry.
    expect(second).toBe(false);

    panels[0].send({ command: 'apply' });
    await expect(first).resolves.toBe(true);
  });

  it('lets a new panel open once the first has been answered', async () => {
    const first = showUndoPlanPanel(plan);
    panels[0].send({ command: 'apply' });
    await first;

    const second = showUndoPlanPanel(plan);
    expect(panels).toHaveLength(2);
    panels[1].send({ command: 'cancel' });
    await expect(second).resolves.toBe(false);
  });

  it('lets a new panel open after the first was closed rather than answered', async () => {
    const first = showUndoPlanPanel(plan);
    panels[0].close();
    await first;

    void showUndoPlanPanel(plan);
    expect(panels).toHaveLength(2);
    panels[1].send({ command: 'cancel' });
  });
});
