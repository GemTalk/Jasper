import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { autoCommitStatusBarFace } from '../autoCommitStatusBar';

describe('the status-bar face of each state', () => {
  it('says On, and warns, when auto-commit is armed', () => {
    const face = autoCommitStatusBarFace('on', 3);
    expect(face.text).toContain('Auto-Commit: On');
    expect(face.background).toBe('statusBarItem.warningBackground');
  });

  it('says the state plainly when it is off, with no colour', () => {
    const face = autoCommitStatusBarFace('off', 3);
    expect(face.text).toContain('Auto-Commit: Off');
    expect(face.background).toBeUndefined();
  });

  it('goes to the error colour when a commit has failed', () => {
    const face = autoCommitStatusBarFace('failed', 3);
    expect(face.text).toContain('FAILED');
    expect(face.background).toBe('statusBarItem.errorBackground');
  });

  it('names the session it is talking about in every state', () => {
    for (const status of ['off', 'on', 'failed'] as const) {
      expect(autoCommitStatusBarFace(status, 42).tooltip).toContain('Session 42');
    }
  });

  it('tells the armed user that Abort will not take a change back', () => {
    // The one thing a user can be caught out by: with auto-commit on, the escape hatch
    // they are used to is gone. The tooltip has to say so.
    expect(autoCommitStatusBarFace('on', 1).tooltip).toMatch(/Abort will not take those changes/);
  });
});
