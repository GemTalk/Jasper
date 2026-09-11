import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { methodLabel } from '../methodResultsPicker';

/**
 * The prefix on every line a logpoint writes, so it has to stay short and read
 * the way Smalltalk writes a method.
 */
describe('methodLabel', () => {
  it('names an instance method the way Smalltalk does', () => {
    expect(
      methodLabel({ className: 'Account', isMeta: false, selector: 'deposit:', environmentId: 0 }),
    ).toBe('Account>>deposit:');
  });

  it('names a class-side method on its metaclass', () => {
    expect(
      methodLabel({ className: 'Account', isMeta: true, selector: 'new', environmentId: 0 }),
    ).toBe('Account class>>new');
  });

  it('says nothing about environment 0', () => {
    // Everything anyone ordinarily writes is in environment 0, so printing it
    // would be noise on every line of every logpoint.
    expect(
      methodLabel({ className: 'Account', isMeta: false, selector: 'x', environmentId: 0 }),
    ).not.toContain('env');
  });

  it('names any OTHER environment, because that is unusual enough to say', () => {
    expect(
      methodLabel({ className: 'Account', isMeta: false, selector: 'x', environmentId: 1 }),
    ).toBe('Account>>x [env 1]');
    expect(
      methodLabel({ className: 'Account', isMeta: true, selector: 'y', environmentId: 2 }),
    ).toBe('Account class>>y [env 2]');
  });
});
