import { closeSync, openSync } from 'fs';
import { connect, createServer, Socket } from 'net';
import { describe, expect, it, afterEach } from 'vitest';
import { NativeSocketLibrary } from '../nativeSocketLibrary';
import { onSupportedPosixDescribe, onSupportedWindowsDescribe } from './platformGates';
import { changeProcessPlatformDuring } from './support/process';
import {
  openRawReadableSocket,
  openRawLoopbackConnection,
  openRawResetSocket,
  openRawClosedSocket,
} from './support/rawWindowsSocket';

/** A `NativeSocketLibrary` whose `poll` returns a fixed, caller-chosen status. */
class FakeSocketLibrary extends NativeSocketLibrary {
  constructor(private readonly pollResult: number) {
    super();
  }

  protected pollReadable(): number {
    return this.pollResult;
  }
}

/**
 * Returns `socket`'s underlying OS file descriptor. There's no public API
 * for this — `_handle.fd` is an internal Node property — but it's exactly
 * the kind of fd `GciLibrary.socketFor` hands to `NativeSocketLibrary` in
 * production, so it's the only way to test the real poll/WSAPoll call
 * against a genuine socket rather than a fake `pollReadable`.
 */
function rawFdOf(socket: Socket): number {
  return (socket as unknown as { _handle: { fd: number } })._handle.fd;
}

/**
 * Opens a real TCP loopback connection and resolves with the client
 * socket's raw fd, a `writeFromPeer` callback to send bytes from the server
 * side, and a `cleanup` callback to close both ends. The client socket is
 * never read from, so any bytes sent stay at the OS level rather than being
 * drained into Node's own buffer — leaving the fd's readiness exactly as a
 * real `poll`/`WSAPoll` caller would see it.
 */
async function openLoopbackConnection(): Promise<{
  fd: number;
  writeFromPeer: (data: string) => void;
  cleanup: () => void;
}> {
  return new Promise((resolve) => {
    const server = createServer();
    let serverSocket: Socket | undefined;
    let client: Socket | undefined;

    const resolveOnceBothEndsAreUp = () => {
      if (serverSocket && client) {
        resolve({
          fd: rawFdOf(client),
          writeFromPeer: (data) => serverSocket!.end(data),
          cleanup: () => {
            client!.destroy();
            server.close();
          },
        });
      }
    };

    server.on('connection', (socket) => {
      serverSocket = socket;
      resolveOnceBothEndsAreUp();
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('Expected the loopback server to report a network address');
      }

      client = connect(address.port, '127.0.0.1');
      client.on('connect', resolveOnceBothEndsAreUp);
    });
  });
}

/**
 * Opens a real TCP loopback connection, writes `data` from the server side,
 * and resolves with the client socket's raw fd once the bytes have had time
 * to land in the OS receive buffer.
 *
 * @param data - Bytes to make available on the returned fd.
 * @returns The readable fd, and a `cleanup` callback to close both ends.
 */
async function openReadableSocket(data: string): Promise<{ fd: number; cleanup: () => void }> {
  const { fd, writeFromPeer, cleanup } = await openLoopbackConnection();

  writeFromPeer(data);
  await new Promise((resolve) => setTimeout(resolve, 50));

  return { fd, cleanup };
}

