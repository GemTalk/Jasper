import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../sysadminChannel', () => ({ appendSysadmin: vi.fn(), showSysadmin: vi.fn() }));
vi.mock('../wslBridge', () => ({
  isWindows: () => false,
  needsWsl: () => false,
  getWslInfo: () => ({ available: false }),
  wslPathToWindows: (p: string) => p,
  windowsPathToWsl: (p: string) => p,
  wslExecSync: vi.fn(),
}));

import * as vscode from 'vscode';
import { VersionTreeProvider } from '../versionTreeProvider';
import type { VersionManager } from '../versionManager';

/** Let the fire-and-forget loadVersions() promise settle. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function makeProvider(fetch: () => Promise<unknown>) {
  const manager = { fetchAvailableVersions: vi.fn(fetch) };
  const provider = new VersionTreeProvider(manager as unknown as VersionManager);
  return { provider, manager };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VersionTreeProvider initial load', () => {
  it('triggers loadVersions only once even if rendered repeatedly before it resolves', async () => {
    const { provider, manager } = makeProvider(() => Promise.resolve([]));
    provider.getChildren();
    provider.getChildren(); // a second render while still loading must not re-trigger
    await tick();
    expect(manager.fetchAvailableVersions).toHaveBeenCalledTimes(1);
  });

  it('does not re-trigger after a successful but empty result', async () => {
    const { provider, manager } = makeProvider(() => Promise.resolve([]));
    provider.getChildren();
    await tick();
    provider.getChildren();
    await tick();
    expect(manager.fetchAvailableVersions).toHaveBeenCalledTimes(1);
  });
});

describe('VersionTreeProvider failure handling (no error-dialog loop)', () => {
  it('shows the error once and does not re-fetch on subsequent renders', async () => {
    const { provider, manager } = makeProvider(() =>
      Promise.reject(
        new Error('HTTP 404 for https://downloads.gemtalksystems.com/platforms/x86_64.Darwin/'),
      ),
    );

    // First render triggers the failing load.
    provider.getChildren();
    await tick();
    expect(manager.fetchAvailableVersions).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);

    // The refresh() fired in loadVersions()'s finally block makes VS Code
    // re-render. Those renders must NOT trigger another load, or the error
    // dialog flickers forever.
    provider.getChildren();
    provider.getChildren();
    await tick();
    expect(manager.fetchAvailableVersions).toHaveBeenCalledTimes(1);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
  });

  it('still re-fetches on an explicit loadVersions() call (manual refresh / post-download)', async () => {
    const { provider, manager } = makeProvider(() => Promise.reject(new Error('boom')));

    await provider.loadVersions();
    await provider.loadVersions();

    // Explicit reloads always re-fetch — only the getChildren() auto-trigger is gated.
    expect(manager.fetchAvailableVersions).toHaveBeenCalledTimes(2);
  });
});
