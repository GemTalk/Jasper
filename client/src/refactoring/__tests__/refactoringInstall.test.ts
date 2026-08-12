import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../browserQueries', () => ({
  executeFetchString: vi.fn(),
  checkRefactoringSupportAvailable: vi.fn(),
}));

vi.mock('../../wslBridge', () => ({
  needsWsl: vi.fn(() => false),
}));

import { ActiveSession } from '../../sessionManager';
import { executeFetchString, checkRefactoringSupportAvailable } from '../../browserQueries';
import { needsWsl } from '../../wslBridge';
import {
  installRefactoringSupport,
  isRefactoringSupportInstalled,
  supportsServerUtf8FileIn,
  REFACTORING_LOADER_FILE,
  REFACTORING_PAYLOAD_FILES,
} from '../refactoringInstall';

const executeFetchStringMock = executeFetchString as ReturnType<typeof vi.fn>;
const checkAvailableMock = checkRefactoringSupportAvailable as ReturnType<typeof vi.fn>;

const PAYLOAD_DIR = '/payload/refactoring';

const OK_REPORT =
  '[GsRefactoring] --- install report ---\n' +
  '[GsRefactoring]   [ ok ] Classes present -- 60 classes\n' +
  '[GsRefactoring] SUCCESS -- all completeness checks passed.\n';

// Default: gem can read everything, the loader file-in succeeds, the loader run
// reports success ("OK" verdict line + a report).
function happyPath(_s: unknown, code: string): string {
  if (code.includes('existsOnServer')) return 'true';
  if (code.includes('loadFromServerDir')) return `OK\n${OK_REPORT}`;
  if (code.includes('GsFileIn')) return 'ok';
  return 'nil';
}

function createMockSession(stoneVersion = '3.7.5'): {
  session: ActiveSession;
  abort: ReturnType<typeof vi.fn>;
} {
  const abort = vi.fn(() => ({ success: true, err: { number: 0 } }));
  const session = {
    id: 1,
    handle: {},
    stoneVersion,
    gci: { GciTsAbort: abort },
  } as unknown as ActiveSession;
  return { session, abort };
}

describe('supportsServerUtf8FileIn', () => {
  it.each(['3.7.0', '3.7.5', '3.7.5 build 64bit', '3.8.0', '4.0'])(
    'uses the UTF-8 file-in signature on %s (3.7 or later)',
    (version) => {
      expect(supportsServerUtf8FileIn(version)).toBe(true);
    },
  );

  it.each(['3.6.2', '3.6.4', '3.6.2 build 64bit'])(
    'falls back to the plain server-path signature on %s (before 3.7)',
    (version) => {
      expect(supportsServerUtf8FileIn(version)).toBe(false);
    },
  );

  it('falls back to the older signature when the version is missing or unparseable', () => {
    expect(supportsServerUtf8FileIn(undefined)).toBe(false);
    expect(supportsServerUtf8FileIn('not-a-version')).toBe(false);
  });
});

