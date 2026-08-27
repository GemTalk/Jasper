import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const config: Record<string, unknown> = {};
  return {
    config,
    // Resolves a MessageItem (the modal's chosen button) or a string/undefined
    // (toasts, dismissal), so the return type is intentionally wide.
    showInformationMessage: vi.fn<(...a: unknown[]) => Promise<unknown>>(() =>
      Promise.resolve(undefined),
    ),
    showWarningMessage: vi.fn<(...a: unknown[]) => Promise<string | undefined>>(() =>
      Promise.resolve(undefined),
    ),
    showErrorMessage: vi.fn(),
    update: vi.fn((key: string, value: unknown) => {
      config[key] = value;
      return Promise.resolve();
    }),
    installEI: vi.fn(() => Promise.resolve(true)),
    installRB: vi.fn(() => Promise.resolve(true)),
    uninstallEI: vi.fn(() => Promise.resolve(true)),
    uninstallRB: vi.fn(() => Promise.resolve(true)),
    executeCommand: vi.fn(() => Promise.resolve(undefined)),
  };
});

vi.mock('vscode', () => ({
  window: {
    showInformationMessage: mocks.showInformationMessage,
    showWarningMessage: mocks.showWarningMessage,
    showErrorMessage: mocks.showErrorMessage,
  },
  workspace: {
    getConfiguration: () => ({
      get: (key: string, def: unknown) => (key in mocks.config ? mocks.config[key] : def),
      update: mocks.update,
    }),
  },
  commands: {
    executeCommand: mocks.executeCommand,
  },
  ConfigurationTarget: { Global: 1 },
}));

vi.mock('../enhancedInspector/enhancedInspectorCommand', () => ({
  installEnhancedInspectorFeature: mocks.installEI,
}));
vi.mock('../refactoring/refactoringInstallCommand', () => ({
  installRefactoringFeature: mocks.installRB,
}));
vi.mock('../enhancedInspector/enhancedInspectorUninstallCommand', () => ({
  uninstallEnhancedInspectorFeature: mocks.uninstallEI,
}));
vi.mock('../refactoring/refactoringUninstallCommand', () => ({
  uninstallRefactoringFeature: mocks.uninstallRB,
}));

import { ActiveSession, SessionManager } from '../sessionManager';
import {
  maybeOfferServerSupport,
  runInstallServerSupport,
  runUninstallServerSupport,
} from '../optionalSupportOffer';

const AUTO_INSTALL_KEY = 'serverSupport.autoInstall';
const EXTENSION_PATH = '/ext';

// Both supports missing on a 3.7.5 stone (EI applicable, RB always applicable).
function baseSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    id: 1,
    login: { stone: 'demo' },
    stoneVersion: '3.7.5',
    enhancedInspectorAvailable: false,
    rbSupportAvailable: false,
    ...overrides,
  } as unknown as ActiveSession;
}

const getSelectedSession = vi.fn<() => ActiveSession | undefined>();
const sessionManager = { getSelectedSession } as unknown as SessionManager;

// The offer now passes MessageItem objects (so it can set isCloseAffordance on
// "Not Now"), and compares the resolved choice by identity — so resolve the actual
// item the modal was shown with, matched by title, not a bare string.
function answer(title: string | undefined) {
  mocks.showInformationMessage.mockImplementation((...args: unknown[]) => {
    const items = args.slice(2) as Array<{ title: string }>;
    const match = title === undefined ? undefined : items.find((i) => i.title === title);
    return Promise.resolve(match);
  });
}

/** Button labels the modal was shown with (the titles of its variadic items). */
function shownButtons(): string[] {
  const call = mocks.showInformationMessage.mock.calls[0];
  return call ? (call.slice(2) as Array<{ title: string }>).map((i) => i.title) : [];
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(mocks.config)) delete mocks.config[k];
  mocks.showInformationMessage.mockResolvedValue(undefined);
  mocks.showWarningMessage.mockResolvedValue(undefined);
});

