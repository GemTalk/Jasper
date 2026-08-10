import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  showInformationMessage: vi.fn(() => Promise.resolve(undefined)),
  showInputBox: vi.fn<() => Promise<string | undefined>>(() => Promise.resolve(undefined)),
  showWarningMessage: vi.fn(() => Promise.resolve(undefined)),
  showErrorMessage: vi.fn(() => Promise.resolve(undefined)),
  executeCommand: vi.fn(() => Promise.resolve(undefined)),
  installSupport: vi.fn(() =>
    Promise.resolve({ success: true, committed: true, verified: true, filedIn: [], message: 'ok' }),
  ),
  sessionNeedsCommit: vi.fn<() => boolean | undefined>(() => false),
  checkEnhancedInspectorAvailable: vi.fn(() => true),
  existsSync: vi.fn(() => true),
}));

vi.mock('vscode', () => ({
  window: {
    showInformationMessage: mocks.showInformationMessage,
    showInputBox: mocks.showInputBox,
    showWarningMessage: mocks.showWarningMessage,
    showErrorMessage: mocks.showErrorMessage,
    withProgress: (_opts: unknown, task: (p: { report: () => void }) => unknown) =>
      task({ report: () => {} }),
  },
  commands: { executeCommand: mocks.executeCommand },
  ProgressLocation: { Notification: 15 },
}));

vi.mock('fs', () => ({ existsSync: mocks.existsSync }));

vi.mock('../../browserQueries', () => ({
  sessionNeedsCommit: mocks.sessionNeedsCommit,
  checkEnhancedInspectorAvailable: mocks.checkEnhancedInspectorAvailable,
  // Read at load time by the shared feature registry (pluginFeatures) as
  // the refactoring feature's live probe; never invoked in these command tests.
  checkRefactoringSupportAvailable: vi.fn(() => false),
}));

// Partial mock: stub the GCI-touching install pipeline, keep everything else.
vi.mock('../enhancedInspectorInstall', async (importActual) => {
  const actual = await importActual<typeof import('../enhancedInspectorInstall')>();
  return {
    ...actual,
    installEnhancedInspectorSupport: mocks.installSupport,
    isEnhancedInspectorInstalled: vi.fn(() => false),
    ENHANCED_INSPECTOR_FILES: ['Announcements.gs'],
  };
});

import { ActiveSession, SessionManager } from '../../sessionManager';
import { installEnhancedInspectorFeature } from '../enhancedInspectorCommand';

const EXTENSION_PATH = '/ext';

function createBaseSession(systemUserLoginSucceeds = true): ActiveSession {
  return {
    id: 1,
    login: { stone: 'demo', gem_host: 'localhost', netldi: 'netldi' },
    gci: {
      GciTsLogin: vi.fn(() =>
        systemUserLoginSucceeds
          ? { session: {}, err: { number: 0 } }
          : { session: null, err: { number: 4051, message: 'bad password' } },
      ),
      GciTsLogout: vi.fn(),
    },
    stoneVersion: '3.7.5',
    enhancedInspectorAvailable: false,
  } as unknown as ActiveSession;
}

const abortMock = vi.fn(() => ({ success: true, err: { number: 0 } }));
const sessionManager = { abort: abortMock } as unknown as SessionManager;

const install = (base: ActiveSession, interactive: boolean) =>
  installEnhancedInspectorFeature(base, sessionManager, EXTENSION_PATH, interactive);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.existsSync.mockReturnValue(true);
  mocks.showInputBox.mockReset();
  mocks.showInputBox.mockResolvedValue(undefined);
  mocks.sessionNeedsCommit.mockReturnValue(false);
  mocks.installSupport.mockResolvedValue({
    success: true,
    committed: true,
    verified: true,
    filedIn: [],
    message: 'ok',
  });
  mocks.checkEnhancedInspectorAvailable.mockReturnValue(true);
});

describe('installEnhancedInspectorFeature', () => {
  it('installs over a SystemUser session when the default password works', async () => {
    const base = createBaseSession();

    const ok = await install(base, true);

    expect(mocks.showInputBox).not.toHaveBeenCalled();
    expect(mocks.installSupport).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });

  it('reports success (so the caller still toasts) even when the working-session refresh is deferred', async () => {
    // The install lands + verifies server-side, but the session has uncommitted changes and the
    // user picks "Later": refreshWorkingSessionAfterInstall returns false and the
    // enhancedInspectorAvailable latch is left stale. The feature must still report success —
    // keying it on the latch made a verified install look like a failure, so the bundle showed
    // neither a success nor an error (issue #384 review).
    mocks.sessionNeedsCommit.mockReturnValue(true);
    mocks.showInformationMessage.mockResolvedValueOnce(undefined); // dismiss = not "Refresh" = Later
    const base = createBaseSession();

    const ok = await install(base, true);

    expect(mocks.installSupport).toHaveBeenCalledTimes(1); // it did run + verify server-side
    expect(base.enhancedInspectorAvailable).not.toBe(true); // latch intentionally left stale
    expect(ok).toBe(true); // ...yet the install is reported as landed
  });

  it('reports a clear error and never logs in when the payload files are missing', async () => {
    mocks.existsSync.mockReturnValue(false);
    const base = createBaseSession();

    const ok = await install(base, true);

    expect(mocks.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('payload not found'),
    );
    expect(base.gci.GciTsLogin).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });

  it('prompts for the SystemUser password when the default is rejected, then installs', async () => {
    const base = createBaseSession(false);
    (base.gci.GciTsLogin as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ session: null, err: { number: 4051, message: 'bad password' } })
      .mockReturnValueOnce({ session: {}, err: { number: 0 } });
    mocks.showInputBox.mockResolvedValueOnce('the real password');

    await install(base, true);

    expect(mocks.showInputBox).toHaveBeenCalledTimes(1);
    expect(mocks.installSupport).toHaveBeenCalledTimes(1);
  });

  it('warns without prompting when non-interactive and the default password fails', async () => {
    const base = createBaseSession(false);

    const ok = await install(base, false);

    expect(mocks.showInputBox).not.toHaveBeenCalled();
    expect(mocks.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(mocks.installSupport).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });

  it('reports failure when the install pipeline fails', async () => {
    mocks.installSupport.mockResolvedValueOnce({
      success: false,
      committed: false,
      verified: false,
      filedIn: [],
      message: 'boom',
    });
    const base = createBaseSession();

    const ok = await install(base, true);

    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('install failed'));
    expect(ok).toBe(false);
  });

  it('refreshes the working session and relatches availability on success', async () => {
    const base = createBaseSession();

    await install(base, true);

    expect(abortMock).toHaveBeenCalledWith(base.id);
    expect(base.enhancedInspectorAvailable).toBe(true);
  });
});
