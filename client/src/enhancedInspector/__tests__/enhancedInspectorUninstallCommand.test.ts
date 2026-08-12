import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  showInformationMessage: vi.fn(() => Promise.resolve(undefined)),
  showWarningMessage: vi.fn(() => Promise.resolve(undefined)),
  showErrorMessage: vi.fn(() => Promise.resolve(undefined)),
  uninstallSupport: vi.fn(() =>
    Promise.resolve({ success: true, committed: true, verified: true, message: 'ok' }),
  ),
  obtainSystemUserSession: vi.fn<() => Promise<unknown>>(() => Promise.resolve({ handle: {} })),
  refreshWorkingSession: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
  refreshAvailable: vi.fn(),
}));

vi.mock('vscode', () => ({
  window: {
    showInformationMessage: mocks.showInformationMessage,
    showWarningMessage: mocks.showWarningMessage,
    showErrorMessage: mocks.showErrorMessage,
    withProgress: (_opts: unknown, task: (p: { report: () => void }) => unknown) =>
      task({ report: () => {} }),
  },
  ProgressLocation: { Notification: 15 },
}));

vi.mock('../enhancedInspectorUninstall', () => ({
  uninstallEnhancedInspectorSupport: mocks.uninstallSupport,
}));
vi.mock('../../serverPlugin/systemUserAuth', () => ({
  obtainSystemUserSession: mocks.obtainSystemUserSession,
  refreshWorkingSessionAfterInstall: mocks.refreshWorkingSession,
}));
vi.mock('../enhancedInspectorAvailability', () => ({
  refreshEnhancedInspectorAvailable: mocks.refreshAvailable,
}));

import { ActiveSession, SessionManager } from '../../sessionManager';
import { uninstallEnhancedInspectorFeature } from '../enhancedInspectorUninstallCommand';

const logout = vi.fn();
function createBaseSession(): ActiveSession {
  return {
    id: 1,
    login: { stone: 'demo' },
    gci: { GciTsLogout: logout },
    enhancedInspectorAvailable: true,
  } as unknown as ActiveSession;
}

const sessionManager = {} as unknown as SessionManager;
const uninstall = (base: ActiveSession, interactive: boolean) =>
  uninstallEnhancedInspectorFeature(base, sessionManager, interactive);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.obtainSystemUserSession.mockResolvedValue({ handle: {} });
  mocks.refreshWorkingSession.mockResolvedValue(true);
  mocks.uninstallSupport.mockResolvedValue({
    success: true,
    committed: true,
    verified: true,
    message: 'ok',
  });
  mocks.refreshAvailable.mockImplementation((s: ActiveSession) => {
    s.enhancedInspectorAvailable = false;
  });
});

describe('uninstallEnhancedInspectorFeature', () => {
  it('removes the support over a SystemUser session and relatches availability to false', async () => {
    const base = createBaseSession();

    const gone = await uninstall(base, true);

    expect(mocks.uninstallSupport).toHaveBeenCalledTimes(1);
    expect(mocks.refreshAvailable).toHaveBeenCalledWith(base);
    expect(gone).toBe(true);
  });

  it('logs the transient SystemUser session out even when the removal succeeds', async () => {
    const base = createBaseSession();

    await uninstall(base, true);

    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('does not run the removal and warns when the default password is rejected non-interactively', async () => {
    mocks.obtainSystemUserSession.mockResolvedValue(undefined);
    const base = createBaseSession();

    const gone = await uninstall(base, false);

    expect(mocks.uninstallSupport).not.toHaveBeenCalled();
    expect(mocks.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('SystemUser'));
    expect(gone).toBe(false);
  });

  it('reports an error and leaves availability unchanged when the removal fails', async () => {
    mocks.uninstallSupport.mockResolvedValue({
      success: false,
      committed: false,
      verified: false,
      message: 'permission denied',
    });
    const base = createBaseSession();

    await uninstall(base, true);

    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('permission denied'),
    );
    expect(mocks.refreshAvailable).not.toHaveBeenCalled();
  });
});
