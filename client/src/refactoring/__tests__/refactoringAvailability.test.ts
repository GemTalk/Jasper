import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
  },
}));

import { ActiveSession } from '../../sessionManager';
import * as queries from '../../browserQueries';
import { refreshRefactoringSupportAvailable } from '../refactoringAvailability';
import { sessionOn } from '../../__tests__/fakeActiveSession';

function createMockGci(executeFetchData = '') {
  return {
    executeAndFetchString: vi.fn((_session: unknown, _code: string) => executeFetchData),
  };
}

function createMockSession(executeFetchData = '', stoneVersion = '3.7.5'): ActiveSession {
  return sessionOn(createMockGci(executeFetchData), { stoneVersion });
}

describe('checkRefactoringSupportAvailable', () => {
  it('reports available when the stone has the refactoring engine', () => {
    const session = createMockSession('true');

    expect(queries.checkRefactoringSupportAvailable(session)).toBe(true);
  });

  it('tolerates trailing whitespace in the reply', () => {
    const session = createMockSession('true\n');

    expect(queries.checkRefactoringSupportAvailable(session)).toBe(true);
  });

  it('reports unavailable when the engine is absent', () => {
    const session = createMockSession('false');

    expect(queries.checkRefactoringSupportAvailable(session)).toBe(false);
  });

  it('reports unavailable when GCI errors', () => {
    const gci = createMockGci('');
    const session = sessionOn(gci);
    gci.executeAndFetchString.mockImplementation(() => {
      throw new Error('GCI error');
    });

    expect(queries.checkRefactoringSupportAvailable(session)).toBe(false);
  });

  it('probes for the rename-instance-variable refactoring class', () => {
    const gci = createMockGci('true');
    const session = sessionOn(gci);

    queries.checkRefactoringSupportAvailable(session);

    const code = gci.executeAndFetchString.mock.calls[0][1];
    expect(code).toContain('GsRenameInstanceVariableRefactoring');
  });
});

describe('refreshRefactoringSupportAvailable', () => {
  it('latches the probe result on the session', () => {
    const session = createMockSession('true');

    expect(refreshRefactoringSupportAvailable(session)).toBe(true);
    expect(session.rbSupportAvailable).toBe(true);
  });

  // Not version-gated: the engine is meant to load on every supported stone, so
  // an old stone that has the engine still reports available (contrast the
  // version-gated Enhanced Inspector).
  it('is not version-gated — an older stone with the engine still counts', () => {
    const session = createMockSession('true', '3.6.2');

    expect(refreshRefactoringSupportAvailable(session)).toBe(true);
    expect(session.rbSupportAvailable).toBe(true);
  });

  it('latches false when the engine is absent', () => {
    const session = createMockSession('false');

    expect(refreshRefactoringSupportAvailable(session)).toBe(false);
    expect(session.rbSupportAvailable).toBe(false);
  });
});
