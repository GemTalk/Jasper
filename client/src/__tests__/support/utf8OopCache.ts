import { expect, Mock, vi } from 'vitest';
import { GciLibrary } from '../../gciLibrary';

/**
 * Asserts that a fresh symbol lookup happens for `session` -- which it only
 * does while nothing has cached the Utf8 class oop on that session yet.
 *
 * Checks the looked-up session with `toBe`, not `toHaveBeenCalledWith`
 * -- koffi's session pointers have no enumerable properties, so
 * vitest's deep equality can't tell two different sessions apart and
 * would pass regardless of which one was actually used.
 *
 * @param session - The session expected to require a fresh lookup.
 * @param gciLibrary - The GCI bridge whose cache is under observation.
 */
export function expectUtf8OopToResolveViaSymbolLookup(session: unknown, gciLibrary: GciLibrary) {
  spyOnResolveSymbol(gciLibrary, (resolveSymbolSpy) => {
    gciLibrary.utf8ClassOop(session);

    expect(resolveSymbolSpy).toHaveBeenCalledTimes(1);
    const [calledSession, calledSymbol] = resolveSymbolSpy.mock.calls[0];
    expect(calledSession).toBe(session);
    expect(calledSymbol).toBe('Utf8');
  });
}

/**
 * Asserts `session`'s already-cached Utf8 oop is reused, without a fresh symbol lookup.
 *
 * @param session - The session expected to already hold the cached oop.
 * @param gciLibrary - The GCI bridge whose cache is under observation.
 */
export function expectUtf8OopToBeCached(session: unknown, gciLibrary: GciLibrary) {
  spyOnResolveSymbol(gciLibrary, (resolveSymbolSpy) => {
    gciLibrary.utf8ClassOop(session);

    expect(resolveSymbolSpy).not.toHaveBeenCalled();
  });
}

/** Spies on `resolveSymbol` for the duration of `callback`, then restores it. */
function spyOnResolveSymbol(
  gciLibrary: GciLibrary,
  callback: (spy: Mock<typeof GciLibrary.prototype.resolveSymbol>) => void,
) {
  const spy = vi.spyOn(gciLibrary, 'resolveSymbol');

  try {
    callback(spy);
  } finally {
    spy.mockRestore();
  }
}
