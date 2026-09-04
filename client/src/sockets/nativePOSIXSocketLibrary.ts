import koffi from 'koffi';
import { connect, Socket } from 'net';
import { PosixSocketLibrary, posixSocketLibrary } from './bindings/posixSocketLibrary';
import { NativeSocketLibrary, RawSocketConnection } from './nativeSocketLibrary';

export class NativePOSIXSocketLibrary extends NativeSocketLibrary {
  public invalidSocketDescriptor(): bigint {
    return -1n;
  }
  /**
   * Creates an instance for polling sockets on Linux.
   *
   * @throws {Error} If the native polling primitive can't be loaded on this machine.
   */
  public static forLinux() {
    return new NativePOSIXSocketLibrary(posixSocketLibrary('libc.so.6', 'unsigned long'));
  }

  /**
   * Creates an instance for polling sockets on macOS.
   *
   * @throws {Error} If the native polling primitive can't be loaded on this machine.
   */
  public static forDarwin() {
    return new NativePOSIXSocketLibrary(posixSocketLibrary('libSystem.dylib', 'unsigned int'));
  }

  /**
   * Creates an instance backed by the given POSIX polling bindings.
   *
   * @param posixSocketLibrary - the polling bindings to use.
   */
  constructor(private posixSocketLibrary: PosixSocketLibrary) {
    super();
  }

  public isReadable(fd: bigint): boolean {
    this.assertIsValidFileDescriptor(fd);

    // `pollFd` must stay in a variable, not an inline literal: koffi writes
    // poll()'s output back into this same object, and we need to read the
    // resulting `revents` below. POSIX fds are always small ints by OS
    // design, so narrowing to `Number` here is safe even though `fd` is a
    // `bigint` at the API boundary (matching Windows' 64-bit handles).
    const pollFd = { fd: Number(fd), events: this.posixSocketLibrary.POLLIN, revents: 0 };
    const status = this.posixSocketLibrary.poll(pollFd, 1, 0);

    // A negative status means poll() itself failed. Capture the reason
    // immediately, via koffi.errno(), before any other native call can
    // overwrite it.
    if (status < 0) {
      this.throwPollFailedError(fd, `errno ${koffi.errno()}`);
    }

    // 0 means it timed out with nothing to report; there's no meaningful
    // revents to check.
    if (status === 0) {
      return false;
    }

    // POSIX counts the fd as having an event (status > 0) for POLLERR/
    // POLLHUP/POLLNVAL too, not just POLLIN, so a positive status alone
    // doesn't mean the socket is readable. Only report readable when POLLIN
    // is actually set; otherwise treat it as a failed check rather than a
    // false positive on a dead or errored socket.
    if (!(pollFd.revents & this.posixSocketLibrary.POLLIN)) {
      this.throwUnusableSocketError(fd, pollFd.revents);
    }

    return true;
  }

  /**
   * Opens a real client socket to 127.0.0.1:`port` and reads back its
   * underlying OS file descriptor: the same kind of fd production code
   * checks for readiness, so this is the only way to test that check
   * against a genuine socket rather than a fake result.
   *
   * @param port - TCP port on the loopback interface to connect to.
   * @returns The connected socket's raw fd, and a way to close it.
   * @throws {Error} If the connection can't be established.
   */
  public connectRawSocket(port: number): Promise<RawSocketConnection> {
    return new Promise((resolve, reject) => {
      const clientSocket = connect(port, '127.0.0.1');
      // Without this, libuv still drains bytes off the fd into Node's
      // internal buffer in the background even though nothing here ever
      // calls `.on('data', ...)`, which clears the OS-level readiness a
      // moment after data arrives. Pausing stops that background read so
      // the fd's readiness reflects only what a real `poll`/`WSAPoll`
      // caller would see, matching the doc comment above.
      clientSocket.pause();
      // The client under test is never read from, so a peer reset (used to
      // exercise the POLLHUP/POLLERR case) arrives as an ECONNRESET here,
      // after 'connect' already resolved the promise; rejecting at that
      // point is a no-op. Node rethrows an un-listened-for socket 'error' as
      // an uncaught exception that would otherwise crash the whole test run.
      clientSocket.on('error', (error) => reject(error));
      clientSocket.on('connect', () =>
        resolve({
          fd: BigInt(this.rawFdOf(clientSocket)),
          disconnect: () => clientSocket.destroy(),
        }),
      );
    });
  }

  /**
   * Returns `socket`'s underlying OS file descriptor, reached through an
   * internal Node property since there's no public API for it.
   *
   * @param socket - the connected socket to read the descriptor from.
   * @returns the socket's raw file descriptor.
   */
  private rawFdOf(socket: Socket): number {
    return (socket as unknown as { _handle: { fd: number } })._handle.fd;
  }
}
