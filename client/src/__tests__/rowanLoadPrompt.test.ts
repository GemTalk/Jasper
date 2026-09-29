import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import { shouldLoadAfterAddingDependency } from '../rowanLoadPrompt';

function answered(choice: string | undefined) {
  vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(
    choice as unknown as vscode.MessageItem,
  );
}

describe('shouldLoadAfterAddingDependency', () => {
  beforeEach(() => {
    vi.mocked(vscode.window.showInformationMessage).mockReset();
  });

  it('loads when told to', async () => {
    answered('Load');

    expect(await shouldLoadAfterAddingDependency('WebGS')).toBe(true);
  });

  it('names the dependency it is offering to load, and offers only Load', async () => {
    answered('Load');

    await shouldLoadAfterAddingDependency('WebGS');

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('WebGS'),
      expect.objectContaining({ modal: true }),
      'Load',
    );
  });

  it('does nothing when the offer is dismissed', async () => {
    answered(undefined);

    expect(await shouldLoadAfterAddingDependency('WebGS')).toBe(false);
  });

  it('offers again on the next dependency, remembering no earlier answer', async () => {
    answered('Load');
    expect(await shouldLoadAfterAddingDependency('WebGS')).toBe(true);

    answered(undefined);
    expect(await shouldLoadAfterAddingDependency('Cypress')).toBe(false);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(2);
  });
});
