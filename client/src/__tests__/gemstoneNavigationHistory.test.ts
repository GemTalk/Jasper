import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { Uri } from '../__mocks__/vscode';
import { GemstoneNavigationHistory } from '../gemstoneNavigationHistory';

const M1 = 'gemstone://1/Globals/Array/instance/accessing/at%3A';
const M2 = 'gemstone://1/Globals/Array/instance/accessing/at%3Aput%3A';
const M3 = 'gemstone://1/Globals/OrderedCollection/instance/adding/add%3A';

describe('GemstoneNavigationHistory', () => {
  let opened: string[];
  let openResult: boolean;
  let history: GemstoneNavigationHistory;

  // Simulate VS Code reopening the URI and firing its activation echo, which the
  // real onDidChangeActiveTextEditor subscription feeds back into record().
  function openImpl(uri: Uri): Promise<boolean> {
    opened.push(uri.toString());
    if (openResult) history.record(uri);
    return Promise.resolve(openResult);
  }

  beforeEach(() => {
    opened = [];
    openResult = true;
    history = new GemstoneNavigationHistory(openImpl);
  });

  it('starts unable to go back or forward', () => {
    expect(history.canGoBack()).toBe(false);
    expect(history.canGoForward()).toBe(false);
  });

  it('ignores non-gemstone editors', () => {
    history.record(Uri.parse('file:///tmp/foo.ts'));
    expect(history.canGoBack()).toBe(false);
  });

  it('does not record consecutive duplicates', async () => {
    history.record(Uri.parse(M1));
    history.record(Uri.parse(M1));
    expect(history.canGoBack()).toBe(false);
  });

  it('goes back and forward through the preview history', async () => {
    history.record(Uri.parse(M1));
    history.record(Uri.parse(M2));
    history.record(Uri.parse(M3));

    expect(history.canGoBack()).toBe(true);
    expect(history.canGoForward()).toBe(false);

    await history.back();
    expect(opened).toEqual([M2]);
    expect(history.canGoForward()).toBe(true);

    await history.back();
    expect(opened).toEqual([M2, M1]);
    expect(history.canGoBack()).toBe(false);

    await history.forward();
    expect(opened).toEqual([M2, M1, M2]);
  });

  it('does not re-record its own back/forward navigation (no stack corruption)', async () => {
    history.record(Uri.parse(M1));
    history.record(Uri.parse(M2));
    await history.back(); // reopens M1; the echo record(M1) must be ignored
    // Forward must still be available — a corrupted stack would have truncated it.
    expect(history.canGoForward()).toBe(true);
    await history.forward();
    expect(opened).toEqual([M1, M2]);
  });

  it('truncates forward history when a new editor is visited after going back', async () => {
    history.record(Uri.parse(M1));
    history.record(Uri.parse(M2));
    await history.back(); // now at M1, M2 is ahead
    history.record(Uri.parse(M3)); // new branch — M2 is dropped
    expect(history.canGoForward()).toBe(false);
    await history.back();
    expect(opened).toEqual([M1, M1]); // reopened M1 for the back-nav, then M1 again
  });

  it('is a no-op at the ends', async () => {
    history.record(Uri.parse(M1));
    await history.back();
    await history.forward();
    expect(opened).toEqual([]);
  });

  it('drops a stale entry that fails to reopen and keeps the cursor put', async () => {
    history.record(Uri.parse(M1));
    history.record(Uri.parse(M2));
    history.record(Uri.parse(M3)); // cursor at M3
    openResult = false; // M2 can't be reopened (e.g. dead session)
    await history.back();
    expect(opened).toEqual([M2]); // attempted M2
    // M2 pruned; a second back now reaches M1.
    openResult = true;
    await history.back();
    expect(opened).toEqual([M2, M1]);
  });
});
