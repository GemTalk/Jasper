import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { window } from 'vscode';
import { getGciLog, logError, logInfo, _resetGciLogForTests } from '../gciLog';

/** The lines appended to the singleton channel, in order. */
function loggedLines(): string[] {
  const channel = getGciLog();
  return vi.mocked(channel.appendLine).mock.calls.map((c) => c[0]);
}

describe('gciLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetGciLogForTests();
    vi.useFakeTimers();
    // A fixed wall-clock so timestamps are deterministic.
    vi.setSystemTime(new Date(2026, 6, 5, 14, 3, 9, 87));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('names the channel "GemStone GCI"', () => {
    getGciLog();
    expect(window.createOutputChannel).toHaveBeenCalledWith('GemStone GCI');
  });

  it('prefixes each entry with the current wall-clock time', () => {
    logError(1, 'a MessageNotUnderstood occurred');
    expect(loggedLines()[0]).toBe(
      '[14:03:09.087] [Session 1] ERROR: a MessageNotUnderstood occurred',
    );
  });

  it('pads the timestamp components to a stable width', () => {
    vi.setSystemTime(new Date(2026, 0, 1, 9, 5, 3, 7));
    logInfo('boot');
    expect(loggedLines()[0]).toBe('[09:05:03.007] boot');
  });

  it('formats an error line with the session id and message', () => {
    logError(7, 'standalone failure');

    expect(loggedLines()[0]).toBe('[14:03:09.087] [Session 7] ERROR: standalone failure');
  });
});
