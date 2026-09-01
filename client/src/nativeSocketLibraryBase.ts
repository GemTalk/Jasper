/**
 * Checks whether a socket is readable via the OS's native `poll`/`WSAPoll`
 * primitive, for sockets owned by a native library rather than by Node
 * (e.g. `GciLibrary.socketFor`'s fd, which `libgcits` itself reads from).
 *
 * A native poll is required for such a socket because Node's own socket
 * APIs can't check readiness without disturbing the fd: constructing a
 * `net.Socket` from an existing fd unconditionally puts it into
 * non-blocking mode via libuv, regardless of the options passed, which
 * breaks a native library's own blocking reads on that same fd; and any
 * Node-level readiness signal (even a paused `'readable'` listener) works
 * by actually reading data into Node's internal buffer, stealing bytes the
 * native library's own read is waiting for. There is no Node API that
 * peeks at readiness without reading. A native `poll`/`WSAPoll` call only
 * asks the kernel whether a read would block, without reading anything or
 * changing the fd's blocking mode, leaving the fd exactly as its owner
 * left it.
 *
 * Kept in its own file, separate from `NativeSocketLibrary`: that class
 * constructs a `NativeWindowsSocketLibrary` (in its own file, for the
 * `win32` case), which in turn must `extends` this base — putting the base
 * in the same file as that construction would make the two files import
 * each other, and the subclass's `extends` would race the base class not
 * being defined yet.
 */
export abstract class NativeSocketLibraryBase {
  /**
   * Reports whether the given socket currently has data ready to read,
   * without waiting.
   *
   * @param fd - OS-level file descriptor for an open socket.
   * @returns `true` if the socket is currently readable, `false` otherwise.
   * @throws {Error} If the readiness check itself fails.
   */
  public isReadable(fd: number): boolean {
    const status = this.pollReadable(fd, 0);

    if (status < 0) {
      throw new Error(this.checkingReadableStatusFailedErrorMessage(fd, status));
    }

    return status > 0;
  }

  /**
   * Builds the message reported when checking a socket's readiness fails.
   *
   * @param fd - OS-level file descriptor the check was performed on.
   * @param status - The failing status code the readiness check produced.
   * @returns The error message text.
   */
  public checkingReadableStatusFailedErrorMessage(fd: number, status: number) {
    return `Checking whether socket ${fd} is readable failed (native poll returned ${status}).`;
  }

  /**
   * Polls the given socket for read-readiness, waiting up to `timeoutMs`
   * milliseconds.
   *
   * @param fd - OS-level file descriptor for an open socket.
   * @param timeoutMs - how long to wait for data before giving up, in
   *   milliseconds; 0 polls without waiting.
   * @returns A positive value if the socket is readable, 0 if the timeout
   *   elapsed with nothing ready, or a negative value if the check itself
   *   failed.
   */
  protected abstract pollReadable(fd: number, timeoutMs: number): number;
}
