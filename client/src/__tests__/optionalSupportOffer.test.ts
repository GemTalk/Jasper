import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const config: Record<string, unknown> = {};
  return {
    config,
    showInformationMessage: vi.fn<(...a: unknown[]) => Promise<string | undefined>>(() =>
      Promise.resolve(undefined),
    ),
    showErrorMessage: vi.fn(),
    update: vi.fn((key: string, value: unknown) => {
      config[key] = value;
      return Promise.resolve();
    }),
    installEI: vi.fn(() => Promise.resolve(true)),
    installRB: vi.fn(() => Promise.resolve(true)),
    executeCommand: vi.fn(() => Promise.resolve(undefined)),
  };
});

vi.mock('vscode', () => ({
  window: {
    showInformationMessage: mocks.showInformationMessage,
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

import { ActiveSession, SessionManager } from '../sessionManager';
import { maybeOfferServerSupport, runInstallServerSupport } from '../optionalSupportOffer';

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

function answer(button: string | undefined) {
  mocks.showInformationMessage.mockResolvedValue(button);
}

/** Button labels the modal was shown with (its variadic items). */
function shownButtons(): string[] {
  const call = mocks.showInformationMessage.mock.calls[0];
  return call ? (call.slice(2) as string[]) : [];
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(mocks.config)) delete mocks.config[k];
  mocks.showInformationMessage.mockResolvedValue(undefined);
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

  it('installs both silently without a prompt when the setting is "always"', async () => {
    mocks.config[AUTO_INSTALL_KEY] = 'always';
    const base = baseSession();

    await maybeOfferServerSupport(base, sessionManager, EXTENSION_PATH);

    expect(mocks.showInformationMessage).not.toHaveBeenCalled();
    expect(mocks.installEI).toHaveBeenCalledWith(base, sessionManager, EXTENSION_PATH, false);
    expect(mocks.installRB).toHaveBeenCalledWith(base, sessionManager, EXTENSION_PATH, false);
    expect(mocks.executeCommand).toHaveBeenCalledWith('gemstone.explorer.refresh');
  });

  it('reloads the Explorer dictionary list after installing, so a new dictionary appears', async () => {
    answer('Install');

    await maybeOfferServerSupport(baseSession(), sessionManager, EXTENSION_PATH);

    expect(mocks.executeCommand).toHaveBeenCalledWith('gemstone.explorer.refresh');
  });

  it('offers one modal with Install, Always, and Never', async () => {
    answer('Install');

    await maybeOfferServerSupport(baseSession(), sessionManager, EXTENSION_PATH);

    expect(shownButtons()).toEqual(['Install', 'Always', 'Never']);
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
