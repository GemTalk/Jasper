import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import { InstallCancelledError, installOutcomeText, showInstallOutcome } from '../versionManager';

describe('How an install step that did not finish is reported', () => {
  beforeEach(() => {
    vi.mocked(vscode.window.showInformationMessage).mockClear();
    vi.mocked(vscode.window.showErrorMessage).mockClear();
  });

  it('shows a cancel as information, in its own words', () => {
    showInstallOutcome(new InstallCancelledError('Download cancelled.'), 'Download failed');

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Download cancelled.');
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('shows anything else as an error, after what failed', () => {
    showInstallOutcome(new Error('disk full'), 'Extraction failed');

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Extraction failed: disk full');
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('gives the same text for the log, for a thrown value that is not an Error too', () => {
    expect(installOutcomeText(new InstallCancelledError('Cancelled.'), 'Install failed')).toBe(
      'Cancelled.',
    );
    expect(installOutcomeText('EBUSY', 'Install failed')).toBe('Install failed: EBUSY');
  });
});
