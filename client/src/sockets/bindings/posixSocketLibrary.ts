import koffi, { KoffiFunction } from 'koffi';

export type PosixSocketLibrary = {
  name: string;
  poll: KoffiFunction;
  POLLIN: number;
};

let instance: PosixSocketLibrary | undefined;

export function posixSocketLibrary(libraryName: string): PosixSocketLibrary {
  if (instance && instance.name !== libraryName) {
    throw new Error('x');
  }

  return (instance ??= loadPosixSocketLibrary(libraryName));
}

function loadPosixSocketLibrary(libraryName: string): PosixSocketLibrary {
  const libc = koffi.load(libraryName);

  koffi.struct('libc_PollFd', {
    fd: 'int',
    events: 'int16',
    revents: 'int16',
  });

  return {
    name: libraryName,
    poll: libc.func('int poll(_Inout_ libc_PollFd *fds, unsigned long nfds, int timeout)'),
    POLLIN: 0x0001,
  };
}
