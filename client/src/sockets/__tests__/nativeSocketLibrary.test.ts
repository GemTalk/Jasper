import koffi from 'koffi';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NativeSocketLibrary } from '../nativeSocketLibrary';
import { NativePOSIXSocketLibrary } from '../nativePOSIXSocketLibrary';
import { PosixSocketLibrary } from '../bindings/posixSocketLibrary';
import { createNativeSocketLibrary } from '../factory';
import { changeProcessPlatformDuring } from '../../__tests__/support/process';
import {
  onSupportedPosixDescribe,
  onSupportedWindowsDescribe,
} from '../../__tests__/platformGates';
import { LoopbackConnection, openLoopbackConnection } from './support/loopbackConnection';

describe('Native socket library', () => {
  describe('Creating instances', () => {
    it('throws an error when a platform is not supported', () => {
      changeProcessPlatformDuring('aix', () => {
        expect(() => createNativeSocketLibrary()).toThrow('Unsupported platform: aix');
      });
    });
  });

  describe('Checking whether a socket is readable', () => {
    let fd: bigint;
    let loopbackConnection: LoopbackConnection;
    let library: NativeSocketLibrary;

    beforeEach(async () => {
      loopbackConnection = await openLoopbackConnection();
      fd = loopbackConnection.fd;
      library = createNativeSocketLibrary();
    });

    afterEach(async () => {
      await loopbackConnection.close();
    });

    it('reports a socket readable when data is actually waiting on it', async () => {
      await loopbackConnection.writeFromServer('hi');

      expect(library.isReadable(fd)).toBe(true);
    });

    it('reports a socket not readable when nothing has arrived yet', async () => {
      expect(library.isReadable(fd)).toBe(false);
    });

    it('throws an error when polling an invalid file descriptor', () => {
      expect(() => library.isReadable(library.invalidSocketDescriptor())).toThrow(
        library.invalidFileDescriptorErrorMessage(),
      );
    });

    onSupportedWindowsDescribe('Error handling on Windows', () => {
      // A stale-but-non-negative closed handle makes WSAPoll return
      // SOCKET_ERROR outright (see the "cannot be polled" test below), a
      // different code path than the one this test means to exercise.
      // Resetting the peer's connection is this suite's one way to produce a
      // dead-but-open handle through a real socket: it leaves the handle
      // itself open but errored, which reliably clears POLLRDNORM from
      // `revents` (the same as WSAPoll would for POLLHUP/POLLERR/POLLNVAL)
      // without touching the handle's validity. On POSIX, resolving
      // `resetFromServer()` only guarantees the peer has torn down its own
      // socket, not that the RST has reached and been processed by the
      // client fd's kernel state by the time `poll()` runs, so the same
      // assertion is flaky there.
      it('reports the socket as unusable when it has been reset by its peer', async () => {
        await loopbackConnection.resetFromServer();

        // POLLERR|POLLHUP (0x0001|0x0002 = 0x0003): the revents WSAPoll sets
        // for a reset connection, verified live via WSAPoll on Windows.
        expect(() => library.isReadable(fd)).toThrow(
          library.socketUnusableErrorMessage(fd, 0x0003),
        );
      });

      // Unlike the reset case above, this closes the handle itself rather
      // than merely erroring the connection behind it. This is the one
      // real-socket way to exercise a genuine WSAPoll() syscall failure (it
      // returns SOCKET_ERROR outright for an already-closed handle) rather
      // than a mere unready/errored result.
      it('reports the WSA diagnostic when the socket cannot be polled', async () => {
        await loopbackConnection.close();

        // WSAENOTSOCK (10038): what WSAPoll fails with for an already-closed
        // handle, verified live via WSAPoll on Windows.
        expect(() => library.isReadable(fd)).toThrow(
          library.pollFailedErrorMessage(fd, 'WSAGetLastError 10038'),
        );
      });
    });

    onSupportedPosixDescribe('Error handling on POSIX', () => {
      // Closing the handle doesn't fail poll() itself: POLLNVAL comes back
      // through revents on an otherwise-successful call, same as the
      // Windows reset case reports POLLHUP/POLLERR.
      it('reports the socket as unusable once its file descriptor has been closed', async () => {
        await loopbackConnection.close();

        // POLLNVAL (0x0020, standard across POSIX libc's <poll.h>), the one
        // revents bit a closed fd sets; verified live via poll() on macOS.
        expect(() => library.isReadable(fd)).toThrow(
          library.socketUnusableErrorMessage(fd, 0x0020),
        );
      });

      // No real socket condition reliably makes poll() itself fail (EFAULT/
      // EINTR/ENOMEM aren't safely triggerable), so this fakes the binding
      // directly rather than going through a real fd. koffi.errno() is the
      // real function, primed with a real POSIX error code, to check that
      // the thrown message reflects whatever poll() actually left there.
      it('reports the diagnostic when the poll syscall itself fails', () => {
        koffi.errno(koffi.os.errno.EBADF);
        const fakeLibrary = new NativePOSIXSocketLibrary({
          name: 'fake',
          poll: () => -1,
          POLLIN: 0x0001,
        } as unknown as PosixSocketLibrary);

        expect(() => fakeLibrary.isReadable(3n)).toThrow(
          fakeLibrary.pollFailedErrorMessage(3n, `errno ${koffi.os.errno.EBADF}`),
        );
      });
    });
  });
});
