import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
  },
}));

import { ActiveSession } from '../../sessionManager';
import { GemStoneLogin } from '../../loginTypes';
import * as queries from '../../browserQueries';
import { refreshEnhancedInspectorAvailable } from '../enhancedInspectorAvailability';

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

describe('checkEnhancedInspectorAvailable', () => {
  it('returns true when stone returns "true"', async () => {
    const session = createMockSession('true');
    expect(await queries.checkEnhancedInspectorAvailable(session)).toBe(true);
  });

  it('returns true when response has trailing whitespace', async () => {
    const session = createMockSession('true\n');
    expect(await queries.checkEnhancedInspectorAvailable(session)).toBe(true);
  });

  it('returns false when stone returns "false"', async () => {
    const session = createMockSession('false');
    expect(await queries.checkEnhancedInspectorAvailable(session)).toBe(false);
  });

  it('returns false when stone returns an unexpected string', async () => {
    const session = createMockSession('maybe');
    expect(await queries.checkEnhancedInspectorAvailable(session)).toBe(false);
  });

  it('returns false when GCI returns an error', async () => {
    const session = createMockSession('');
    (session.gci.executeAndFetchString as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('GCI error');
    });

    expect(await queries.checkEnhancedInspectorAvailable(session)).toBe(false);
  });

  it('emitted Smalltalk references GtRemotePhlowViewedObject', async () => {
    const session = createMockSession('true');

    await queries.checkEnhancedInspectorAvailable(session);

    const mockExec = session.gci.executeAndFetchString as ReturnType<typeof vi.fn>;
    const code = mockExec.mock.calls[0][1] as string;
    expect(code).toContain('GtRemotePhlowViewedObject');
  });
});

describe('refreshEnhancedInspectorAvailable', () => {
  // The minimum plus future releases — a patch bump and a major bump — all pass
  // the semantic gate with no list to update.
  const SUPPORTED_VERSIONS = ['3.7.5', '3.7.6', '4.0'];

  it.each(SUPPORTED_VERSIONS)(
    'marks support available on a supported %s stone that has the classes',
    async (version) => {
      const session = createMockSession('true', version);

      expect(await refreshEnhancedInspectorAvailable(session)).toBe(true);
      expect(session.enhancedInspectorAvailable).toBe(true);
    },
  );

  // 3.6.2, 3.7.0, and 3.7.2 are all below the 3.7.5 floor.
  const UNSUPPORTED_VERSIONS = ['3.6.2', '3.7.0', '3.7.2'];

  it.each(UNSUPPORTED_VERSIONS)(
    'reports unavailable on a %s stone even when the classes are present',
    async (version) => {
      const session = createMockSession('true', version);

      expect(await refreshEnhancedInspectorAvailable(session)).toBe(false);
      expect(session.enhancedInspectorAvailable).toBe(false);
    },
  );

  it.each(UNSUPPORTED_VERSIONS)('does not probe a %s stone at all', async (version) => {
    const session = createMockSession('true', version);

    await refreshEnhancedInspectorAvailable(session);

    expect(session.gci.executeAndFetchString).not.toHaveBeenCalled();
  });
});