describe('maybeOfferServerSupport', () => {
  it('does nothing when the stone already has everything applicable', async () => {
    const base = baseSession({ enhancedInspectorAvailable: true, rbSupportAvailable: true });

    await maybeOfferServerSupport(base, sessionManager, EXTENSION_PATH);

    expect(mocks.showInformationMessage).not.toHaveBeenCalled();
    expect(mocks.installEI).not.toHaveBeenCalled();
    expect(mocks.installRB).not.toHaveBeenCalled();
  });

  it('does nothing when the setting is "never"', async () => {
    mocks.config[AUTO_INSTALL_KEY] = 'never';

    await maybeOfferServerSupport(baseSession(), sessionManager, EXTENSION_PATH);

    expect(mocks.showInformationMessage).not.toHaveBeenCalled();
    expect(mocks.installEI).not.toHaveBeenCalled();
  });

  it('installs both without a modal prompt when the setting is "always"', async () => {
    mocks.config[AUTO_INSTALL_KEY] = 'always';
    const base = baseSession();

    await maybeOfferServerSupport(base, sessionManager, EXTENSION_PATH);

    const shownModal = mocks.showInformationMessage.mock.calls.some(
      (c) => typeof c[1] === 'object' && (c[1] as { modal?: boolean } | undefined)?.modal === true,
    );
    expect(shownModal).toBe(false);
    expect(mocks.installEI).toHaveBeenCalledWith(base, sessionManager, EXTENSION_PATH, false);
    expect(mocks.installRB).toHaveBeenCalledWith(base, sessionManager, EXTENSION_PATH, false);
    expect(mocks.executeCommand).toHaveBeenCalledWith('gemstone.explorer.refresh');
  });

  it('confirms success with one consolidated "server support" toast, not one per feature', async () => {
    mocks.config[AUTO_INSTALL_KEY] = 'always';

    await maybeOfferServerSupport(baseSession(), sessionManager, EXTENSION_PATH);

    const toasts = mocks.showInformationMessage.mock.calls.filter((c) => typeof c[0] === 'string');
    expect(toasts).toEqual([['GemStone server support installed.']]);
  });

  it('shows no success toast when a feature fails to install', async () => {
    mocks.config[AUTO_INSTALL_KEY] = 'always';
    mocks.installRB.mockResolvedValueOnce(false);

    await maybeOfferServerSupport(baseSession(), sessionManager, EXTENSION_PATH);

    const succeeded = mocks.showInformationMessage.mock.calls.some(
      (c) => c[0] === 'GemStone server support installed.',
    );
    expect(succeeded).toBe(false);
  });

  it('reloads the Explorer dictionary list after installing, so a new dictionary appears', async () => {
    answer('Install');

    await maybeOfferServerSupport(baseSession(), sessionManager, EXTENSION_PATH);

    expect(mocks.executeCommand).toHaveBeenCalledWith('gemstone.explorer.refresh');
  });

  it('offers one modal with Install, Not Now, Always, and Never', async () => {
    answer('Install');

    await maybeOfferServerSupport(baseSession(), sessionManager, EXTENSION_PATH);

    expect(shownButtons()).toEqual(['Install', 'Not Now', 'Always', 'Never']);
  });

  it('marks "Not Now" as the modal close affordance so Escape declines without touching the setting', async () => {
    answer('Not Now');

    await maybeOfferServerSupport(baseSession(), sessionManager, EXTENSION_PATH);

    const items = mocks.showInformationMessage.mock.calls[0].slice(2) as Array<{
      title: string;
      isCloseAffordance?: boolean;
    }>;
    expect(items.find((i) => i.title === 'Not Now')?.isCloseAffordance).toBe(true);
    expect(mocks.installEI).not.toHaveBeenCalled();
    expect(mocks.installRB).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('installs both interactively when the user clicks Install, leaving the setting unchanged', async () => {
    answer('Install');
    const base = baseSession();

    await maybeOfferServerSupport(base, sessionManager, EXTENSION_PATH);

    expect(mocks.installEI).toHaveBeenCalledWith(base, sessionManager, EXTENSION_PATH, true);
    expect(mocks.installRB).toHaveBeenCalledWith(base, sessionManager, EXTENSION_PATH, true);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('remembers "always" and installs when the user clicks Always', async () => {
    answer('Always');

    await maybeOfferServerSupport(baseSession(), sessionManager, EXTENSION_PATH);

    expect(mocks.update).toHaveBeenCalledWith(AUTO_INSTALL_KEY, 'always', 1);
    expect(mocks.installEI).toHaveBeenCalledTimes(1);
    expect(mocks.installRB).toHaveBeenCalledTimes(1);
  });

  it('remembers "never" and installs nothing when the user clicks Never', async () => {
    answer('Never');

    await maybeOfferServerSupport(baseSession(), sessionManager, EXTENSION_PATH);

    expect(mocks.update).toHaveBeenCalledWith(AUTO_INSTALL_KEY, 'never', 1);
    expect(mocks.installEI).not.toHaveBeenCalled();
    expect(mocks.installRB).not.toHaveBeenCalled();
  });

  it('installs nothing and changes no setting when the user dismisses the prompt', async () => {
    answer(undefined);

    await maybeOfferServerSupport(baseSession(), sessionManager, EXTENSION_PATH);

    expect(mocks.installEI).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.executeCommand).not.toHaveBeenCalled();
  });

  it('offers only the refactoring engine on a pre-3.7.5 stone (Enhanced Inspector not applicable)', async () => {
    answer('Install');
    const base = baseSession({ stoneVersion: '3.6.2' });

    await maybeOfferServerSupport(base, sessionManager, EXTENSION_PATH);

    expect(mocks.installRB).toHaveBeenCalledTimes(1);
    expect(mocks.installEI).not.toHaveBeenCalled();
  });
});

describe('runInstallServerSupport', () => {
  it('reports an error and installs nothing when no session is selected', async () => {
    getSelectedSession.mockReturnValue(undefined);

    await runInstallServerSupport(sessionManager, EXTENSION_PATH);

    expect(mocks.showErrorMessage).toHaveBeenCalled();
    expect(mocks.installEI).not.toHaveBeenCalled();
  });

  it('installs every applicable support interactively, reinstalling even when present', async () => {
    getSelectedSession.mockReturnValue(
      baseSession({ enhancedInspectorAvailable: true, rbSupportAvailable: true }),
    );

    await runInstallServerSupport(sessionManager, EXTENSION_PATH);

    expect(mocks.installEI).toHaveBeenCalledWith(
      expect.anything(),
      sessionManager,
      EXTENSION_PATH,
      true,
    );
    expect(mocks.installRB).toHaveBeenCalledWith(
      expect.anything(),
      sessionManager,
      EXTENSION_PATH,
      true,
    );
  });

  it('installs only the refactoring engine on a pre-3.7.5 stone', async () => {
    getSelectedSession.mockReturnValue(baseSession({ stoneVersion: '3.6.2' }));

    await runInstallServerSupport(sessionManager, EXTENSION_PATH);

    expect(mocks.installRB).toHaveBeenCalledTimes(1);
    expect(mocks.installEI).not.toHaveBeenCalled();
  });
});

describe('runUninstallServerSupport', () => {
  // A stone with both supports installed.
  const installed = () =>
    baseSession({ enhancedInspectorAvailable: true, rbSupportAvailable: true });

  function confirm(button: string | undefined) {
    mocks.showWarningMessage.mockResolvedValue(button);
  }

  it('reports an error and removes nothing when no session is selected', async () => {
    getSelectedSession.mockReturnValue(undefined);

    await runUninstallServerSupport(sessionManager);

    expect(mocks.showErrorMessage).toHaveBeenCalled();
    expect(mocks.uninstallEI).not.toHaveBeenCalled();
    expect(mocks.uninstallRB).not.toHaveBeenCalled();
  });

  it('does nothing but inform the user when no support is installed', async () => {
    getSelectedSession.mockReturnValue(baseSession());

    await runUninstallServerSupport(sessionManager);

    expect(mocks.showInformationMessage).toHaveBeenCalled();
    expect(mocks.showWarningMessage).not.toHaveBeenCalled();
    expect(mocks.uninstallEI).not.toHaveBeenCalled();
    expect(mocks.uninstallRB).not.toHaveBeenCalled();
  });

  it('confirms first, then removes every installed support when the user confirms', async () => {
    getSelectedSession.mockReturnValue(installed());
    confirm('Uninstall');

    await runUninstallServerSupport(sessionManager);

    expect(mocks.showWarningMessage).toHaveBeenCalled();
    expect(mocks.uninstallEI).toHaveBeenCalledWith(expect.anything(), sessionManager, true);
    expect(mocks.uninstallRB).toHaveBeenCalledWith(expect.anything(), sessionManager, true);
    expect(mocks.executeCommand).toHaveBeenCalledWith('gemstone.explorer.refresh');
    expect(mocks.showInformationMessage).toHaveBeenCalledWith(
      'GemStone server support uninstalled.',
    );
  });

  it('removes nothing when the user cancels the confirmation', async () => {
    getSelectedSession.mockReturnValue(installed());
    confirm(undefined);

    await runUninstallServerSupport(sessionManager);

    expect(mocks.uninstallEI).not.toHaveBeenCalled();
    expect(mocks.uninstallRB).not.toHaveBeenCalled();
    expect(mocks.executeCommand).not.toHaveBeenCalled();
  });

  it('removes only the installed support, leaving an absent one alone', async () => {
    getSelectedSession.mockReturnValue(
      baseSession({ enhancedInspectorAvailable: false, rbSupportAvailable: true }),
    );
    confirm('Uninstall');

    await runUninstallServerSupport(sessionManager);

    expect(mocks.uninstallRB).toHaveBeenCalledTimes(1);
    expect(mocks.uninstallEI).not.toHaveBeenCalled();
  });

  it('shows the confirmation as a modal', async () => {
    getSelectedSession.mockReturnValue(installed());
    confirm('Uninstall');

    await runUninstallServerSupport(sessionManager);

    const options = mocks.showWarningMessage.mock.calls[0][1] as { modal?: boolean };
    expect(options.modal).toBe(true);
  });
});
