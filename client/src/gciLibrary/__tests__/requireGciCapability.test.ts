import { describe, expect, it, vi } from 'vitest';
import type { TestContext } from 'vitest';
import type { GciLibrary } from '../../gciLibrary';
import { requireGciCapability } from './requireGciCapability';

const fakeCtx = () => {
  const skip = vi.fn();
  return { ctx: { skip } as unknown as TestContext, skip };
};

const libraryWith = (available: boolean) =>
  ({ isAvailable: () => available }) as unknown as GciLibrary;

describe('requireGciCapability', () => {
  it('skips, naming the symbol and its hazard, when the library lacks it', () => {
    const { ctx, skip } = fakeCtx();

    requireGciCapability('GciTsNbLogin_', ctx, libraryWith(false));

    expect(skip).toHaveBeenCalledWith(true, expect.stringContaining('GciTsNbLogin_'));
    const [, reason] = skip.mock.calls[0] as [boolean, string];
    expect(reason).toContain('absent before 3.7.4.1');
    expect(reason).toContain('Windows client library');
  });

  it('does not skip when the library has it', () => {
    const { ctx, skip } = fakeCtx();

    requireGciCapability('GciTsNbLogin_', ctx, libraryWith(true));

    expect(skip).toHaveBeenCalledWith(false, expect.any(String));
  });
});
