import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
  },
}));

import { ActiveSession } from '../../sessionManager';
import * as queries from '../../browserQueries';
import { refreshRegexSupportAvailable } from '../regexAvailability';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';
import { sessionOn } from '../../__tests__/fakeActiveSession';

function createMockGci(executeFetchData = '') {
  return {
    executeAndFetchString: vi.fn((_session: unknown, _code: string) => executeFetchData),
  };
}

function createMockSession(executeFetchData = '', stoneVersion = '3.7.5'): ActiveSession {
  return sessionOn(createMockGci(executeFetchData), { stoneVersion });
}

describe('checkRegexSupportAvailable', () => {
  it('returns true when the stone answers "true"', () => {
    expect(queries.checkRegexSupportAvailable(createMockSession('true'))).toBe(true);
  });

  it('returns true when the answer has trailing whitespace', () => {
    expect(queries.checkRegexSupportAvailable(createMockSession('true\n'))).toBe(true);
  });

  it('returns false when the stone answers "false"', () => {
    expect(queries.checkRegexSupportAvailable(createMockSession('false'))).toBe(false);
  });

  it('returns false for an unexpected answer', () => {
    expect(queries.checkRegexSupportAvailable(createMockSession('maybe'))).toBe(false);
  });

  it('returns false, rather than throwing, when the GCI call fails', () => {
    const gci = createMockGci('');
    gci.executeAndFetchString.mockImplementation(() => {
      throw new Error('GCI error');
    });

    expect(queries.checkRegexSupportAvailable(sessionOn(gci))).toBe(false);
  });

  // By String, not #symbol: a symbol literal is created when the probe compiles, which
  // fails on a stone whose symbol gem is down (see checkRefactoringSupportAvailable).
  it('looks the search class up by String name', () => {
    const gci = createMockGci('true');

    queries.checkRegexSupportAvailable(sessionOn(gci));

    const code = gci.executeAndFetchString.mock.calls[0][1];
    expect(code).toContain("objectNamed: 'GsRegexSourceSearch'");
    expect(code).not.toContain('#GsRegexSourceSearch');
  });
});

describe('refreshRegexSupportAvailable', () => {
  // Not version-gated: the support loads on every supported release.
  it.each(['3.6.2', '3.7.0', '3.7.5', '3.7.6', '4.0'])(
    'latches true on a %s stone that has the classes',
    (version) => {
      const session = createMockSession('true', version);

      expect(refreshRegexSupportAvailable(session)).toBe(true);
      expect(session.regexSupportAvailable).toBe(true);
    },
  );

  it('latches false when the classes are absent', () => {
    const session = createMockSession('false');
    session.regexSupportAvailable = true;

    expect(refreshRegexSupportAvailable(session)).toBe(false);
    expect(session.regexSupportAvailable).toBe(false);
  });
});

describe('pluginFeatures.regex', () => {
  it.each(['3.6.2', '3.7.0', '3.7.6', undefined])('applies to every release (%s)', (version) => {
    expect(pluginFeatures.regex.isApplicable(version)).toBe(true);
  });

  it('ships its payload from resources/regex and keeps its own receipt keys', () => {
    expect(pluginFeatures.regex.payloadSubdir.split(/[\\/]/)).toEqual(['resources', 'regex']);
    expect(pluginFeatures.regex.receipt).toMatchObject({
      digestKey: 'GsRegexDigest',
      installedByKey: 'GsRegexInstalledBy',
    });
  });

  it('fingerprints every file the loader reads, loader first', () => {
    expect(pluginFeatures.regex.receipt.files).toEqual([
      'regex-loader.gs',
      'regex-core.gs',
      'engine.gs',
      'manifest.gs',
    ]);
  });
});
