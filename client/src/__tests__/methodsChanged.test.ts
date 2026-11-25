import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { announceMethodsChanged, onDidChangeMethods } from '../methodsChanged';

describe('the announcement that methods changed on the stone', () => {
  it('is safe to make before anyone listens', () => {
    expect(() => announceMethodsChanged()).not.toThrow();
  });

  it('reaches every listener, once per announcement', () => {
    const first = vi.fn();
    const second = vi.fn();
    const subscriptions = [onDidChangeMethods(first), onDidChangeMethods(second)];

    announceMethodsChanged();
    announceMethodsChanged();
    subscriptions.forEach((s) => s.dispose());

    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('no longer reaches a listener that stopped listening', () => {
    const listener = vi.fn();
    onDidChangeMethods(listener).dispose();

    announceMethodsChanged();

    expect(listener).not.toHaveBeenCalled();
  });
});
