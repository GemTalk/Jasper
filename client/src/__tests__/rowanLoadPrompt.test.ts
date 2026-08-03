import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import { __resetConfig, __setConfig } from '../__mocks__/vscode';
import { shouldLoadAfterAddingDependency } from '../rowanLoadPrompt';

const SETTING = 'rowan.loadAfterAddingDependency';

function answered(choice: string | undefined) {
  vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(
    choice as unknown as vscode.MessageItem,
  );
}

describe('shouldLoadAfterAddingDependency', () => {
  beforeEach(() => {
    __resetConfig();
    vi.mocked(vscode.window.showInformationMessage).mockReset();
  });

  it('loads without asking when the answer is already always', async () => {
    __setConfig('gemstone', SETTING, 'always');

    expect(await shouldLoadAfterAddingDependency('WebGS')).toBe(true);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('stays out of the way when the answer is already never', async () => {
    __setConfig('gemstone', SETTING, 'never');

    expect(await shouldLoadAfterAddingDependency('WebGS')).toBe(false);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('asks by default, and loads when told to', async () => {
    answered('Load');

    expect(await shouldLoadAfterAddingDependency('WebGS')).toBe(true);
  });

  it('names the dependency it is offering to load', async () => {
    answered('Load');

    await shouldLoadAfterAddingDependency('WebGS');

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('WebGS'),
      expect.objectContaining({ modal: true }),
      'Load',
      'Always',
      'Never',
    );
  });

  it('does nothing when the offer is dismissed', async () => {
    answered(undefined);

    expect(await shouldLoadAfterAddingDependency('WebGS')).toBe(false);
    expect(vscode.workspace.getConfiguration('gemstone').get(SETTING)).toBeUndefined();
  });

  it('loads this time without remembering, when told just to load', async () => {
    answered('Load');

    await shouldLoadAfterAddingDependency('WebGS');

    expect(vscode.workspace.getConfiguration('gemstone').get(SETTING)).toBeUndefined();
  });

  it('remembers always, and loads', async () => {
    answered('Always');

    expect(await shouldLoadAfterAddingDependency('WebGS')).toBe(true);
    expect(vscode.workspace.getConfiguration('gemstone').get(SETTING)).toBe('always');
  });

  it('remembers never, and does not load', async () => {
    answered('Never');

    expect(await shouldLoadAfterAddingDependency('WebGS')).toBe(false);
    expect(vscode.workspace.getConfiguration('gemstone').get(SETTING)).toBe('never');
  });
});
