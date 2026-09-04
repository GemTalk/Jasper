import koffi, { KoffiFunction } from 'koffi';

export type PosixSocketLibrary = {
  name: string;
  poll: KoffiFunction;
  POLLIN: number;
};

let instance: PosixSocketLibrary | undefined;

/**
 * Returns the shared POSIX polling library loaded from `libraryName`,
 * loading it on first use.
 *
 * @param libraryName - the shared library to load the polling primitive from.
 * @param nfdsType - the C type of `poll()`'s `nfds` parameter on this
 * platform, since it isn't uniform across POSIX libc implementations.
 * @returns the loaded library's bindings.
 * @throws {Error} If already loaded under a different library name, or if
 * the library itself can't be loaded on this machine.
 */
export function posixSocketLibrary(
  libraryName: string,
  nfdsType: 'unsigned int' | 'unsigned long',
): PosixSocketLibrary {
  if (instance && instance.name !== libraryName) {
    throw new Error(
      `posixSocketLibrary already loaded as '${instance.name}', cannot reload as '${libraryName}'`,
    );
  }

  return (instance ??= loadPosixSocketLibrary(libraryName, nfdsType));
}

/**
 * Loads `libraryName` and builds the polling primitive it exposes.
 *
 * @param libraryName - the shared library to load.
 * @param nfdsType - the C type of `poll()`'s `nfds` parameter on this platform.
 * @returns the loaded library's bindings.
 * @throws {Error} If the library can't be loaded on this machine.
 */
function loadPosixSocketLibrary(
  libraryName: string,
  nfdsType: 'unsigned int' | 'unsigned long',
): PosixSocketLibrary {
  const libc = koffi.load(libraryName);

  koffi.struct('libc_PollFd', {
    fd: 'int',
    events: 'int16',
    revents: 'int16',
  });

  return {
    name: libraryName,
    poll: libc.func(`int poll(_Inout_ libc_PollFd *fds, ${nfdsType} nfds, int timeout)`),
    POLLIN: 0x0001,
  };
}
