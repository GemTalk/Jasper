import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../gciLog', () => ({ logWarning: vi.fn(), logInfo: vi.fn(), logError: vi.fn() }));
vi.mock('../serverPlugin/pluginFingerprint', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../serverPlugin/pluginFingerprint')>()),
  pluginStatus: vi.fn(),
  readJasperVersion: () => '1.15.0',
}));

import * as vscode from 'vscode';
import { logWarning } from '../gciLog';
import { pluginStatus, PluginStatus, ReceiptSpec } from '../serverPlugin/pluginFingerprint';
import { REFACTORING_RECEIPT } from '../refactoring/refactoringPayload';
import {
  describePlugin,
  isNewerVersion,
  noticeDifferentServerSupport,
} from '../serverSupportStatus';
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
    expect(buttons).toEqual(['Reinstall', 'Show Status', "Don't Ask Again"]);
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
    vi.useFakeTimers();
    try {
      respond(status, status);

      const done = noticeDifferentServerSupport(session(), '/ext', memento());
      await vi.runAllTimersAsync();
      await done;

      expect(warn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // A login keeps its session busy for a moment; a read that fails then must not leave a different
  // support unreported.
  it('asks the stone again when it could not be read, and warns once it answers', async () => {
    vi.useFakeTimers();
    try {
      const busy = {
        state: 'unknown' as const,
        unknownReason: 'unreadable' as const,
        detail: 'busy',
      };
      let reads = 0;
      statusMock.mockImplementation((_s, _i, _d, spec: ReceiptSpec) =>
        spec === REFACTORING_RECEIPT
          ? ++reads < 3
            ? busy
            : different('aaaa')
          : { state: 'current' },
      );

      const done = noticeDifferentServerSupport(session(), '/ext', memento());
      await vi.runAllTimersAsync();
      await done;

      expect(reads).toBe(3);
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs a support it never managed to read', async () => {
    vi.useFakeTimers();
    try {
      respond({ state: 'unknown', unknownReason: 'unreadable', detail: 'session busy' });

      const done = noticeDifferentServerSupport(session(), '/ext', memento());
      await vi.runAllTimersAsync();
      await done;

      expect(vi.mocked(logWarning)).toHaveBeenCalledWith(
        expect.stringContaining('Could not check whether Refactoring engine'),
      );
      expect(warn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not ask the stone about a feature that is not installed', async () => {
    await noticeDifferentServerSupport(session('seaside', false, false), '/ext', memento());

    expect(statusMock).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('notices at every login while the support stays different', async () => {
    const seen = memento();
    respond(different('aaaa'));

    await noticeDifferentServerSupport(session(), '/ext', seen);
    await noticeDifferentServerSupport(session(), '/ext', seen);

    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("stays silent after Don't Ask Again for that stone and set of fingerprints only", async () => {
    const seen = memento();
    respond(different('aaaa'));
    warn.mockResolvedValueOnce("Don't Ask Again" as never);

    await noticeDifferentServerSupport(session(), '/ext', seen);
    await noticeDifferentServerSupport(session(), '/ext', seen);
    expect(warn).toHaveBeenCalledTimes(1);

    await noticeDifferentServerSupport(session('other'), '/ext', seen);
    expect(warn).toHaveBeenCalledTimes(2);

    respond(different('aaaa', 'cccc'));
    await noticeDifferentServerSupport(session(), '/ext', seen);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  describe('with autoInstall "always"', () => {
    it('replaces the different support instead of warning', async () => {
      respond(different('aaaa'));
      const update = vi.fn(() => Promise.resolve());

      await noticeDifferentServerSupport(session(), '/ext', memento(), update);

      expect(update).toHaveBeenCalledWith(['refactoring']);
      expect(warn).not.toHaveBeenCalled();
    });

    it("replaces it even after Don't Ask Again, which only silences the warning", async () => {
      const seen = memento();
      respond(different('aaaa'));
      warn.mockResolvedValueOnce("Don't Ask Again" as never);
      await noticeDifferentServerSupport(session(), '/ext', seen);
      const update = vi.fn(() => Promise.resolve());

      await noticeDifferentServerSupport(session(), '/ext', seen, update);

      expect(update).toHaveBeenCalledOnce();
    });

    it('warns instead, naming the version, when a newer Jasper installed it', async () => {
      respond({ ...different('aaaa'), installedBy: '999.0.0' });
      const update = vi.fn(() => Promise.resolve());

      await noticeDifferentServerSupport(session(), '/ext', memento(), update);

      expect(update).not.toHaveBeenCalled();
      expect(warn.mock.calls[0][0]).toContain(
        'Refactoring engine was installed by a newer Jasper (999.0.0).',
      );
    });
  });
});

describe('isNewerVersion', () => {
  it.each([
    ['1.16.0', '1.15.9', true],
    ['1.15.10', '1.15.9', true],
    ['2.0', '1.99.99', true],
    ['1.15.0', '1.15.0', false],
    ['1.14.0', '1.15.0', false],
    ['1.15', '1.15.0', false],
    [undefined, '1.15.0', false],
    ['1.16.0', '', false],
  ])('%s over %s: %s', (installed, mine, expected) => {
    expect(isNewerVersion(installed, mine)).toBe(expected);
  });
});
