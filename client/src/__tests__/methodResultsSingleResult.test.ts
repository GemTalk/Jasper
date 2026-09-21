/**
 * Implementors / senders with exactly one hit go straight to the source and say
 * in a toast that there was only one.
 *
 * `showMethodResults` is the one place Senders / Implementors / References /
 * method search offer their results, and it used to put up the type-to-filter
 * picker whatever the count — so a single hit cost a click and told you nothing
 * the toast could not. Jumping silently would be worse than the click: you would
 * not know whether Jasper found one or gave up, which is what the toast is for.
 *
 * The picker itself, and every count above one, is covered in
 * methodResultsPicker.test.ts.
 *
 * Covers https://github.com/GemTalk/Jasper/issues/629
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../systemBrowser', () => ({ SystemBrowser: { navigateTo: vi.fn() } }));
vi.mock('../gemstoneFileSystemProvider', () => ({
  buildMethodUri: vi.fn((parsed: unknown) => ({ scheme: 'gemstone', parsed })),
}));

import * as vscode from 'vscode';
import { window, commands } from '../__mocks__/vscode';
import { showMethodResults } from '../methodResultsPicker';
import { SystemBrowser } from '../systemBrowser';
import { buildMethodUri } from '../gemstoneFileSystemProvider';
import type { MethodSearchResult } from '../queries/methodSearch';

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
  // Nothing takes the navigation, so the fallback path opens the document
  // directly — the one that is observable here.
  navigateTo.mockReturnValue(false);
  vi.mocked(buildMethodUri).mockImplementation(
    (parsed: unknown) => ({ scheme: 'gemstone', parsed }) as never,
  );
});

describe('a result list with exactly one hit', () => {
  it('opens it instead of offering a one-row picker', async () => {
    await showMethodResults(1, [result()], 'Implementors of #balance');

    expect(quickPick).not.toHaveBeenCalled();
    expect(executeCommand).toHaveBeenCalledWith('gemstone.openDocument', expect.anything());
  });

  it('says in a toast that there was only one', async () => {
    await showMethodResults(1, [result()], 'Implementors of #balance');

    expect(info).toHaveBeenCalledWith(expect.stringContaining('Account >> #balance'));
  });

  it('reports that a method was opened', async () => {
    // Safe delete reads this answer to tell "went and looked at a method" from
    // "closed the list again"; going straight to the source is the first.
    expect(await showMethodResults(1, [result()], 'Implementors of #balance')).toBe(true);
  });
});

describe('a result list with more than one hit', () => {
  it('still offers the picker', async () => {
    quickPick.mockResolvedValue(undefined);

    await showMethodResults(1, [result(), result({ className: 'Ledger' })], 'Implementors');

    expect(quickPick).toHaveBeenCalled();
  });
});