describe('Native socket library', () => {
  afterEach(() => NativeSocketLibrary.reset());

  describe('Creating instances', () => {
    it('reuses the same instance across calls', () => {
      const instance = NativeSocketLibrary.forCurrentPlatform();
      const anotherInstance = NativeSocketLibrary.forCurrentPlatform();

      expect(anotherInstance).toBe(instance);
    });

    it('throws an error when a platform is not supported', () => {
      changeProcessPlatformDuring('aix', () => {
        expect(() => NativeSocketLibrary.forCurrentPlatform()).toThrow('Unsupported platform: aix');
      });
    });
  });

  describe('Checking whether a socket is readable', () => {
    describe('using a fake pollReadable', () => {
      it('reports a socket is readable when the poll finds it readable', () => {
        const library = new FakeSocketLibrary(1);

        expect(library.isReadable(0)).toBe(true);
      });

      it('reports a socket not readable when the poll times out', () => {
        const library = new FakeSocketLibrary(0);

        expect(library.isReadable(0)).toBe(false);
      });

      it('throws an error when the poll call fails', () => {
        const library = new FakeSocketLibrary(-1);

        expect(() => library.isReadable(0)).toThrow(
          library.checkingReadableStatusFailedErrorMessage(0, -1),
        );
      });
    });

    // POSIX-only: a real, pollable fd requires one Node's `net.Socket`
    // actually exposes, and `.fd`/`_handle.fd` is documented to return -1 on
    // Windows (Windows sockets aren't in the same fd-namespace as POSIX
    // files). The Windows equivalent of this block, below, opens a real
    // socket a different way.
    onSupportedPosixDescribe('using a real socket and the real native poll call', () => {
      // No case here for a genuirene poll() syscall failure (the fake
      // library's "throws an error when the poll call fails" above):
      // `isReadable` always polls with a 0ms timeout, so there's no
      // reliable window to land e.g. an EINTR signal, and no other POSIX
      // errno (EBADF/EFAULT/EINVAL) arises from a legitimate fd and args.
      // That branch is exercised only by the fake.

      it('reports a socket readable when data is actually waiting on it', async () => {
        const { fd, cleanup } = await openReadableSocket('hi');

        try {
          const library = NativeSocketLibrary.forCurrentPlatform();

          expect(library.isReadable(fd)).toBe(true);
        } finally {
          cleanup();
        }
      });

      it('reports a socket not readable when nothing has arrived yet', async () => {
        const { fd, cleanup } = await openLoopbackConnection();

        try {
          const library = NativeSocketLibrary.forCurrentPlatform();

          expect(library.isReadable(fd)).toBe(false);
        } finally {
          cleanup();
        }
      });

      it('throws rather than reporting readable when the fd is invalid, not merely unready', () => {
        const fd = openSync('/dev/null', 'r');
        closeSync(fd);
        const library = NativeSocketLibrary.forCurrentPlatform();

        expect(() => library.isReadable(fd)).toThrow();
      });
    });

    // Windows-only: a real, `WSAPoll`-able socket handle requires bypassing
    // Node's `net.Socket` entirely (its `.fd`/`_handle.fd` is documented to
    // return -1 on Windows), so this drives `ws2_32.dll`'s own
    // `socket`/`connect` directly. See `support/rawWindowsSocket.ts`.
    onSupportedWindowsDescribe('using a real socket and the real native WSAPoll call', () => {
      it('reports a Windows socket readable when data is actually waiting on it', async () => {
        const { fd, cleanup } = await openRawReadableSocket('hi');

        try {
          const library = NativeSocketLibrary.forCurrentPlatform();

          expect(library.isReadable(fd)).toBe(true);
        } finally {
          cleanup();
        }
      });

      it('reports a Windows socket not readable when nothing has arrived yet', async () => {
        const { fd, cleanup } = await openRawLoopbackConnection();

        try {
          const library = NativeSocketLibrary.forCurrentPlatform();

          expect(library.isReadable(fd)).toBe(false);
        } finally {
          cleanup();
        }
      });

      // Unlike the POSIX case above, this doesn't self-close the handle
      // under test: a stale-but-non-negative closed handle makes WSAPoll
      // return SOCKET_ERROR outright (see the closed-handle test below) — a
      // different code path than the one this test means to exercise.
      // Having the peer reset the connection instead leaves the handle
      // itself open but errored, which reliably clears POLLRDNORM from
      // `revents` without touching the handle's validity.
      it('throws rather than reporting readable when the connection has been reset, not merely unready', async () => {
        const { fd, cleanup } = await openRawResetSocket();

        try {
          const library = NativeSocketLibrary.forCurrentPlatform();

          expect(() => library.isReadable(fd)).toThrow();
        } finally {
          cleanup();
        }
      });

      // Unlike the reset case above, this closes the handle itself rather
      // than merely erroring the connection behind it: WSAPoll reliably
      // reports SOCKET_ERROR (not just a readiness bit) for an already-closed
      // handle, so this is the one real-socket way to exercise a genuine
      // WSAPoll() syscall failure rather than a mere unready/errored result.
      it('throws rather than reporting readable when the handle has already been closed', async () => {
        const { fd, cleanup } = await openRawClosedSocket();

        try {
          const library = NativeSocketLibrary.forCurrentPlatform();

          expect(() => library.isReadable(fd)).toThrow();
        } finally {
          cleanup();
        }
      });
    });
  });
});
