import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../browserQueries', () => ({
  executeFetchString: vi.fn(),
}));

import { ActiveSession } from '../../sessionManager';
import { executeFetchString } from '../../browserQueries';
import { uninstallEnhancedInspectorSupport } from '../enhancedInspectorUninstall';

const executeFetchStringMock = executeFetchString as ReturnType<typeof vi.fn>;

// The removal snippet returns 'ok'; the post-commit verification probe (which
// checks for the Object>>gtViewsInCurrentContext dispatch) reports the support
// is gone.
function happyPath(_s: unknown, code: string): string {
  if (code.includes('gtViewsInCurrentContext')) return 'false';
  return 'ok';
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

describe('uninstallEnhancedInspectorSupport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeFetchStringMock.mockImplementation(happyPath);
  });

  it('removes the support, commits, and reports verified success', async () => {
    const { session, commit, abort } = createMockSession();

    const result = await uninstallEnhancedInspectorSupport(session);

    expect(result.success).toBe(true);
    expect(result.verified).toBe(true);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(abort).not.toHaveBeenCalled();
  });

  it('drops the dedicated GsEnhancedInspector dictionary from every user and removes GToolkit extension methods', async () => {
    const { session } = createMockSession();

    await uninstallEnhancedInspectorSupport(session);

    const removalCode = String(
      executeFetchStringMock.mock.calls.find((c) =>
        String(c[1]).includes('GsEnhancedInspector'),
      )?.[1],
    );
    expect(removalCode).toContain('#GsEnhancedInspector');
    expect(removalCode).toContain('AllUsers');
    expect(removalCode).toContain('removeDictionaryAt:');
    expect(removalCode).toContain("beginsWith: '*GToolkit'");
    expect(removalCode).toContain('removeSelector:');
  });

  it('empties the dictionary object itself, not just detaching it from symbol lists', async () => {
    const { session } = createMockSession();

    await uninstallEnhancedInspectorSupport(session);

    const removalCode = String(
      executeFetchStringMock.mock.calls.find((c) =>
        String(c[1]).includes('GsEnhancedInspector'),
      )?.[1],
    );
    expect(removalCode).toContain('dict keys asArray do:');
    expect(removalCode).toContain('dict removeKey: k');
  });

  it('also sweeps any legacy GToolkit classes left in the shared Published dictionary', async () => {
    const { session } = createMockSession();

    await uninstallEnhancedInspectorSupport(session);

    const removalCode = String(
      executeFetchStringMock.mock.calls.find((c) =>
        String(c[1]).includes('GsEnhancedInspector'),
      )?.[1],
    );
    expect(removalCode).toContain('#Published');
    expect(removalCode).toContain("beginsWith: 'GToolkit'");
    expect(removalCode).toContain('removeKey:');
  });

  it('rolls back and reports failure when the removal snippet raises', async () => {
    const { session, commit, abort } = createMockSession();
    executeFetchStringMock.mockImplementation(() => {
      throw new Error('permission denied');
    });

    const result = await uninstallEnhancedInspectorSupport(session);

    expect(result.success).toBe(false);
    expect(result.message).toContain('permission denied');
    expect(commit).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('rolls back and reports failure when the commit fails', async () => {
    const { session, abort } = createMockSession();
    session.gci.GciTsCommit = vi.fn(() => ({
      success: false,
      err: { number: 4001, message: 'commit refused' },
    })) as unknown as typeof session.gci.GciTsCommit;

    const result = await uninstallEnhancedInspectorSupport(session);

    expect(result.success).toBe(false);
    expect(result.message).toContain('commit refused');
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it('reports an incomplete uninstall when the support is still detected after commit', async () => {
    const { session } = createMockSession();
    executeFetchStringMock.mockImplementation((_s, code: string) =>
      code.includes('gtViewsInCurrentContext') ? 'true' : 'ok',
    );

    const result = await uninstallEnhancedInspectorSupport(session);

    expect(result.success).toBe(false);
    expect(result.committed).toBe(true);
    expect(result.message).toContain('still detected');
  });

  it('reports incremental progress as it works', async () => {
    const { session } = createMockSession();
    const steps: string[] = [];

    await uninstallEnhancedInspectorSupport(session, (message) => steps.push(message));

    expect(steps.some((m) => m.toLowerCase().includes('removing'))).toBe(true);
    expect(steps.some((m) => m.toLowerCase().includes('verifying'))).toBe(true);
  });
});
