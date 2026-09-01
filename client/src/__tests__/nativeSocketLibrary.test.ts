import { closeSync, openSync } from 'fs';
import { connect, Socket } from 'net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NativeSocketLibrary } from '../nativeSocketLibrary';
import { onSupportedPosixDescribe, onSupportedWindowsDescribe } from './platformGates';
import { changeProcessPlatformDuring } from './support/process';
import {
  LoopbackClient,
  LoopbackConnection,
  openLoopbackConnection as openLoopbackConnectionWith,
} from './support/loopbackConnection';
import { openRawLoopbackConnection } from './support/rawWindowsSocket';

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

/** The POSIX side of {@link ConnectLoopbackClient}: a real `net.Socket`, whose fd is read via {@link rawFdOf}. */
function connectPosixLoopbackClient(port: number): Promise<LoopbackClient> {
  return new Promise((resolve) => {
    const clientSocket = connect(port, '127.0.0.1');
    // The client under test is never read from, so a peer reset (used to
    // exercise the POLLHUP/POLLERR case below) arrives as an ECONNRESET
    // here. Node rethrows an un-listened-for socket 'error' as an
    // uncaught exception that would otherwise crash the whole test run.
    clientSocket.on('error', () => undefined);
    clientSocket.on('connect', () =>
      resolve({ fd: rawFdOf(clientSocket), disconnect: () => clientSocket.destroy() }),
    );
  });
}

/** Opens a real TCP loopback connection with a POSIX client. See {@link openLoopbackConnectionWith}. */
async function openLoopbackConnection(): Promise<LoopbackConnection> {
  return openLoopbackConnectionWith(connectPosixLoopbackClient);
}

/**
 * Opens a real TCP loopback connection and writes `data` from the server
 * side, resolving with the client socket's raw fd once the write has
 * actually flushed.
 *
 * @param data - Bytes to make available on the returned fd.
 * @returns The readable fd, and a `cleanup` callback to close both ends.
 */
async function openReadableSocket(
  data: string,
): Promise<{ fd: number; cleanup: () => Promise<void> }> {
  const { fd, write, close } = await openLoopbackConnection();

  await write(data);

  return { fd, cleanup: close };
}

/**
 * Opens a real TCP loopback connection and has the server side reset it,
 * resolving with the client socket's raw fd once the reset has actually
 * gone out.
 *
 * @returns The reset fd, and a `cleanup` callback to close both ends.
 */
async function openResetSocket(): Promise<{ fd: number; cleanup: () => Promise<void> }> {
  const { fd, reset, close } = await openLoopbackConnection();

  await reset();

  return { fd, cleanup: close };
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

      it('on POSIX, reports a socket readable when data is actually waiting on it', async () => {
        const { fd, cleanup } = await openReadableSocket('hi');

        try {
          const library = NativeSocketLibrary.forCurrentPlatform();

          expect(library.isReadable(fd)).toBe(true);
        } finally {
          await cleanup();
        }
      });

      it('on POSIX, reports a socket not readable when nothing has arrived yet', async () => {
        const { fd, close } = await openLoopbackConnection();

        try {
          const library = NativeSocketLibrary.forCurrentPlatform();

          expect(library.isReadable(fd)).toBe(false);
        } finally {
          await close();
        }
      });

      // Unlike the closed-descriptor case below, this leaves the fd itself
      // open and valid: poll() succeeds (status > 0) but reports
      // POLLHUP/POLLERR instead of POLLIN, so isReadable must treat that as
      // a failed check rather than acting on a dead socket. The
      // closed-descriptor case below is the only one that exercises poll()
      // itself failing (status < 0).
      it('on POSIX, throws rather than reporting readable when the connection has been reset, not merely unready', async () => {
        const { fd, cleanup } = await openResetSocket();

        try {
          const library = NativeSocketLibrary.forCurrentPlatform();

          expect(() => library.isReadable(fd)).toThrow();
        } finally {
          await cleanup();
        }
      });

      it('on POSIX, throws rather than reporting readable when the descriptor has already been closed, not merely unready', () => {
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
      let fd: number;
      let loopbackConnection: LoopbackConnection;
      let library: NativeSocketLibrary;

      beforeEach(async () => {
        loopbackConnection = await openRawLoopbackConnection();
        fd = loopbackConnection.fd;
        library = NativeSocketLibrary.forCurrentPlatform();
      });

      afterEach(async () => {
        await loopbackConnection.close();
      });

      it('on Windows, reports a socket readable when data is actually waiting on it', async () => {
        await loopbackConnection.write('hi');

        expect(library.isReadable(fd)).toBe(true);
      });

      it('on Windows, reports a socket not readable when nothing has arrived yet', async () => {
        expect(library.isReadable(fd)).toBe(false);
      });

      // Unlike the POSIX case above, this doesn't self-close the handle
      // under test: a stale-but-non-negative closed handle makes WSAPoll
      // return SOCKET_ERROR outright (see the closed-descriptor test below)
      // — a different code path than the one this test means to exercise.
      // Having the peer reset the connection instead leaves the handle
      // itself open but errored, which reliably clears POLLRDNORM from
      // `revents` without touching the handle's validity.
      it('on Windows, throws rather than reporting readable when the connection has been reset, not merely unready', async () => {
        await loopbackConnection.reset();

        expect(() => library.isReadable(fd)).toThrow();
      });

      // Unlike the reset case above, this closes the handle itself rather
      // than merely erroring the connection behind it: WSAPoll reliably
      // reports SOCKET_ERROR (not just a readiness bit) for an already-closed
      // handle, so this is the one real-socket way to exercise a genuine
      // WSAPoll() syscall failure rather than a mere unready/errored result.
      it('on Windows, throws rather than reporting readable when the descriptor has already been closed, not merely unready', async () => {
        await loopbackConnection.close();

        expect(() => library.isReadable(fd)).toThrow();
      });
    });
  });
});
