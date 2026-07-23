import { describe, it, expect, vi } from 'vitest';
import { forkGemRunning } from '../forkGem';

/** Captures the code a query builds, answering a canned result. */
function capture(): { execute: (code: string) => string; code: () => string } {
  const execute = vi.fn().mockReturnValue('42');
  return { execute, code: () => execute.mock.calls[0][0] as string };
}

const NRS = '!tcp@localhost#netldi:jasper-ldi#task!gemnetobject';

describe('forkGemRunning', () => {
  // Proven against a 3.7.5 stone: without this, `newDefault` asks for the
  // default NetLDI name and the fork fails with ERROR 2710.
  it('spawns the gem through the NetLDI it was given', () => {
    const { execute, code } = capture();

    forkGemRunning(execute, 'anything', NRS);

    expect(code()).toContain(`gem gemNRS: '${NRS}'`);
  });

  it('runs the expression in the forked gem', () => {
    const { execute, code } = capture();

    forkGemRunning(execute, 'HelloApi runHttpOnPort: 8888', NRS);

    expect(code()).toContain("forkAndDetachString: 'HelloApi runHttpOnPort: 8888'");
  });

  it('logs the new gem in as the user who asked for it, never SystemUser', () => {
    const { execute, code } = capture();

    forkGemRunning(execute, 'anything', NRS);

    expect(code()).toContain('gem username: System myUserProfile userId');
    expect(code()).toContain('createOnetimePasswordForUserId: System myUserProfile userId');
    expect(code()).not.toContain('SystemUser');
  });

  // A detached gem stops answering, so the id has to be taken while it still
  // does. Pinning the order because getting it wrong yields an unstoppable gem.
  it('reads the session id before detaching the gem', () => {
    const { execute, code } = capture();

    forkGemRunning(execute, 'anything', NRS);

    const source = code();
    expect(source.indexOf('id := gem stoneSessionId')).toBeLessThan(
      source.indexOf('forkAndDetachString:'),
    );
  });

  it('answers the new gem session id', () => {
    const { execute, code } = capture();

    const result = forkGemRunning(execute, 'anything', NRS);

    expect(result).toBe('42');
    expect(code().trimEnd().endsWith('id printString')).toBe(true);
  });

  // The expression is interpolated into a Smalltalk string literal, so a quote
  // inside it would otherwise close that literal early and the rest would be
  // parsed as code.
  it('keeps a quoted expression inside its string literal', () => {
    const { execute, code } = capture();

    forkGemRunning(execute, "Transcript show: 'hi'", NRS);

    expect(code()).toContain("forkAndDetachString: 'Transcript show: ''hi'''");
  });
});
