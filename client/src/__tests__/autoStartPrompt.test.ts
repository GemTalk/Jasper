import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const mocks = vi.hoisted(() => {
  const state: { config: Record<string, unknown> } = { config: {} };
  return {
    state,
    updateSpy: vi.fn(async () => {}),
    showInformationMessage: vi.fn(async (..._args: unknown[]) => undefined as string | undefined),
    showQuickPick: vi.fn(async (..._args: unknown[]) => undefined as unknown),
  };
});

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, def: unknown) =>
        key in mocks.state.config ? mocks.state.config[key] : def,
      update: mocks.updateSpy,
    }),
  },
  window: {
    showInformationMessage: mocks.showInformationMessage,
    showQuickPick: mocks.showQuickPick,
  },
  ConfigurationTarget: { Global: 1 },
}));

import {
  getAutoStartMode,
  setAutoStartMode,
  confirmStartDatabase,
  configureAutoStartDatabase,
} from '../autoStartPrompt';

beforeEach(() => {
  mocks.state.config = {};
  mocks.updateSpy.mockClear();
  mocks.showInformationMessage.mockClear();
  mocks.showQuickPick.mockClear();
});

describe('getAutoStartMode', () => {
  it('defaults to ask when unset', () => {
    expect(getAutoStartMode()).toBe('ask');
  });

  it('reads the configured value', () => {
    mocks.state.config['autoStartDatabase'] = 'never';
    expect(getAutoStartMode()).toBe('never');
  });
});

describe('setAutoStartMode', () => {
  it('persists globally, so the choice follows the user across workspaces', async () => {
    await setAutoStartMode('always');

    expect(mocks.updateSpy).toHaveBeenCalledWith('autoStartDatabase', 'always', 1);
  });
});

describe('confirmStartDatabase', () => {
  it('names the database in the question', async () => {
    await confirmStartDatabase('alpha');

    expect(mocks.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('alpha'),
      expect.objectContaining({ modal: true }),
      'Yes',
      'No',
      'Always',
      'Never',
    );
  });

  it('discloses that the choice is remembered', async () => {
    await confirmStartDatabase('alpha');

    const opts = mocks.showInformationMessage.mock.calls[0][1] as { detail: string };
    expect(opts.detail).toMatch(/always/i);
  });

  it('maps each button to its answer', async () => {
    for (const [button, answer] of [
      ['Yes', 'yes'],
      ['No', 'no'],
      ['Always', 'always'],
      ['Never', 'never'],
    ] as const) {
      mocks.showInformationMessage.mockResolvedValueOnce(button);
      expect(await confirmStartDatabase('alpha')).toBe(answer);
    }
  });

  it('discloses that Never is remembered too', async () => {
    await confirmStartDatabase('alpha');

    const opts = mocks.showInformationMessage.mock.calls[0][1] as { detail: string };
    expect(opts.detail).toMatch(/never/i);
  });

  it('treats a dismissed modal as no answer at all', async () => {
    mocks.showInformationMessage.mockResolvedValueOnce(undefined);

    expect(await confirmStartDatabase('alpha')).toBeUndefined();
  });
});

describe('configureAutoStartDatabase', () => {
  it('offers all three modes', async () => {
    await configureAutoStartDatabase();

    const items = mocks.showQuickPick.mock.calls[0][0] as { mode: string }[];
    expect(items.map((i) => i.mode)).toEqual(['ask', 'always', 'never']);
  });

  it('marks the current mode with a check', async () => {
    mocks.state.config['autoStartDatabase'] = 'never';

    await configureAutoStartDatabase();

    const items = mocks.showQuickPick.mock.calls[0][0] as { mode: string; label: string }[];
    expect(items.find((i) => i.mode === 'never')?.label).toContain('$(check)');
    expect(items.find((i) => i.mode === 'ask')?.label).not.toContain('$(check)');
  });

  it('persists the chosen mode', async () => {
    mocks.showQuickPick.mockResolvedValueOnce({ mode: 'never' });

    await configureAutoStartDatabase();

    expect(mocks.updateSpy).toHaveBeenCalledWith('autoStartDatabase', 'never', 1);
  });

  it('writes nothing when cancelled', async () => {
    mocks.showQuickPick.mockResolvedValueOnce(undefined);

    await configureAutoStartDatabase();

    expect(mocks.updateSpy).not.toHaveBeenCalled();
  });

  it('writes nothing when the current mode is re-picked', async () => {
    mocks.showQuickPick.mockResolvedValueOnce({ mode: 'ask' });

    await configureAutoStartDatabase();

    expect(mocks.updateSpy).not.toHaveBeenCalled();
  });
});

// The prompt's buttons write ConfigurationTarget.Global, but VS Code's default
// setting scope is "window", which a workspace is free to override. With both in
// play the workspace value keeps winning, so choosing "Never" would look like it
// had not stuck and the prompt would come back on the next connect.
describe('the contributed setting', () => {
  const pkgPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  // Look the setting up across ALL configuration blocks (VS Code merges their properties), not a
  // fixed block index — GemStone Search contributes its own configuration block, so the block order
  // is not something a test should depend on.
  const setting = pkg.contributes.configuration
    .map(
      (c: { properties?: Record<string, unknown> }) => c.properties?.['gemstone.autoStartDatabase'],
    )
    .find((s: unknown) => s !== undefined);

  it('is scoped so no workspace can override the remembered choice', () => {
    expect(setting.scope).toBe('application');
  });

  it('offers exactly the modes the code understands', () => {
    expect(setting.enum).toEqual(['ask', 'always', 'never']);
  });

  it('defaults to asking', () => {
    expect(setting.default).toBe('ask');
  });
});
