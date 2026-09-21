/**
 * Opening a result from GemStone Search brings the GemStone Explorer up.
 *
 * `openMethod` and `openClass` open the document and leave the Explorer to catch
 * up through `syncToEditor`, so with the sidebar on another view container the
 * jump used to land you in an editor with no sight of where you were in the
 * tree. The container is now shown first and the document opened second, so the
 * cascade has visible panes to reveal into and keyboard focus still ends in the
 * editor you asked for.
 *
 * The exception is `preserveFocus`, which is the Spotter arrow-keying through
 * its references list: taking the sidebar — and the focus with it — on every row
 * would make that list unusable, so the jump there stays an open and nothing
 * more.
 *
 * The container focus is matched loosely (same helper and reasoning as
 * explorerContainerFocus.test.ts).
 *
 * Covers https://github.com/GemTalk/Jasper/issues/629
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', async () => {
  const actual = await vi.importActual<typeof import('../../gciLog')>('../../gciLog');
  return { ...actual, logWarning: vi.fn() };
});

import * as vscode from 'vscode';
import { buildOmniHandlers } from '../omniSearchCommand';

const executeCommand = vscode.commands.executeCommand as ReturnType<typeof vi.fn>;

function focusedTheExplorerContainer(): boolean {
  return executeCommand.mock.calls
    .map((c) => String(c[0]))
    .some(
      (c) =>
        c === 'workbench.view.extension.gemstoneExplorer' ||
        c === 'workbench.view.extension.gemstoneExplorer.focus' ||
        (/^gemstoneExplorer/.test(c) && c.endsWith('.focus')),
    );
}

beforeEach(() => vi.clearAllMocks());

/** The handlers are void-returning but open the document after awaiting the container
 *  focus, so the open lands a microtask later. Drain the queue before asserting. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('opening a Search result', () => {
  it('brings the GemStone Explorer up when a method is opened', async () => {
    void buildOmniHandlers().openMethod({
      kind: 'openMethod',
      sessionId: 7,
      dictName: 'UserGlobals',
      className: 'Account',
      isMeta: false,
      category: 'accessing',
      selector: 'balance',
      environmentId: 0,
      dictIndex: 1,
    });
    await settled();

    expect(focusedTheExplorerContainer()).toBe(true);
    // And the editor still opens — the focus is added to the jump, not instead of it.
    expect(executeCommand.mock.calls.some((c) => c[0] === 'gemstone.openDocument')).toBe(true);
  });

  it('leaves the sidebar alone when the caller asked to preserve focus', async () => {
    // The Spotter arrow-keying through its references list. Taking the sidebar —
    // and the keyboard focus with it — on every row would make the list unusable.
    void buildOmniHandlers({ preserveFocus: true, preview: false }).openMethod({
      kind: 'openMethod',
      sessionId: 7,
      dictName: 'UserGlobals',
      className: 'Account',
      isMeta: false,
      category: 'accessing',
      selector: 'balance',
      environmentId: 0,
      dictIndex: 1,
    });
    await settled();

    expect(focusedTheExplorerContainer()).toBe(false);
    expect(executeCommand.mock.calls.some((c) => c[0] === 'gemstone.openDocument')).toBe(true);
  });

  it('brings the GemStone Explorer up when a class is opened', async () => {
    void buildOmniHandlers().openClass({
      kind: 'openClass',
      sessionId: 7,
      dictName: 'UserGlobals',
      className: 'Account',
      dictIndex: 1,
    });
    await settled();

    expect(focusedTheExplorerContainer()).toBe(true);
  });
});
