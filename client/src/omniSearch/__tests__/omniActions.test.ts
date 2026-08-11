import { describe, it, expect, vi } from 'vitest';
import { runOmniAction, OmniActionHandlers } from '../omniActions';
import { OmniAction } from '../omniTypes';

function handlers(): OmniActionHandlers & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {};
  return {
    calls,
    openClass: vi.fn((a) => void (calls.openClass = [a])),
    openMethod: vi.fn((a) => void (calls.openMethod = [a])),
    revealDictionary: vi.fn((a) => void (calls.revealDictionary = [a])),
  };
}

describe('runOmniAction', () => {
  it('routes each action kind to its handler with the action', async () => {
    const cases: OmniAction[] = [
      { kind: 'openClass', sessionId: 1, dictName: 'Globals', className: 'Object', dictIndex: 1 },
      {
        kind: 'openMethod',
        sessionId: 1,
        dictName: 'Globals',
        className: 'Array',
        isMeta: false,
        category: 'accessing',
        selector: 'size',
        environmentId: 0,
        dictIndex: 0,
      },
      { kind: 'revealDictionary', sessionId: 1, dictName: 'Published' },
    ];
    for (const action of cases) {
      const h = handlers();
      await runOmniAction(action, h);
      expect(h.calls[action.kind]).toEqual([action]);
    }
  });

  it('awaits an async handler', async () => {
    let done = false;
    const h = handlers();
    h.openClass = vi.fn(async () => {
      await Promise.resolve();
      done = true;
    });
    await runOmniAction(
      { kind: 'openClass', sessionId: 1, dictName: 'G', className: 'C', dictIndex: 1 },
      h,
    );
    expect(done).toBe(true);
  });
});
