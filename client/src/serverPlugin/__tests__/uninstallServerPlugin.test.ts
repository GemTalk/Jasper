import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

// The orchestration is registry-driven, so the registry is the seam: stub it with two
// fake features and assert on how they are driven. Keeping the real registry out also
// means this test does not drift when a feature is added.
// vi.mock is hoisted above module-level consts, so the fakes have to be created inside
// vi.hoisted() for the factory below to see them.
const { refactoring, inspector } = vi.hoisted(() => {
  const make = (id: string, label: string, payloadSubdir: string) => ({
    id,
    label,
    payloadSubdir,
    isApplicable: () => true,
    probe: vi.fn(() => false),
    install: vi.fn(),
    uninstall: vi.fn(async () => ({ success: true, message: 'ok' })),
  });
  return {
    refactoring: make('refactoring', 'Refactoring engine', 'resources/refactoring'),
    inspector: make('enhancedInspector', 'Enhanced Inspector', 'resources/enhancedInspector'),
  };
});

vi.mock('../pluginFeatures', () => ({
  // File-in (dependency) order, the same convention the real registry uses.
  PLUGIN_FEATURES: [refactoring, inspector],
}));

import { uninstallServerPlugin } from '../uninstallServerPlugin';
import type { ActiveSession } from '../../sessionManager';

const session = { id: 1 } as ActiveSession;

/** Make each feature's probe answer `before` on the first call (the presence check) and
 *  `after` on the second (the post-uninstall verification). */
function probes(before: boolean, after: boolean): void {
  for (const f of [refactoring, inspector]) {
    f.probe.mockReset();
    f.probe.mockImplementationOnce(() => before).mockImplementation(() => after);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const f of [refactoring, inspector]) {
    f.probe.mockReset();
    f.probe.mockImplementation(() => false);
    f.uninstall.mockReset();
    f.uninstall.mockImplementation(async () => ({ success: true, message: 'ok' }));
  }
});

describe('uninstallServerPlugin', () => {
  it('removes every installed feature and verifies the stone is clean', async () => {
    probes(true, false);

    await expect(uninstallServerPlugin(session)).resolves.toBeUndefined();

    expect(refactoring.uninstall).toHaveBeenCalledTimes(1);
    expect(inspector.uninstall).toHaveBeenCalledTimes(1);
  });

  // The registry is in file-in (dependency) order, so unwinding must run back-to-front.
  it('removes features in reverse registry order', async () => {
    probes(true, false);
    const order: string[] = [];
    refactoring.uninstall.mockImplementation(async () => {
      order.push('refactoring');
      return { success: true, message: 'ok' };
    });
    inspector.uninstall.mockImplementation(async () => {
      order.push('inspector');
      return { success: true, message: 'ok' };
    });

    await uninstallServerPlugin(session);

    expect(order).toEqual(['inspector', 'refactoring']);
  });

  // Idempotence: a second run, or a partly-provisioned stone, must succeed rather than fail.
  it('skips a feature that is not installed', async () => {
    for (const f of [refactoring, inspector]) f.probe.mockImplementation(() => false);
    const messages: string[] = [];

    await uninstallServerPlugin(session, (m) => messages.push(m));

    expect(refactoring.uninstall).not.toHaveBeenCalled();
    expect(inspector.uninstall).not.toHaveBeenCalled();
    expect(messages.join('\n')).toMatch(/not installed/);
  });

  it('throws when a feature reports a failed removal', async () => {
    probes(true, false);
    inspector.uninstall.mockImplementation(async () => ({
      success: false,
      message: 'permission denied',
    }));

    await expect(uninstallServerPlugin(session)).rejects.toThrow(
      /Enhanced Inspector.*permission denied/,
    );
    // Stops at the failure — the earlier-in-dependency-order feature is left alone.
    expect(refactoring.uninstall).not.toHaveBeenCalled();
  });

  // The loud-failure guard: a removal that claims success but leaves the feature detectable
  // (did not take, or did not commit) must fail here rather than downstream.
  it('throws when a feature is still detected after a "successful" removal', async () => {
    for (const f of [refactoring, inspector]) f.probe.mockImplementation(() => true);

    await expect(uninstallServerPlugin(session)).rejects.toThrow(/Still installed after uninstall/);
  });

  it('reports progress for each feature it removes', async () => {
    probes(true, false);
    const messages: string[] = [];

    await uninstallServerPlugin(session, (m) => messages.push(m));

    expect(messages.join('\n')).toMatch(/Uninstalling Enhanced Inspector/);
    expect(messages.join('\n')).toMatch(/Uninstalling Refactoring engine/);
  });
});
