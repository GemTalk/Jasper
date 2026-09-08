/** A raw, poll-able socket handle, and a way to close it. */
export type RawSocketConnection = {
  fd: bigint;
  disconnect: () => void;
};

/**
 * Cross-platform way to check whether a socket has data ready to read right
 * now, backed by libc's `poll()` on POSIX and `ws2_32`'s `WSAPoll()` on
 * Windows. It only ever answers "is this readable right now?"; it never
 * waits. It exists as a fallback for `GciLibrary` to add non-blocking
 * support on GCI versions where `GciTsNbPoll` isn't available.
 *
 * `fd` is a `bigint` everywhere in this API so the same signature can carry
 * either a POSIX file descriptor (a small int, narrowed back down in the
 * POSIX subclass since kernel fds are always small) or a Windows `SOCKET`
 * handle (a 64-bit value that doesn't fit in a `number`).
 */
export abstract class NativeSocketLibrary {
  /**
   * Reports whether the given socket currently has data ready to read,
   * without waiting.
   *
   * @param fd - OS-level file descriptor for an open socket.
   * @returns `true` if the socket has data ready, `false` if it doesn't yet.
   * @throws {Error} If `fd` is this platform's invalid file descriptor
   *   sentinel, if the poll syscall itself fails, or if it succeeds but
   *   reports the socket as errored, hung up, or otherwise unusable.
   */
  public abstract isReadable(fd: bigint): boolean;

  /**
   * The platform-specific sentinel value that marks a file descriptor as
   * never valid: POSIX's `-1`, or Windows' `INVALID_SOCKET`.
   *
   * @returns The invalid file descriptor sentinel for this platform.
   */
  public abstract invalidSocketDescriptor(): bigint;

  /**
   * Builds the message reported when a readiness check is given an invalid
   * file descriptor.
   *
   * @returns The error message text.
   */
  public invalidFileDescriptorErrorMessage() {
    return `Cannot check whether socket is readable: the file descriptor is not valid.`;
  }

  /**
   * Builds the message reported when the underlying readiness check itself
   * fails, as opposed to succeeding but reporting the socket unusable.
   *
   * @param fd - OS-level file descriptor the check was performed on.
   * @param diagnostic - platform-specific detail about the failure, e.g. an
   *   errno or a `WSAGetLastError` code.
   * @returns The error message text.
   */
  public pollFailedErrorMessage(fd: bigint, diagnostic: string) {
    return `Checking whether socket ${fd} is readable failed: the poll syscall itself failed (${diagnostic}).`;
  }

  /**
   * Builds the message reported when the readiness check succeeds but
   * reports the socket as errored, hung up, or otherwise unusable rather
   * than readable.
   *
   * @param fd - OS-level file descriptor the check was performed on.
   * @param revents - the `revents` bitmask the check reported.
   * @returns The error message text.
   */
  public socketUnusableErrorMessage(fd: bigint, revents: number) {
    return `Checking whether socket ${fd} is readable failed: the socket is in an unusable state (revents=0x${revents.toString(16).padStart(4, '0')}).`;
  }

  /**
   * Opens a real, poll-able client connection to 127.0.0.1:`port`. Production
   * code never opens its own sockets through this method; it exists for test
   * fixtures that need a genuine handle to check readiness against, rather
   * than a fake result.
   *
   * @param port - TCP port on the loopback interface to connect to.
   * @returns The connected handle, and a way to close it.
   * @throws {Error} If the connection can't be established.
   */
  public abstract connectRawSocket(port: number): Promise<RawSocketConnection>;

  /**
   * Throws the error for when the underlying readiness check itself fails,
   * as opposed to succeeding but reporting the socket unusable.
   *
   * @param fd - OS-level file descriptor the check was performed on.
   * @param diagnostic - platform-specific detail about the failure, e.g. an
   *   errno or a `WSAGetLastError` code.
   * @throws {Error} Always.
   */
  protected throwPollFailedError(fd: bigint, diagnostic: string): never {
    throw new Error(this.pollFailedErrorMessage(fd, diagnostic));
  }

  /**
   * Throws the error for when the readiness check succeeds but reports the
   * socket as errored, hung up, or otherwise unusable rather than readable.
   *
   * @param fd - OS-level file descriptor the check was performed on.
   * @param revents - the `revents` bitmask the check reported.
   * @throws {Error} Always.
   */
  protected throwUnusableSocketError(fd: bigint, revents: number): never {
    throw new Error(this.socketUnusableErrorMessage(fd, revents));
  }

  /**
   * Throws if `fd` is this platform's invalid file descriptor sentinel (see
   * {@link invalidSocketDescriptor}).
   *
   * @param fd - the file descriptor to validate.
   * @throws {Error} If `fd` is the invalid file descriptor sentinel.
   */
  protected assertIsValidFileDescriptor(fd: bigint): void {
    if (fd === this.invalidSocketDescriptor()) {
      throw new Error(this.invalidFileDescriptorErrorMessage());
    }
  }
}
