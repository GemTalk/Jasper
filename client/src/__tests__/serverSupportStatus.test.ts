import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../serverPlugin/pluginFingerprint', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../serverPlugin/pluginFingerprint')>()),
  pluginStatus: vi.fn(),
}));

import * as vscode from 'vscode';
import { pluginStatus, PluginStatus, ReceiptSpec } from '../serverPlugin/pluginFingerprint';
import { REFACTORING_RECEIPT } from '../refactoring/refactoringPayload';
import { describePlugin, noticeDifferentServerSupport } from '../serverSupportStatus';
import { fakeActiveSession } from './fakeActiveSession';

describe('describePlugin', () => {
  it('says the check describes what was filed in, not later edits', () => {
    const text = describePlugin(
      'Refactoring engine',
      { state: 'current', installedBy: '1.15.0' },
      '1.17.0',
    ).join('\n');
    expect(text).toMatch(/installed by Jasper 1\.15\.0/i);
    expect(text).toContain('Later edits to its methods in the stone are not detected');
  });

  it("says a different one is not this Jasper's, without calling it older or newer", () => {
    const text = describePlugin(
      'Enhanced Inspector',
      { state: 'different', installedBy: '1.18.0' },
      '1.17.0',
    ).join('\n');
    expect(text).toContain("Enhanced Inspector: not this Jasper's");
    expect(text).toContain('Installed by Jasper 1.18.0');
    expect(text).toContain('Install Server Support');
    expect(text).not.toMatch(/older|newer|out of date|upgrade/i);
  });

  it('explains one installed before receipts existed, and how to enable the check', () => {
    const text = describePlugin(
      'Refactoring engine',
      { state: 'unknown', unknownReason: 'noReceipt' },
      '1.17.0',
    );
    expect(text[0]).toBe('Refactoring engine: installed, version unknown');
    expect(text.join('\n')).toContain('loaded by hand from topaz');
    expect(text.join('\n')).toContain('to enable this check');
  });

  it('shows why the stone could not be asked', () => {
    const text = describePlugin(
      'Refactoring engine',
      { state: 'unknown', unknownReason: 'unreadable', detail: 'session busy' },
      '1.17.0',
    );
    expect(text.join('\n')).toContain('session busy');
  });
});

describe('noticeDifferentServerSupport', () => {
  const statusMock = vi.mocked(pluginStatus);
  const warn = vi.mocked(vscode.window.showWarningMessage);
  const different = (installed: string, shipped = 'bbbb'): PluginStatus => ({
    state: 'different',
    installedBy: '1.15.0',
    installedDigest: installed,
    shippedDigest: shipped,
  });
  // Answers per feature, told apart by the receipt spec each status call carries.
  const respond = (rb: PluginStatus, ei: PluginStatus = { state: 'current' }) =>
    statusMock.mockImplementation((_s, _i, _d, spec: ReceiptSpec) =>
      spec === REFACTORING_RECEIPT ? rb : ei,
    );

  function memento(): vscode.Memento {
    const store = new Map<string, unknown>();
    return {
      keys: () => [...store.keys()],
      get: <T>(key: string) => store.get(key) as T,
      update: async (key: string, value: unknown) => {
        store.set(key, value);
      },
    };
  }

  function session(stone = 'seaside', rb = true, ei = true) {
    return fakeActiveSession({
      stoneVersion: '3.7.5',
      login: { gem_host: 'localhost', stone },
      rbSupportAvailable: rb,
      enhancedInspectorAvailable: ei,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    warn.mockResolvedValue(undefined);
  });

  it('offers to reinstall when the server support is different', async () => {
    respond(different('aaaa'));

    await noticeDifferentServerSupport(session(), '/ext', memento());

    expect(warn).toHaveBeenCalledOnce();
    const [message, ...buttons] = warn.mock.calls[0];
    expect(message).toContain('seaside');
    expect(message).toContain('Refactoring engine');
    expect(message).toContain('for everyone using this stone');
    expect(buttons).toEqual(['Reinstall', 'Show Status']);
  });

  it('names both features when both are different', async () => {
    respond(different('aaaa'), different('cccc', 'dddd'));

    await noticeDifferentServerSupport(session(), '/ext', memento());

    expect(warn.mock.calls[0][0]).toContain('Refactoring engine and Enhanced Inspector');
  });

  it('reinstalls the whole server support when asked', async () => {
    respond(different('aaaa'));
    warn.mockResolvedValue('Reinstall' as never);

    await noticeDifferentServerSupport(session(), '/ext', memento());

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('gemstone.installServerSupport');
  });

  it('notices again at the next login when the reinstall leaves it different', async () => {
    const seen = memento();
    respond(different('aaaa'));
    warn.mockResolvedValue('Reinstall' as never);

    await noticeDifferentServerSupport(session(), '/ext', seen);
    await noticeDifferentServerSupport(session(), '/ext', seen);

    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('opens the status when asked', async () => {
    respond(different('aaaa'));
    warn.mockResolvedValue('Show Status' as never);

    await noticeDifferentServerSupport(session(), '/ext', memento());

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('gemstone.showServerSupportStatus');
  });

  it.each([
    { state: 'current' as const },
    { state: 'unknown' as const, unknownReason: 'noReceipt' as const },
    { state: 'unknown' as const, unknownReason: 'unreadable' as const, detail: 'session busy' },
  ])('stays silent when the server support is $state', async (status) => {
    respond(status, status);

    await noticeDifferentServerSupport(session(), '/ext', memento());

    expect(warn).not.toHaveBeenCalled();
  });

  it('does not ask the stone about a feature that is not installed', async () => {
    await noticeDifferentServerSupport(session('seaside', false, false), '/ext', memento());

    expect(statusMock).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('notices once per stone and set of fingerprints, and again when one changes', async () => {
    const seen = memento();
    respond(different('aaaa'));

    await noticeDifferentServerSupport(session(), '/ext', seen);
    await noticeDifferentServerSupport(session(), '/ext', seen);
    expect(warn).toHaveBeenCalledTimes(1);

    await noticeDifferentServerSupport(session('other'), '/ext', seen);
    expect(warn).toHaveBeenCalledTimes(2);

    respond(different('aaaa', 'cccc'));
    await noticeDifferentServerSupport(session(), '/ext', seen);
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
