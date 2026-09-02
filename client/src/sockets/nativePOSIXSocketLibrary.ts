import koffi from 'koffi';
import { PosixSocketLibrary, posixSocketLibrary } from './bindings/posixSocketLibrary';
import { NativeSocketLibrary } from './nativeSocketLibrary';

export class NativePOSIXSocketLibrary extends NativeSocketLibrary {
  /**
   * Creates an instance for polling sockets on Linux.
   *
   * @throws {Error} If the native polling primitive can't be loaded on this machine.
   */
  public static forLinux() {
    return new NativePOSIXSocketLibrary(posixSocketLibrary('libc.so.6'));
  }

  /**
   * Creates an instance for polling sockets on macOS.
   *
   * @throws {Error} If the native polling primitive can't be loaded on this machine.
   */
  public static forDarwin() {
    return new NativePOSIXSocketLibrary(posixSocketLibrary('libSystem.dylib'));
  }

  /**
   * @param libraryName - name of the native library providing the poll primitive.
   * @throws {Error} If it can't be loaded on this machine.
   */
  constructor(private posixSocketLibrary: PosixSocketLibrary) {
    super();
  }

  public hasDataReady(fd: number): boolean {
    // `pollFd` must stay in a variable, not an inline literal: koffi writes
    // poll()'s output back into this same object, and we need to read the
    // resulting `revents` below.
    const pollFd = { fd, events: this.posixSocketLibrary.POLLIN, revents: 0 };
    const status = this.posixSocketLibrary.poll(pollFd, 1, 0);

    // A negative status means poll() itself failed. Capture the reason
    // immediately, via koffi.errno(), before any other native call can
    // overwrite it.
    if (status < 0) {
      throw new Error(this.pollSyscallFailedErrorMessage(fd, `errno ${koffi.errno()}`));
    }

    // 0 means it timed out with nothing to report; there's no meaningful
    // revents to check.
    if (status === 0) {
      return false;
    }

    // POSIX counts the fd as having an event (status > 0) for POLLERR/
    // POLLHUP/POLLNVAL too, not just POLLIN, so a positive status alone
    // doesn't mean the socket is readable. Only report readable when POLLIN
    // is actually set; otherwise treat it as a failed check, so the caller
    // falls back to the authoritative result instead of acting on a dead or
    // errored socket.
    if (!(pollFd.revents & this.posixSocketLibrary.POLLIN)) {
      throw new Error(this.socketUnusableErrorMessage(fd, pollFd.revents));
    }

    return true;
  }
}
