import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import {
  startHereItems,
  showStartHereMenu,
  registerStartHere,
  resetStartHere,
  StartHereStatusBar,
  START_HERE_RETIRED_KEY,
} from '../startHere';

type FakeContext = ConstructorParameters<typeof StartHereStatusBar>[0];

// Minimal ExtensionContext stand-in backed by a plain key/value store, enough for the
// globalState get/update the retirement gate uses.
function makeContext(initial: Record<string, unknown> = {}): {
  context: FakeContext;
  store: Record<string, unknown>;
} {
  const store: Record<string, unknown> = { ...initial };
  const context = {
    globalState: {
      get: (key: string, def?: unknown) => (key in store ? store[key] : def),
      update: async (key: string, value: unknown) => {
        store[key] = value;
      },
    },
  } as unknown as FakeContext;
  return { context, store };
}

const STATUS_COMMAND = 'gemstone.startHere.fromStatusBar';

describe('startHereItems', () => {
  it('offers browse, search, workspace, and the tour, each dispatching a real command', () => {
    const commands = startHereItems().map((i) => i.command);
    expect(commands).toEqual([
      'gemstone.findClass',
      'gemstone.search',
      'gemstone.openWorkspace',
      'gemstone.openWalkthrough',
    ]);
    for (const item of startHereItems()) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('showStartHereMenu', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs the picked item’s command', async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce({
      command: 'gemstone.search',
    } as never);
    await showStartHereMenu();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('gemstone.search');
  });

  it('does nothing when the menu is dismissed', async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce(undefined);
    await showStartHereMenu();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });
});

describe('StartHereStatusBar', () => {
  beforeEach(() => vi.clearAllMocks());

  function setup(initial: Record<string, unknown> = {}) {
    const { context, store } = makeContext(initial);
    const bar = new StartHereStatusBar(context);
    const disposables = bar.register();
    const item = vi.mocked(vscode.window.createStatusBarItem).mock.results.at(-1)!.value;
    return { bar, item, store, disposables };
  }

  it('shows on connect when not retired', () => {
    const { bar, item } = setup();
    bar.showForConnection();
    expect(item.show).toHaveBeenCalledTimes(1);
  });

  it('does not show on connect once retired', () => {
    const { bar, item } = setup({ [START_HERE_RETIRED_KEY]: true });
    bar.showForConnection();
    expect(item.show).not.toHaveBeenCalled();
  });

  it('hides on disconnection without retiring', () => {
    const { bar, item, store } = setup();
    bar.hideForDisconnection();
    expect(item.hide).toHaveBeenCalledTimes(1);
    expect(store[START_HERE_RETIRED_KEY]).toBeUndefined();
  });

  function clickButton() {
    const handler = vi
      .mocked(vscode.commands.registerCommand)
      .mock.calls.find((c) => c[0] === STATUS_COMMAND)?.[1] as () => Promise<void>;
    expect(handler).toBeDefined();
    return handler();
  }

  it('opens the hub on click and offers a Hide entry', async () => {
    setup();
    let offered: Array<{ command: string }> = [];
    vi.mocked(vscode.window.showQuickPick).mockImplementationOnce(async (items: unknown) => {
      offered = items as Array<{ command: string }>;
      return undefined;
    });
    await clickButton();
    expect(vscode.window.showQuickPick).toHaveBeenCalledTimes(1);
    expect(offered.some((i) => i.command === '__startHere.hide')).toBe(true);
  });

  it('does NOT hide when the hub is dismissed (clicked away)', async () => {
    const { item, store } = setup();
    vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce(undefined);
    await clickButton();
    expect(store[START_HERE_RETIRED_KEY]).toBeUndefined();
    expect(item.hide).not.toHaveBeenCalled();
  });

  it('hides persistently only when the Hide entry is chosen', async () => {
    const { item, store } = setup();
    vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce({
      command: '__startHere.hide',
    } as never);
    await clickButton();
    expect(store[START_HERE_RETIRED_KEY]).toBe(true);
    expect(item.hide).toHaveBeenCalled();
    // A command is never dispatched for the Hide action.
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('does not offer the Hide entry from the plain Command Palette menu', async () => {
    let offered: Array<{ command: string }> = [];
    vi.mocked(vscode.window.showQuickPick).mockImplementationOnce(async (items: unknown) => {
      offered = items as Array<{ command: string }>;
      return undefined;
    });
    await showStartHereMenu();
    expect(offered.some((i) => i.command === '__startHere.hide')).toBe(false);
  });
});

describe('resetStartHere', () => {
  it('un-retires the button so it shows again on the next connect', async () => {
    const { context, store } = makeContext({ [START_HERE_RETIRED_KEY]: true });
    await resetStartHere(context);
    expect(store[START_HERE_RETIRED_KEY]).toBeUndefined();
  });
});

describe('registerStartHere', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers the gemstone.startHere command', () => {
    registerStartHere();
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      'gemstone.startHere',
      expect.any(Function),
    );
  });
});
