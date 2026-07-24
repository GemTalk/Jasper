import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  showInformationMessage: vi.fn(() => Promise.resolve(undefined)),
  showInputBox: vi.fn<() => Promise<string | undefined>>(() => Promise.resolve(undefined)),
  showWarningMessage: vi.fn(() => Promise.resolve(undefined)),
  showErrorMessage: vi.fn(() => Promise.resolve(undefined)),
  executeCommand: vi.fn(() => Promise.resolve(undefined)),
  appendLine: vi.fn(),
  channelShow: vi.fn(),
  installSupport: vi.fn(() =>
    Promise.resolve({ success: true, report: 'SUCCESS -- all checks passed.', message: 'ok' }),
  ),
  sessionNeedsCommit: vi.fn<() => boolean | undefined>(() => false),
  refreshAvailable: vi.fn((s: { rbSupportAvailable?: boolean }) => {
    s.rbSupportAvailable = true;
    return true;
  }),
  existsSync: vi.fn(() => true),
}));

vi.mock('vscode', () => ({
  window: {
    showInformationMessage: mocks.showInformationMessage,
    showInputBox: mocks.showInputBox,
    showWarningMessage: mocks.showWarningMessage,
    showErrorMessage: mocks.showErrorMessage,
    createOutputChannel: () => ({ appendLine: mocks.appendLine, show: mocks.channelShow }),
    withProgress: (_opts: unknown, task: (p: { report: () => void }) => unknown) =>
      task({ report: () => {} }),
  },
  commands: { executeCommand: mocks.executeCommand },
  ProgressLocation: { Notification: 15 },
}));

vi.mock('fs', () => ({ existsSync: mocks.existsSync }));

vi.mock('../../browserQueries', () => ({
  sessionNeedsCommit: mocks.sessionNeedsCommit,
  // Read at load time by the shared feature registry (pluginFeatures) as
  // the refactoring feature's live probe; never invoked in these command tests.
  checkRefactoringSupportAvailable: vi.fn(() => false),
}));

vi.mock('../refactoringAvailability', () => ({
  refreshRefactoringSupportAvailable: mocks.refreshAvailable,
}));

vi.mock('../refactoringInstall', async (importActual) => {
  const actual = await importActual<typeof import('../refactoringInstall')>();
  return {
    ...actual,
    installRefactoringSupport: mocks.installSupport,
    isRefactoringSupportInstalled: vi.fn(() => false),
    REFACTORING_PAYLOAD_FILES: ['refactoring-loader.gs'],
  };
});

import { ActiveSession, SessionManager } from '../../sessionManager';
import { installRefactoringFeature } from '../refactoringInstallCommand';

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
    rbSupportAvailable: false,
  } as unknown as ActiveSession;
}

const abortMock = vi.fn(() => ({ success: true, err: { number: 0 } }));
const sessionManager = { abort: abortMock } as unknown as SessionManager;

const install = (base: ActiveSession, interactive: boolean) =>
  installRefactoringFeature(base, sessionManager, EXTENSION_PATH, interactive);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.existsSync.mockReturnValue(true);
  mocks.showInputBox.mockReset();
  mocks.showInputBox.mockResolvedValue(undefined);
  mocks.sessionNeedsCommit.mockReturnValue(false);
  mocks.installSupport.mockResolvedValue({
    success: true,
    report: 'SUCCESS -- all checks passed.',
    message: 'ok',
  });
  mocks.refreshAvailable.mockImplementation((s: { rbSupportAvailable?: boolean }) => {
    s.rbSupportAvailable = true;
    return true;
  });
});

describe('installRefactoringFeature', () => {
  it('installs over a SystemUser session when the default password works', async () => {
    const base = createBaseSession();

    const ok = await install(base, true);

    expect(mocks.showInputBox).not.toHaveBeenCalled();
    expect(mocks.installSupport).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
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

  it('surfaces the report and reports failure when the loader install is incomplete', async () => {
    mocks.installSupport.mockResolvedValueOnce({
      success: false,
      report: 'INCOMPLETE -- missing RBParser',
      message: 'did not install completely',
    });
    const base = createBaseSession();

    const ok = await install(base, true);

    expect(mocks.channelShow).toHaveBeenCalled();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('install failed'));
    expect(ok).toBe(false);
  });

  it('refreshes the working session, relatches availability, and sets the context key on success', async () => {
    const base = createBaseSession();

    await install(base, true);

    expect(abortMock).toHaveBeenCalledWith(base.id);
    expect(base.rbSupportAvailable).toBe(true);
    expect(mocks.executeCommand).toHaveBeenCalledWith(
      'setContext',
      'gemstone.rbSupportAvailable',
      true,
    );
  });
});
