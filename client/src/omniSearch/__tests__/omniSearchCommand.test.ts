import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', async () => {
  const actual = await vi.importActual<typeof import('../../gciLog')>('../../gciLog');
  return { ...actual, logWarning: vi.fn() };
});

import * as vscode from 'vscode';
import { logWarning } from '../../gciLog';
import { buildOmniHandlers, revealPanelAfterLogin } from '../omniSearchCommand';

describe('buildOmniHandlers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reveals a dictionary by name via the Explorer command, not a bare pane focus', () => {
    void buildOmniHandlers().revealDictionary({
      kind: 'revealDictionary',
      sessionId: 1,
      dictName: 'V8SplitDemo',
    });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'gemstone.explorer.revealDictionary',
      'V8SplitDemo',
    );
  });

  it('jumps a global to the class of its value, not to the dictionary', () => {
    void buildOmniHandlers().revealGlobal({
      kind: 'revealGlobal',
      sessionId: 1,
      dictName: 'Globals',
      name: 'Transcript',
      className: 'GsTerminalStream',
    });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'gemstone.explorer.findClass',
      'GsTerminalStream',
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

  it('reveals a class category via dict + path, not just the dictionary', () => {
    void buildOmniHandlers().revealCategory({
      kind: 'revealCategory',
      sessionId: 1,
      dictName: 'Globals',
      dictIndex: 1,
      category: 'Kernel-Objects',
    });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'gemstone.explorer.revealCategory',
      'Globals',
      'Kernel-Objects',
    );
  });
});

describe('revealPanelAfterLogin', () => {
  /** A stub view provider whose `focus()` reports "the view resolved" after `resolvesOnAttempt` tries
   *  — the workbench catching up with the `when` clause, which is the whole race being fixed. */
  const providerResolvingOn = (resolvesOnAttempt: number) => {
    let attempts = 0;
    return {
      focus: vi.fn<() => Promise<boolean>>(() => Promise.resolve(++attempts >= resolvesOnAttempt)),
    };
  };
  const nap = (): Promise<void> => Promise.resolve(); // instant, so the bounded retry costs no wall time

  beforeEach(() => vi.clearAllMocks());

  it('waits on the hasActiveSession context key before revealing, instead of on a timer', async () => {
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

    await expect(revealPanelAfterLogin(provider, nap)).resolves.toBe(true);

    expect(contextWasSetFirst).toBe(true);
  });

  it('reveals on the first attempt when the view is already there (no retry, no delay)', async () => {
    const provider = providerResolvingOn(1);
    const sleep = vi.fn(nap);

    await expect(revealPanelAfterLogin(provider, sleep)).resolves.toBe(true);

    expect(provider.focus).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(logWarning).not.toHaveBeenCalled();
  });

  it('retries until the view resolves, then stops', async () => {
    const provider = providerResolvingOn(3);
    const sleep = vi.fn(nap);

    await expect(revealPanelAfterLogin(provider, sleep)).resolves.toBe(true);

    expect(provider.focus).toHaveBeenCalledTimes(3); // two misses, then the view is there
    expect(sleep).toHaveBeenCalledTimes(2); // only between attempts — never after the win
    expect(logWarning).not.toHaveBeenCalled();
  });

  it('gives up after a bounded number of attempts and logs instead of failing silently', async () => {
    const provider = providerResolvingOn(Number.POSITIVE_INFINITY); // the view never resolves
    const sleep = vi.fn(nap);

    await expect(revealPanelAfterLogin(provider, sleep)).resolves.toBe(false);

    expect(provider.focus).toHaveBeenCalledTimes(5);
    expect(sleep).toHaveBeenCalledTimes(4); // bounded: no attempt-6, no unbounded polling
    expect(vi.mocked(logWarning).mock.calls[0][0]).toMatch(/did not appear after login/);
  });
});
