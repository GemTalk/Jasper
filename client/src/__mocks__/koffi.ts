import { vi } from 'vitest';

/** Resolves a koffi signature string (e.g. `GciSessionPtr GciTsLogin(const char *, ...)`)
 * to the native stub `GciLibrary` should bind for it. */
export type KoffiFuncMock = (signature: string) => unknown;

/**
 * Builds the `{ default: ... }` module shape `vi.mock('koffi', ...)` needs to
 * stand in for the real koffi module. `struct`/`array`/`opaque`/`pointer`/`union`/`load`
 * are identical for every caller — only how `func` resolves a signature string
 * to a native stub varies, so that's the one piece callers supply.
 */
export function mockKoffiModule(func: KoffiFuncMock) {
  const mockLib = {
    func: vi.fn(func),
    unload: vi.fn(),
  };
  return {
    default: {
      struct: vi.fn(() => 'MockStruct'),
      array: vi.fn(() => 'MockArray'),
      opaque: vi.fn(() => 'MockOpaque'),
      pointer: vi.fn(() => 'MockPointer'),
      union: vi.fn(() => 'MockUnion'),
      load: vi.fn(() => mockLib),
    },
  };
}
