import { describe, it, expect, vi } from 'vitest';

import { loginHasSession, stopSessionOfLogin } from '../sessionOfLogin';

describe('loginHasSession', () => {
  it("asks whether the login's serial still has that session number", () => {
    const execute = vi.fn((_code: string) => 'true');
    expect(loginHasSession(execute, 7, 12)).toBe(true);
    expect(execute.mock.calls[0][0]).toMatch(
      /descriptionOfSessionSerialNum: 12\. \(\(d at: 10\) = 7\) printString$/,
    );
  });

  it('checks the gem process too, when given', () => {
    const execute = vi.fn((_code: string) => 'false');
    expect(loginHasSession(execute, 7, 12, 39811)).toBe(false);
    expect(execute.mock.calls[0][0]).toContain('(d at: 10) = 7 and: [(d at: 2) = 39811]');
  });
});

describe('stopSessionOfLogin', () => {
  it('stops the session only while the login still has it, and says whether it did', () => {
    const execute = vi.fn((_code: string) => 'true');
    expect(stopSessionOfLogin(execute, 7, 12)).toBe(true);
    expect(execute.mock.calls[0][0]).toBe(
      '| now | now := (System descriptionOfSessionSerialNum: 12) at: 10. ' +
        'now = 7 ifTrue: [System stopSession: now]. (now = 7) printString',
    );
  });

  it('answers false once the number has passed to another login', () => {
    expect(stopSessionOfLogin(() => 'false', 7, 12)).toBe(false);
  });
});
