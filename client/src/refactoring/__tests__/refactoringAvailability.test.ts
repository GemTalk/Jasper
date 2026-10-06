import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
  },
}));

import { ActiveSession } from '../../sessionManager';
import { GemStoneLogin } from '../../loginTypes';
import * as queries from '../../browserQueries';
import { refreshRefactoringSupportAvailable } from '../refactoringAvailability';

function createMockSession(executeFetchData = '', stoneVersion = '3.7.5'): ActiveSession {
  const mockGci = {
    executeAndFetchString: vi.fn(() => executeFetchData),
    GciTsCallInProgress: vi.fn(() => ({ result: 0 })),
  };

  return {
    id: 1,
    gci: mockGci as unknown as ActiveSession['gci'],
    handle: {},
    login: { label: 'Test' } as GemStoneLogin,
    stoneVersion,
  };
}

describe('checkRefactoringSupportAvailable', () => {
  it('reports available when the stone has the refactoring engine', async () => {
    const session = createMockSession('true');

    expect(await queries.checkRefactoringSupportAvailable(session)).toBe(true);
  });

  it('tolerates trailing whitespace in the reply', async () => {
    const session = createMockSession('true\n');

    expect(await queries.checkRefactoringSupportAvailable(session)).toBe(true);
  });

  it('reports unavailable when the engine is absent', async () => {
    const session = createMockSession('false');

    expect(await queries.checkRefactoringSupportAvailable(session)).toBe(false);
  });

  it('reports unavailable when GCI errors', async () => {
    const session = createMockSession('');
    (session.gci.executeAndFetchString as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('GCI error');
    });

    expect(await queries.checkRefactoringSupportAvailable(session)).toBe(false);
  });

  it('probes for the rename-instance-variable refactoring class', async () => {
    const session = createMockSession('true');

    await queries.checkRefactoringSupportAvailable(session);

    const code = (session.gci.executeAndFetchString as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as string;
    expect(code).toContain('GsRenameInstanceVariableRefactoring');
  });
});

describe('refreshRefactoringSupportAvailable', () => {
  it('latches the probe result on the session', async () => {
    const session = createMockSession('true');

    expect(await refreshRefactoringSupportAvailable(session)).toBe(true);
    expect(session.rbSupportAvailable).toBe(true);
  });

  // Not version-gated: the engine is meant to load on every supported stone, so
  // an old stone that has the engine still reports available (contrast the
  // version-gated Enhanced Inspector).
  it('is not version-gated — an older stone with the engine still counts', async () => {
    const session = createMockSession('true', '3.6.2');

    expect(await refreshRefactoringSupportAvailable(session)).toBe(true);
    expect(session.rbSupportAvailable).toBe(true);
  });

  it('latches false when the engine is absent', async () => {
    const session = createMockSession('false');

    expect(await refreshRefactoringSupportAvailable(session)).toBe(false);
    expect(session.rbSupportAvailable).toBe(false);
  });
});
