import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../browserQueries', () => ({
  executeFetchString: vi.fn(),
  checkRegexSupportAvailable: vi.fn(),
}));

import { executeFetchString, checkRegexSupportAvailable } from '../../browserQueries';
import { uninstallRegexSupport } from '../regexUninstall';
import { fakeActiveSession } from '../../__tests__/fakeActiveSession';

const executeFetchStringMock = executeFetchString as ReturnType<typeof vi.fn>;
const checkAvailableMock = checkRegexSupportAvailable as ReturnType<typeof vi.fn>;

function createMockSession() {
  const commit = vi.fn(() => ({ success: true, err: { number: 0, message: '' } }));
  const abort = vi.fn(() => ({ success: true, err: { number: 0 } }));
  const session = fakeActiveSession({
    id: 1,
    handle: {},
    gci: { GciTsCommit: commit, GciTsAbort: abort },
  });
  return { session, commit, abort };
}

describe('uninstallRegexSupport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeFetchStringMock.mockReturnValue('ok');
    // After a successful removal + commit the support is gone.
    checkAvailableMock.mockReturnValue(false);
  });

  it('removes regex support, commits, and reports verified success', async () => {
    const { session, commit, abort } = createMockSession();

    const result = await uninstallRegexSupport(session);

    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(abort).not.toHaveBeenCalled();
  });

  // Mirrors the collapse in enhancedInspectorUninstall.test.ts: one check that the removal RUNS
  // and names the right dictionary, instead of three that pin the snippet's wording (`AllUsers`,
  // `removeDictionaryAt:`, `dict keys asArray do:`, `*ast-core-compat`). Text assertions pass on a
  // semantically wrong snippet and fail on a safe rewrite. Correctness is carried by
  // regexUninstall.integration.test.ts against a real stone; the rest of this file asserts
  // real behaviour (commit/abort/verify).
  it('runs a removal against the stone naming the shared dictionary', async () => {
    const { session } = createMockSession();

    await uninstallRegexSupport(session);

    expect(executeFetchStringMock).toHaveBeenCalledTimes(1);
    expect(String(executeFetchStringMock.mock.calls[0][1])).toContain('#GsRegexLibrary');
  });

  it('rolls back and reports failure when the removal snippet raises', async () => {
    const { session, commit, abort } = createMockSession();
    executeFetchStringMock.mockImplementation(() => {
      throw new Error('permission denied');
    });

    const result = await uninstallRegexSupport(session);

    expect(result.success).toBe(false);
    expect(result.message).toContain('permission denied');
    expect(commit).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('rolls back and reports failure when the commit fails', async () => {
    const { session, commit, abort } = createMockSession();
    commit.mockReturnValue({
      success: false,
      err: { number: 4001, message: 'commit refused' },
    });

    const result = await uninstallRegexSupport(session);

    expect(result.success).toBe(false);
    expect(result.message).toContain('commit refused');
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('reports an incomplete uninstall when regex support is still detected after commit', async () => {
    const { session } = createMockSession();
    checkAvailableMock.mockReturnValue(true);

    const result = await uninstallRegexSupport(session);

    expect(result.success).toBe(false);
    expect(result.committed).toBe(true);
    expect(result.message).toContain('still detected');
  });

  it('reports incremental progress as it works', async () => {
    const { session } = createMockSession();
    const steps: string[] = [];

    await uninstallRegexSupport(session, (message) => steps.push(message));

    expect(steps.some((m) => m.toLowerCase().includes('removing'))).toBe(true);
    expect(steps.some((m) => m.toLowerCase().includes('verifying'))).toBe(true);
  });
});
