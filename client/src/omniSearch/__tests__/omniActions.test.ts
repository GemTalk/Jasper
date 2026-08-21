import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { commands } from '../../__mocks__/vscode';
import { runOmniAction, OmniActionHandlers, revealTestForResult } from '../omniActions';
import { OmniAction, OmniResult } from '../omniTypes';

function handlers(): OmniActionHandlers & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {};
  return {
    calls,
    openClass: vi.fn((a) => void (calls.openClass = [a])),
    openMethod: vi.fn((a) => void (calls.openMethod = [a])),
    revealDictionary: vi.fn((a) => void (calls.revealDictionary = [a])),
    revealGlobal: vi.fn((a) => void (calls.revealGlobal = [a])),
    revealCategory: vi.fn((a) => void (calls.revealCategory = [a])),
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
      {
        kind: 'revealGlobal',
        sessionId: 1,
        dictName: 'Globals',
        name: 'Transcript',
        className: 'GsTerminalStream',
      },
      {
        kind: 'revealCategory',
        sessionId: 1,
        dictName: 'Globals',
        dictIndex: 1,
        category: 'Kernel',
      },
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

describe('revealTestForResult', () => {
  function result(action: OmniAction): OmniResult {
    return { categoryId: 'classes', label: 'x', score: 1, ranges: [], action };
  }

  it('reveals a class result by its dictionary and class', async () => {
    await revealTestForResult(
      result({
        kind: 'openClass',
        sessionId: 1,
        dictName: 'Published',
        className: 'RsrStressTest',
        dictIndex: 2,
      }),
    );

    expect(commands.executeCommand).toHaveBeenCalledWith(
      'gemstone.revealTestInTestingView',
      'Published',
      'RsrStressTest',
    );
  });

  it('reveals a method result down to its selector', async () => {
    await revealTestForResult(
      result({
        kind: 'openMethod',
        sessionId: 1,
        dictName: 'Published',
        className: 'RsrStressTest',
        isMeta: false,
        category: 'tests',
        selector: 'test1KBytes',
        environmentId: 0,
        dictIndex: 2,
      }),
    );

    expect(commands.executeCommand).toHaveBeenCalledWith(
      'gemstone.revealTestInTestingView',
      'Published',
      'RsrStressTest',
      'test1KBytes',
    );
  });

  it('does nothing for a result that is neither a class nor a method', async () => {
    vi.mocked(commands.executeCommand).mockClear();

    await revealTestForResult(
      result({ kind: 'revealDictionary', sessionId: 1, dictName: 'Published' }),
    );

    expect(commands.executeCommand).not.toHaveBeenCalled();
  });
});
