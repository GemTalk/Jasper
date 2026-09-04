import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  window: { createOutputChannel: () => ({ appendLine: () => {} }) },
}));

vi.mock('../../browserQueries', () => ({
  executeFetchString: vi.fn(),
}));

vi.mock('../../wslBridge', () => ({
  needsWsl: vi.fn(() => false),
}));

import { ActiveSession } from '../../sessionManager';
import { executeFetchString } from '../../browserQueries';
import { needsWsl } from '../../wslBridge';
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

// Both dictionary snippets name GsEnhancedInspector, so they are told apart by WHERE each puts it:
// prepare pins it at the front for the file-in, settle returns it to the end afterwards.
const isPrepare = (code: string): boolean => code.includes('insertDictionary: dict at: 1');
const isSettle = (code: string): boolean =>
  code.includes('insertDictionary: dict at: prof symbolList size + 1');

function codeOfCallMatching(predicate: (code: string) => boolean): string {
  return String(executeFetchStringMock.mock.calls.find((c) => predicate(String(c[1])))?.[1]);
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

  it('creates and shares the dedicated GsEnhancedInspector dictionary before filing in any payload', async () => {
    const { session } = createMockSession();
    const events: string[] = [];
    executeFetchStringMock.mockImplementation((s, code: string) => {
      if (isPrepare(code)) events.push('prepare');
      if (code.includes('GsFileIn fromPath')) events.push('file-in');
      return happyPath(s, code);
    });

    await installEnhancedInspectorSupport(session, PAYLOAD_DIR);

    expect(events[0]).toBe('prepare');
    expect(events.filter((e) => e === 'prepare')).toHaveLength(1);
    expect(events).toContain('file-in');
  });

  // Regression (Rowan extent): the payload declares ~520 classes, dozens of which a Rowan-enabled
  // extent already defines. From the END of the symbol list every bareword in the payload binds to
  // the stone's class instead of the payload's, and the file-in fails after stripping methods off
  // classes the user depends on. The dictionary has to be FIRST while the payload files in, and a
  // re-install has to detach the existing copy rather than leave it where it was. `UserProfile`
  // has no `removeDictionary:` — only the index form — so detaching by object would raise a
  // doesNotUnderstand on the second install of any stone.
  it('puts the dictionary first in the symbol list before filing in', async () => {
    const { session } = createMockSession();

    await installEnhancedInspectorSupport(session, PAYLOAD_DIR);

    const prepareCode = codeOfCallMatching(isPrepare);
    expect(prepareCode).toContain('insertDictionary: dict at: 1');
    expect(prepareCode).toContain('removeDictionaryAt:');
    expect(prepareCode).not.toContain('prof removeDictionary:');
  });

  // Front placement is a file-in-time arrangement only. Left there it is committed to SystemUser's
  // profile, where all ~520 payload names shadow the real ones in every later SystemUser session.
  it('returns the dictionary to the end of the symbol list once the payload is in', async () => {
    const { session } = createMockSession();
    const events: string[] = [];
    executeFetchStringMock.mockImplementation((s, code: string) => {
      if (isSettle(code)) events.push('settle');
      if (code.includes('GsFileIn fromPath')) events.push('file-in');
      return happyPath(s, code);
    });

    const result = await installEnhancedInspectorSupport(session, PAYLOAD_DIR);

    expect(result.success).toBe(true);
    expect(events.filter((e) => e === 'settle')).toHaveLength(1);
    expect(events[events.length - 1]).toBe('settle');
  });

  it('aborts without committing when the dictionary cannot be settled', async () => {
    const { session, commit, abort } = createMockSession();
    executeFetchStringMock.mockImplementation((s, code: string) => {
      if (isSettle(code)) throw new Error('symbol list is read-only');
      return happyPath(s, code);
    });

    const result = await installEnhancedInspectorSupport(session, PAYLOAD_DIR);

    expect(result.success).toBe(false);
    expect(result.message).toContain('symbol list is read-only');
    expect(commit).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('migrates a legacy Published-placed install by sweeping its GToolkit classes while preparing', async () => {
    const { session } = createMockSession();

    await installEnhancedInspectorSupport(session, PAYLOAD_DIR);

    const prepareCode = codeOfCallMatching(isPrepare);
    // Assert the SHAPE of the migration, not its exact wording: it looks at Published, it is
    // GATED on a legacy marker actually being bound there (so a stone that never carried the old
    // placement is never swept), and it removes rather than merely reads.
    expect(prepareCode).toContain('#Published');
    expect(prepareCode).toContain('includesKey: #GtRemotePhlowViewedObject');
    expect(prepareCode).toMatch(/beginsWith: 'GToolkit/);
    expect(prepareCode).toContain('removeKey:');
  });

  // The gate is the point of the change: the sweep must be reachable ONLY behind the
  // legacy-marker check, never as an unconditional statement.
  it('runs the Published sweep only when a legacy install is detected', async () => {
    const { session } = createMockSession();

    await installEnhancedInspectorSupport(session, PAYLOAD_DIR);

    const prepareCode = codeOfCallMatching(isPrepare);
    const gateAt = prepareCode.indexOf('includesKey: #GtRemotePhlowViewedObject');
    const sweepAt = prepareCode.indexOf('removeKey:');
    expect(gateAt).toBeGreaterThan(-1);
    expect(sweepAt).toBeGreaterThan(gateAt);
  });

  it('aborts without committing when the dictionary cannot be prepared', async () => {
    const { session, commit, abort } = createMockSession();
    executeFetchStringMock.mockImplementation((s, code: string) => {
      if (isPrepare(code)) throw new Error('insertDictionary failed');
      return happyPath(s, code);
    });

    const result = await installEnhancedInspectorSupport(session, PAYLOAD_DIR);

    expect(result.success).toBe(false);
    expect(result.message).toContain('GsEnhancedInspector');
    expect(commit).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('translates a Windows-style payload path to its WSL mount before it reaches the gem', async () => {
    vi.mocked(needsWsl).mockReturnValueOnce(true);
    const { session } = createMockSession();

    await installEnhancedInspectorSupport(
      session,
      'D:\\a\\Jasper\\Jasper\\resources\\enhancedInspector',
    );

    const fileInCode = String(
      executeFetchStringMock.mock.calls.find((c) =>
        String(c[1]).includes('GsFileIn fromPath'),
      )?.[1],
    );
    expect(fileInCode).toContain('/mnt/d/a/Jasper/Jasper/resources/enhancedInspector');
    expect(fileInCode).not.toContain('D:\\');
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
