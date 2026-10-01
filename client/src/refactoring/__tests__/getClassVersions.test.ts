import { describe, it, expect, vi } from 'vitest';
import { getClassVersions } from '../queries/getClassVersions';

describe('getClassVersions query', () => {
  it('maps each returned class to its current/total version position', async () => {
    const execute = vi.fn().mockReturnValue('Account\t2\t3\nWidget\t3\t3\n');

    const versions = await getClassVersions(execute, 3);

    expect(versions.get('Account')).toEqual({ current: 2, total: 3 });
    expect(versions.get('Widget')).toEqual({ current: 3, total: 3 });
  });

  it('omits classes the engine did not report as multi-version', async () => {
    const execute = vi.fn().mockReturnValue('Account\t2\t3\n');

    const versions = await getClassVersions(execute, 3);

    expect(versions.has('Ledger')).toBe(false);
    expect(versions.size).toBe(1);
  });

  it('reads the class history so single-version classes are filtered server-side', async () => {
    const execute = vi.fn().mockReturnValue('');

    await getClassVersions(execute, 3);

    const code = execute.mock.calls[0][0];
    expect(code).toContain('classHistory');
    expect(code).toContain('hist size > 1');
    expect(code).toContain('hist indexOf: v');
    expect(code).toContain('print: hist size');
  });

  it('scopes the lookup to a dictionary index when given a number', async () => {
    const execute = vi.fn().mockReturnValue('');

    await getClassVersions(execute, 3);

    const code = execute.mock.calls[0][0];
    expect(code).toContain('System myUserProfile symbolList at: 3');
  });

  it('resolves the dictionary by name when given a string', async () => {
    const execute = vi.fn().mockReturnValue('');

    await getClassVersions(execute, 'UserGlobals');

    const code = execute.mock.calls[0][0];
    expect(code).toContain("objectNamed: #'UserGlobals'");
  });

  it('ignores a malformed line missing the total', async () => {
    const execute = vi.fn().mockReturnValue('Account\t2\t3\nBadLineNoTotal\t2\n');

    const versions = await getClassVersions(execute, 3);

    expect(versions.size).toBe(1);
    expect(versions.get('Account')).toEqual({ current: 2, total: 3 });
  });
});
