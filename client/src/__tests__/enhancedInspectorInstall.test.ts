import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  window: { createOutputChannel: () => ({ appendLine: () => {} }) },
}));

vi.mock('../browserQueries', () => ({
  executeFetchString: vi.fn(),
}));

import { ActiveSession } from '../sessionManager';
import { executeFetchString } from '../browserQueries';
import {
  installEnhancedInspectorSupport,
  isEnhancedInspectorInstalled,
  supportsEnhancedInspector,
  ENHANCED_INSPECTOR_FILES,
  ENHANCED_INSPECTOR_MIN_VERSION,
} from '../enhancedInspectorInstall';

const executeFetchStringMock = executeFetchString as ReturnType<typeof vi.fn>;

const PAYLOAD_DIR = '/payload/enhancedInspector';

// Default: gem can read everything, every file-in succeeds, verification passes.
function happyPath(_s: unknown, code: string): string {
  if (code.includes('existsOnServer')) return 'true';
  if (code.includes('gtViewsInCurrentContext')) return 'true';
  if (code.includes('GsFileIn fromPath')) return 'true';
  return 'nil';
}

function createMockSession() {
  const commit = vi.fn(() => ({ success: true, err: { number: 0 } }));
  const abort = vi.fn(() => ({ success: true, err: { number: 0 } }));
  const session = {
    id: 1,
    handle: {},
    gci: { GciTsCommit: commit, GciTsAbort: abort },
  } as unknown as ActiveSession;
  return { session, commit, abort };
}

function filedInFileFrom(code: string): string | undefined {
  if (!code.includes('GsFileIn fromPath')) return undefined;
  return ENHANCED_INSPECTOR_FILES.find((f) => code.includes(f));
}

describe('supportsEnhancedInspector', () => {
  it('accepts the supported minimum version', () => {
    expect(supportsEnhancedInspector(ENHANCED_INSPECTOR_MIN_VERSION)).toBe(true);
  });

  it.each(['3.6.2', '3.7.0', '3.7.2', '3.7.4', '3.7'])(
    'rejects %s (below the supported minimum)',
    (version) => {
      expect(supportsEnhancedInspector(version)).toBe(false);
    },
  );

  it('accepts later patch releases via semantic comparison', () => {
    expect(supportsEnhancedInspector('3.7.6')).toBe(true);
    expect(supportsEnhancedInspector('3.7.10')).toBe(true);
  });

  it('accepts a later major release', () => {
    expect(supportsEnhancedInspector('4.0.0')).toBe(true);
  });

  it('accepts a short major.minor future version like "4.0"', () => {
    expect(supportsEnhancedInspector('4.0')).toBe(true);
  });

  it('accepts a short future version that carries a build suffix', () => {
    expect(supportsEnhancedInspector('4.0 build 64bit')).toBe(true);
  });

  it('accepts a raw GciTsVersion string with a trailing build suffix', () => {
    expect(supportsEnhancedInspector('3.7.5 build 64bit')).toBe(true);
    expect(supportsEnhancedInspector('3.7.5, gss64')).toBe(true);
  });

  it('honors the gate on a version with a trailing suffix that is below the minimum', () => {
    expect(supportsEnhancedInspector('3.7.2 build 64bit')).toBe(false);
  });

  it('rejects a missing or unparseable version rather than throwing', () => {
    expect(supportsEnhancedInspector(undefined)).toBe(false);
    expect(supportsEnhancedInspector('')).toBe(false);
    expect(supportsEnhancedInspector('not-a-version')).toBe(false);
  });
});

