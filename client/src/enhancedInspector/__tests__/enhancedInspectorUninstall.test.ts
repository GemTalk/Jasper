import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../browserQueries', () => ({
  executeFetchString: vi.fn(),
}));

import { ActiveSession } from '../../sessionManager';
import { executeFetchString } from '../../browserQueries';
import { uninstallEnhancedInspectorSupport } from '../enhancedInspectorUninstall';
import { ENHANCED_INSPECTOR_CATEGORY_PREFIX } from '../enhancedInspectorInstall';

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

  // One check that the removal RUNS, rather than three that pin the snippet's wording.
  //
  // These used to assert on the text of REMOVAL_SNIPPET (`AllUsers`, `removeDictionaryAt:`,
  // `dict keys asArray do:`, the category prefixes). That passes even when the snippet is
  // semantically wrong, and fails on a harmless rewrite — renaming `dict` to `d`, or splitting
  // the Published sweep into its own statement. Correctness of the removal is carried by
  // enhancedInspectorUninstall.integration.test.ts, which runs it against a real stone and
  // asserts the dictionary is gone and the availability probe flips; the remaining tests in this
  // file assert real behaviour (commit/abort/verify/progress).
  it('runs a removal against the stone naming the dedicated dictionary', async () => {
    const { session } = createMockSession();

    await uninstallEnhancedInspectorSupport(session);

    const removalCalls = executeFetchStringMock.mock.calls.filter((c) =>
      String(c[1]).includes('GsEnhancedInspector'),
    );
    expect(removalCalls).toHaveLength(1);
  });

  // Extension methods on kernel classes cannot be dropped with the dictionary, so the sweep finds
  // them by category. The payload's carry the `GsEnhancedInspector-` prefix, but a stone installed
  // by an earlier build still carries `*GToolkit`; missing either leaves kernel methods behind.
  it('sweeps extension methods by both the current and the legacy category prefix', async () => {
    const { session } = createMockSession();

    await uninstallEnhancedInspectorSupport(session);

    const removal = String(
      executeFetchStringMock.mock.calls.find((c) =>
        String(c[1]).includes('categoryOfSelector:'),
      )?.[1],
    );
    expect(removal).toContain(`beginsWith: '${ENHANCED_INSPECTOR_CATEGORY_PREFIX}'`);
    expect(removal).toContain("beginsWith: '*GToolkit'");
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
