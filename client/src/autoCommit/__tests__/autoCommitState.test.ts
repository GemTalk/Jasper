import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  _resetAutoCommitStateForTests,
  forgetSessionAutoCommit,
  getAutoCommitStatus,
  isAutoCommitArmed,
  isAutoCommitSuspended,
  onAutoCommitChanged,
  registerSessionAutoCommit,
  resumeAutoCommit,
  setAutoCommitStatus,
  suspendAutoCommit,
} from '../autoCommitState';

beforeEach(() => _resetAutoCommitStateForTests());

describe('per-session status', () => {
  it('is off for a session nobody registered', () => {
    expect(getAutoCommitStatus(7)).toBe('off');
    expect(isAutoCommitArmed(7)).toBe(false);
  });

  it('seeds a new session from the window default', () => {
    registerSessionAutoCommit(1, true);
    registerSessionAutoCommit(2, false);
    expect(getAutoCommitStatus(1)).toBe('on');
    expect(getAutoCommitStatus(2)).toBe('off');
  });

  it('does not treat the failed state as armed', () => {
    registerSessionAutoCommit(1, true);
    setAutoCommitStatus(1, 'failed');
    expect(isAutoCommitArmed(1)).toBe(false);
  });

  it('forgets a logged-out session, so a reused id does not inherit it', () => {
    registerSessionAutoCommit(1, true);
    forgetSessionAutoCommit(1);
    expect(getAutoCommitStatus(1)).toBe('off');
  });
});

describe('change notification', () => {
  it('fires on a real change and stays quiet on a repeat', () => {
    const heard = vi.fn();
    onAutoCommitChanged(heard);

    setAutoCommitStatus(1, 'on');
    expect(heard).toHaveBeenCalledTimes(1);
    setAutoCommitStatus(1, 'on');
    expect(heard).toHaveBeenCalledTimes(1);
    setAutoCommitStatus(1, 'failed');
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('survives a listener that throws', () => {
    onAutoCommitChanged(() => {
      throw new Error('a status bar mid-teardown');
    });
    const other = vi.fn();
    onAutoCommitChanged(other);
    expect(() => setAutoCommitStatus(1, 'on')).not.toThrow();
    expect(other).toHaveBeenCalled();
  });

  it('stops telling a disposed listener', () => {
    const heard = vi.fn();
    const subscription = onAutoCommitChanged(heard);
    subscription.dispose();
    setAutoCommitStatus(1, 'on');
    expect(heard).not.toHaveBeenCalled();
  });
});

describe('suspension depth', () => {
  it('counts nested suspensions and only reports the outermost resume', () => {
    suspendAutoCommit(1);
    suspendAutoCommit(1);
    expect(isAutoCommitSuspended(1)).toBe(true);

    expect(resumeAutoCommit(1)).toBe(false);
    expect(isAutoCommitSuspended(1)).toBe(true);
    expect(resumeAutoCommit(1)).toBe(true);
    expect(isAutoCommitSuspended(1)).toBe(false);
  });

  it('answers false for a resume with nothing open', () => {
    expect(resumeAutoCommit(1)).toBe(false);
  });
});
