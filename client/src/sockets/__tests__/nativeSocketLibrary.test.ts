import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NativeSocketLibrary } from '../nativeSocketLibrary';
import { createNativeSocketLibrary } from '../factory';
import { changeProcessPlatformDuring } from '../../__tests__/support/process';
import { onSupportedWindowsIt } from '../../__tests__/platformGates';
import { LoopbackConnection, openLoopbackConnection2 } from './support/loopbackConnection';

describe('Native socket library', () => {
  describe('Creating instances', () => {
    it('throws an error when a platform is not supported', () => {
      changeProcessPlatformDuring('aix', () => {
        expect(() => createNativeSocketLibrary()).toThrow('Unsupported platform: aix');
      });
    });
  });

  describe('Checking whether a socket is readable', () => {
    let fd: number;
    let loopbackConnection: LoopbackConnection;
    let library: NativeSocketLibrary;

    beforeEach(async () => {
      loopbackConnection = await openLoopbackConnection2();
      fd = loopbackConnection.fd;
      library = createNativeSocketLibrary();
    });

    afterEach(async () => {
      await loopbackConnection.close();
    });

    it('throws an error when polling an invalid file descriptor', () => {
      expect(() => library.isReadable(-1)).toThrow(library.invalidFileDescriptorErrorMessage(-1));
    });

    it('reports a socket readable when data is actually waiting on it', async () => {
      await loopbackConnection.write('hi');

      expect(library.isReadable(fd)).toBe(true);
    });

    it('reports a socket not readable when nothing has arrived yet', async () => {
      expect(library.isReadable(fd)).toBe(false);
    });

    // Windows-only: a stale-but-non-negative closed handle makes WSAPoll
    // return SOCKET_ERROR outright (see the closed-descriptor test below)
    // — a different code path than the one this test means to exercise.
    // Resetting the peer's connection is this suite's one way to produce a
    // dead-but-open handle through a real socket: it leaves the handle
    // itself open but errored, which reliably clears POLLRDNORM from
    // `revents` (the same as WSAPoll would for POLLHUP/POLLERR/POLLNVAL)
    // without touching the handle's validity. On POSIX, resolving `reset()`
    // only guarantees the peer has torn down its own socket, not that the
    // RST has reached and been processed by the client fd's kernel state by
    // the time `poll()` runs, so the same assertion is flaky there.
    onSupportedWindowsIt('throws an error when the socket is dead or errored', async () => {
      await loopbackConnection.reset();

      expect(() => library.isReadable(fd)).toThrow();
    });

    function expectToThrowReadableStatusFailedError() {
      expect(() => library.isReadable(fd)).toThrow(
        library.checkingReadableStatusFailedErrorMessage(fd, -1),
      );
    }

    // Unlike the reset case above, this closes the handle itself rather
    // than merely erroring the connection behind it: WSAPoll reliably
    // reports SOCKET_ERROR (not just a readiness bit) for an already-closed
    // handle, so this is the one real-socket way to exercise a genuine
    // WSAPoll() syscall failure rather than a mere unready/errored result.
    it('throws an error when the socket cannot be polled', async () => {
      await loopbackConnection.close();

      expectToThrowReadableStatusFailedError();
    });
  });
});
