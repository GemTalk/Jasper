import { NativeSocketLibrary } from '../../sockets/nativeSocketLibrary';

/**
 * A `NativeSocketLibrary` stub for unit tests that construct a `GciLibrary`
 * but never poll a socket's readiness. Passing it explicitly keeps
 * `GciLibrary`'s constructor from calling `createNativeSocketLibrary()`,
 * which loads the real platform library (and, on Windows, real `koffi` --
 * unavailable once a test has mocked that module).
 *
 * @throws {Error} If `isReadable` is called -- no test using this stub
 *   should be exercising socket readiness.
 */
export function fakeNativeSocketLibrary(): NativeSocketLibrary {
  return {
    isReadable: () => {
      throw new Error('fakeNativeSocketLibrary.isReadable was called unexpectedly');
    },
  } as unknown as NativeSocketLibrary;
}
