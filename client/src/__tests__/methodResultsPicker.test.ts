import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../systemBrowser', () => ({ SystemBrowser: { navigateTo: vi.fn() } }));
vi.mock('../gemstoneFileSystemProvider', () => ({
  buildMethodUri: vi.fn((parsed: unknown) => ({ scheme: 'gemstone', parsed })),
}));

import * as vscode from 'vscode';
import { window, commands } from '../__mocks__/vscode';
import { describeMethodResult, showMethodResults } from '../methodResultsPicker';
import { SystemBrowser } from '../systemBrowser';
import { buildMethodUri } from '../gemstoneFileSystemProvider';
import type { MethodSearchResult } from '../queries/methodSearch';

/**
 * The one list-of-found-methods picker, shared by Senders / Implementors / References /
 * method search and by the safe-delete confirmation's "Show References…".
 *
 * Its answer matters as much as its side effect: safe delete uses it to tell "the user went
 * and opened one of these" (they have moved on — abandon the deletion) from "the user closed
 * the list" (still deciding — ask again). Everything downstream of the pick is mocked; what
 * is under test is the routing and the answer.
 */

const quickPick = vscode.window.showQuickPick as ReturnType<typeof vi.fn>;
const info = window.showInformationMessage as ReturnType<typeof vi.fn>;
const navigateTo = SystemBrowser.navigateTo as ReturnType<typeof vi.fn>;
const executeCommand = commands.executeCommand as ReturnType<typeof vi.fn>;

const result = (over: Partial<MethodSearchResult> = {}): MethodSearchResult => ({
  dictName: 'UserGlobals',
  className: 'Account',
  isMeta: false,
  selector: 'balance',
  category: 'accessing',
  environmentId: 0,
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  navigateTo.mockReturnValue(true);
  vi.mocked(buildMethodUri).mockImplementation(
    (parsed: unknown) => ({ scheme: 'gemstone', parsed }) as never,
  );
});

describe('describing a found method', () => {
  it('names the class and selector for an instance-side method', () => {
    expect(describeMethodResult(result())).toBe('Account >> #balance');
  });

  it('names the class side for a class-side method', () => {
    expect(describeMethodResult(result({ isMeta: true, selector: 'reset' }))).toBe(
      'Account class >> #reset',
    );
  });
});

describe('showing an empty result list', () => {
  it('says so instead of opening an empty picker', async () => {
    await showMethodResults(1, [], 'Senders of #nope');

    expect(quickPick).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('no results found'));
  });

  it('reports that nothing was opened', async () => {
    expect(await showMethodResults(1, [], 'Senders of #nope')).toBe(false);
  });
});

describe('showing a result list', () => {
  it('offers one entry per result, described the same way as everywhere else', async () => {
    quickPick.mockResolvedValue(undefined);

    await showMethodResults(1, [result(), result({ isMeta: true, selector: 'reset' })], 'Senders');

    const items = quickPick.mock.calls[0][0] as { label: string }[];
    expect(items.map((i) => i.label)).toEqual(['Account >> #balance', 'Account class >> #reset']);
  });

  it('carries the category and dictionary so the picker can filter on them', async () => {
    quickPick.mockResolvedValue(undefined);

    await showMethodResults(1, [result()], 'Senders');

    const items = quickPick.mock.calls[0][0] as { description: string; detail: string }[];
    expect(items[0].description).toBe('accessing');
    expect(items[0].detail).toBe('UserGlobals');
    const options = quickPick.mock.calls[0][1] as Record<string, unknown>;
    expect(options.matchOnDescription).toBe(true);
    expect(options.matchOnDetail).toBe(true);
  });

  it('counts the results in the prompt', async () => {
    quickPick.mockResolvedValue(undefined);

    await showMethodResults(1, [result()], 'Senders');

    const options = quickPick.mock.calls[0][1] as { placeHolder: string };
    expect(options.placeHolder).toBe('1 method found');
  });
});

describe('choosing a result', () => {
  it('navigates an open System Browser to it', async () => {
    const chosen = result();
    quickPick.mockResolvedValue({ result: chosen });

    await showMethodResults(7, [chosen], 'Senders');

    expect(navigateTo).toHaveBeenCalledWith(7, chosen);
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('opens the method document when no System Browser took the navigation', async () => {
    const chosen = result();
    navigateTo.mockReturnValue(false);
    quickPick.mockResolvedValue({ result: chosen });

    await showMethodResults(7, [chosen], 'Senders');

    expect(buildMethodUri).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'method', sessionId: 7, selector: 'balance' }),
    );
    expect(executeCommand).toHaveBeenCalledWith('gemstone.openDocument', expect.anything());
  });

  it('opens the document in the environment the row was found in', async () => {
    // Hard-coding environment 0 opened the wrong method -- or none -- for a row found
    // elsewhere, which safe delete reaches by scanning every configured environment.
    const chosen = result({ environmentId: 2 });
    navigateTo.mockReturnValue(false);
    quickPick.mockResolvedValue({ result: chosen });

    await showMethodResults(7, [chosen], 'Senders');

    expect(buildMethodUri).toHaveBeenCalledWith(expect.objectContaining({ environmentId: 2 }));
  });

  it('reports that something was opened', async () => {
    quickPick.mockResolvedValue({ result: result() });

    expect(await showMethodResults(1, [result()], 'Senders')).toBe(true);
  });
});

describe('closing the list without choosing', () => {
  it('opens nothing', async () => {
    quickPick.mockResolvedValue(undefined);

    await showMethodResults(1, [result()], 'Senders');

    expect(navigateTo).not.toHaveBeenCalled();
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('reports that nothing was opened, which is what keeps a caller asking', async () => {
    quickPick.mockResolvedValue(undefined);

    expect(await showMethodResults(1, [result()], 'Senders')).toBe(false);
  });
});
