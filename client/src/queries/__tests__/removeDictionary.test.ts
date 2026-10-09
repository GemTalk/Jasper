import { describe, it, expect, vi } from 'vitest';
import { removeDictionary } from '../removeDictionary';
import { clearClassOrganizerStatement } from '../classOrganizer';

/**
 * Removing a dictionary takes every class in it off the symbol list, so the cached ClassOrganizer
 * the hierarchy and search queries read (classOrganizer.ts) still lists classes nothing binds any
 * more. It has to be dropped in the same doit, as Jasper's own class deletion does.
 */
describe('removeDictionary', () => {
  it('drops the cached class list in the doit that removes the dictionary', () => {
    const exec = vi.fn().mockReturnValue('Removed dictionary: Extras');

    removeDictionary(exec, 3);

    expect(String(exec.mock.calls[0][0])).toContain(clearClassOrganizerStatement());
  });
});