describe('installEnhancedInspectorSupport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeFetchStringMock.mockImplementation(happyPath);
  });

  it('files in every payload file server-side, commits once, and verifies', async () => {
    const { session, commit } = createMockSession();

    const result = await installEnhancedInspectorSupport(session, PAYLOAD_DIR);

    expect(result.success).toBe(true);
    expect(result.committed).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.filedIn).toEqual([...ENHANCED_INSPECTOR_FILES]);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('files the payload in the loader dependency order', async () => {
    const { session } = createMockSession();
    const order: string[] = [];
    executeFetchStringMock.mockImplementation((s, code: string) => {
      const f = filedInFileFrom(code);
      if (f) order.push(f);
      return happyPath(s, code);
    });

    await installEnhancedInspectorSupport(session, PAYLOAD_DIR);

    expect(order).toEqual([...ENHANCED_INSPECTOR_FILES]);
  });

  it('files each file in with a single server-side GsFileIn call', async () => {
    const { session } = createMockSession();

    await installEnhancedInspectorSupport(session, PAYLOAD_DIR);

    const fileInCalls = executeFetchStringMock.mock.calls.filter((c) =>
      String(c[1]).includes('GsFileIn fromPath'),
    );
    expect(fileInCalls).toHaveLength(ENHANCED_INSPECTOR_FILES.length);
  });

  // Regression: the payload contains UTF-8 (GtWireEncodingExamples test data),
  // and a plain #serverText file-in raises error 2710 ("File contains code
  // points > 127, and utf8 not specified") on stones in Unicode comparison
  // mode. Every file-in must use the #serverUtf8File type.
  it('files every file in as #serverUtf8File so UTF-8 payload bytes survive Unicode-mode stones', async () => {
    const { session } = createMockSession();

    await installEnhancedInspectorSupport(session, PAYLOAD_DIR);

    const fileInCalls = executeFetchStringMock.mock.calls
      .map((c) => String(c[1]))
      .filter((code) => code.includes('GsFileIn fromPath'));
    expect(fileInCalls).toHaveLength(ENHANCED_INSPECTOR_FILES.length);
    for (const code of fileInCalls) {
      expect(code).toContain('on: #serverUtf8File to: nil');
    }
  });

  it('fails clearly without committing when the gem cannot read the payload', async () => {
    const { session, commit, abort } = createMockSession();
    executeFetchStringMock.mockImplementation((s, code: string) => {
      if (code.includes('existsOnServer')) return 'false';
      return happyPath(s, code);
    });

    const result = await installEnhancedInspectorSupport(session, PAYLOAD_DIR);

    expect(result.success).toBe(false);
    expect(result.message).toContain('cannot read');
    expect(commit).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
  });

  it('stops at the first failing file, aborts, and commits nothing', async () => {
    const { session, commit, abort } = createMockSession();
    const failing = ENHANCED_INSPECTOR_FILES[1];
    executeFetchStringMock.mockImplementation((s, code: string) => {
      if (code.includes('GsFileIn fromPath') && code.includes(failing)) {
        throw new Error('compile failed');
      }
      return happyPath(s, code);
    });

    const result = await installEnhancedInspectorSupport(session, PAYLOAD_DIR);

    expect(result.success).toBe(false);
    expect(result.failedFile).toBe(failing);
    expect(result.filedIn).toEqual([ENHANCED_INSPECTOR_FILES[0]]);
    expect(commit).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('reports failure and aborts when the commit is refused', async () => {
    const { session, abort } = createMockSession();
    session.gci.GciTsCommit = vi.fn(() => ({
      success: false,
      err: { number: 4007, message: 'commit disallowed' },
    })) as unknown as ActiveSession['gci']['GciTsCommit'];

    const result = await installEnhancedInspectorSupport(session, PAYLOAD_DIR);

    expect(result.success).toBe(false);
    expect(result.committed).toBe(false);
    expect(result.message).toContain('commit disallowed');
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('flags an incomplete install when verification fails after commit', async () => {
    const { session } = createMockSession();
    executeFetchStringMock.mockImplementation((s, code: string) => {
      if (code.includes('gtViewsInCurrentContext')) return 'false';
      return happyPath(s, code);
    });

    const result = await installEnhancedInspectorSupport(session, PAYLOAD_DIR);

    expect(result.committed).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.success).toBe(false);
  });

  it('reports incremental progress as it works', async () => {
    const { session } = createMockSession();
    const steps: string[] = [];

    await installEnhancedInspectorSupport(session, PAYLOAD_DIR, (message) => steps.push(message));

    expect(steps.some((m) => m.includes('Announcements.gs'))).toBe(true);
    expect(steps.some((m) => m.toLowerCase().includes('committing'))).toBe(true);
  });
});

describe('isEnhancedInspectorInstalled', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is true when both the marker class and the Object extension are present', () => {
    const { session } = createMockSession();
    executeFetchStringMock.mockReturnValue('true');

    expect(isEnhancedInspectorInstalled(session)).toBe(true);
  });

  it('is false when the probe reports the support is absent', () => {
    const { session } = createMockSession();
    executeFetchStringMock.mockReturnValue('false');

    expect(isEnhancedInspectorInstalled(session)).toBe(false);
  });

  it('is false when the probe itself raises', () => {
    const { session } = createMockSession();
    executeFetchStringMock.mockImplementation(() => {
      throw new Error('session busy');
    });

    expect(isEnhancedInspectorInstalled(session)).toBe(false);
  });
});