describe('installRefactoringSupport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeFetchStringMock.mockImplementation(happyPath);
  });

  it('files in the loader, runs it, and reports success without committing on the client', async () => {
    const { session, abort } = createMockSession();

    const result = await installRefactoringSupport(session, PAYLOAD_DIR);

    expect(result.success).toBe(true);
    expect(result.report).toContain('SUCCESS');
    expect(abort).not.toHaveBeenCalled();
  });

  it('files in the loader before driving it', async () => {
    const { session } = createMockSession();
    const order: string[] = [];
    executeFetchStringMock.mockImplementation((s, code: string) => {
      if (code.includes('GsFileIn')) order.push('file-in');
      if (code.includes('loadFromServerDir')) order.push('run');
      return happyPath(s, code);
    });

    await installRefactoringSupport(session, PAYLOAD_DIR);

    expect(order).toEqual(['file-in', 'run']);
  });

  it('drives the shared server-side loader rather than filing payloads one by one', async () => {
    const { session } = createMockSession();

    await installRefactoringSupport(session, PAYLOAD_DIR);

    const runCalls = executeFetchStringMock.mock.calls.filter((c) =>
      String(c[1]).includes('loadFromServerDir'),
    );
    expect(runCalls).toHaveLength(1);
  });

  it('files in the loader with the UTF-8 signature on a 3.7+ stone', async () => {
    const { session } = createMockSession('3.7.5');

    await installRefactoringSupport(session, PAYLOAD_DIR);

    const fileInCode = String(
      executeFetchStringMock.mock.calls.find((c) => String(c[1]).includes('GsFileIn'))?.[1],
    );
    expect(fileInCode).toContain('on: #serverUtf8File to: nil');
    expect(fileInCode).toContain(REFACTORING_LOADER_FILE);
  });

  it('files in the loader with the plain server-path signature on a pre-3.7 stone', async () => {
    const { session } = createMockSession('3.6.2');

    await installRefactoringSupport(session, PAYLOAD_DIR);

    const fileInCode = String(
      executeFetchStringMock.mock.calls.find((c) => String(c[1]).includes('GsFileIn'))?.[1],
    );
    expect(fileInCode).toContain('fromServerPath:');
    expect(fileInCode).not.toContain('serverUtf8File');
  });

  it('fails clearly without running the loader when the gem cannot read the payload', async () => {
    const { session } = createMockSession();
    executeFetchStringMock.mockImplementation((s, code: string) => {
      if (code.includes('existsOnServer')) return 'false';
      return happyPath(s, code);
    });

    const result = await installRefactoringSupport(session, PAYLOAD_DIR);

    expect(result.success).toBe(false);
    expect(result.message).toContain('cannot read');
    const ranLoader = executeFetchStringMock.mock.calls.some((c) =>
      String(c[1]).includes('loadFromServerDir'),
    );
    expect(ranLoader).toBe(false);
  });

  it('translates a Windows-style payload path to its WSL mount before it reaches the gem', async () => {
    vi.mocked(needsWsl).mockReturnValueOnce(true);
    const { session } = createMockSession();

    await installRefactoringSupport(session, 'D:\\a\\Jasper\\Jasper\\resources\\refactoring');

    const loaderCode = String(
      executeFetchStringMock.mock.calls.find((c) =>
        String(c[1]).includes('loadFromServerDir'),
      )?.[1],
    );
    expect(loaderCode).toContain('/mnt/d/a/Jasper/Jasper/resources/refactoring');
    expect(loaderCode).not.toContain('D:\\');

    const fileInCode = String(
      executeFetchStringMock.mock.calls.find((c) => String(c[1]).includes('GsFileIn'))?.[1],
    );
    expect(fileInCode).toContain(
      '/mnt/d/a/Jasper/Jasper/resources/refactoring/refactoring-loader.gs',
    );
    expect(fileInCode).not.toContain('D:\\');
  });

  it('rolls back and reports failure when the loader file-in raises', async () => {
    const { session, abort } = createMockSession();
    executeFetchStringMock.mockImplementation((s, code: string) => {
      if (code.includes('GsFileIn')) throw new Error('compile failed');
      return happyPath(s, code);
    });

    const result = await installRefactoringSupport(session, PAYLOAD_DIR);

    expect(result.success).toBe(false);
    expect(result.message).toContain('loader');
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('rolls back and reports failure when the loader cannot even run', async () => {
    const { session, abort } = createMockSession();
    executeFetchStringMock.mockImplementation((s, code: string) => {
      if (code.includes('loadFromServerDir')) throw new Error('session dropped');
      return happyPath(s, code);
    });

    const result = await installRefactoringSupport(session, PAYLOAD_DIR);

    expect(result.success).toBe(false);
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('reports an incomplete install and keeps the report when the loader verdict is FAIL', async () => {
    const { session, abort } = createMockSession();
    const failReport =
      '[GsRefactoring]   [FAIL] Classes present -- missing: RBParser\n' +
      '[GsRefactoring] INCOMPLETE -- one or more checks failed (see above).\n';
    executeFetchStringMock.mockImplementation((s, code: string) => {
      if (code.includes('loadFromServerDir')) return `FAIL\n${failReport}`;
      return happyPath(s, code);
    });

    const result = await installRefactoringSupport(session, PAYLOAD_DIR);

    expect(result.success).toBe(false);
    expect(result.report).toContain('INCOMPLETE');
    // The loader aborts its own transaction on failure; the client does not
    // double-abort a run that returned a verdict.
    expect(abort).not.toHaveBeenCalled();
  });

  it('reports incremental progress as it works', async () => {
    const { session } = createMockSession();
    const steps: string[] = [];

    await installRefactoringSupport(session, PAYLOAD_DIR, (message) => steps.push(message));

    expect(steps.some((m) => m.toLowerCase().includes('loader'))).toBe(true);
    expect(steps.some((m) => m.toLowerCase().includes('verifying'))).toBe(true);
  });

  it('checks that the gem can read every payload file, not just the loader', async () => {
    const { session } = createMockSession();
    const checked: string[] = [];
    executeFetchStringMock.mockImplementation((s, code: string) => {
      if (code.includes('existsOnServer')) {
        const f = REFACTORING_PAYLOAD_FILES.find((name) => code.includes(name));
        if (f) checked.push(f);
      }
      return happyPath(s, code);
    });

    await installRefactoringSupport(session, PAYLOAD_DIR);

    expect(new Set(checked)).toEqual(new Set(REFACTORING_PAYLOAD_FILES));
  });
});

describe('isRefactoringSupportInstalled', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delegates to the refactoring-support probe', () => {
    const { session } = createMockSession();
    checkAvailableMock.mockReturnValue(true);

    expect(isRefactoringSupportInstalled(session)).toBe(true);
    expect(checkAvailableMock).toHaveBeenCalledWith(session);
  });

  it('is false when the probe reports the engine is absent', () => {
    const { session } = createMockSession();
    checkAvailableMock.mockReturnValue(false);

    expect(isRefactoringSupportInstalled(session)).toBe(false);
  });
});
