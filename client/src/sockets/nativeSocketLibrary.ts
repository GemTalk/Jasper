// Registered once at module scope, rather than per instance: koffi's struct
// registry is process-wide, and re-declaring an already-registered name
// throws — which a second `NativePOSIXSocketLibrary` instance (e.g. after
// `NativeSocketLibrary.reset()`, as tests do) would hit if it lived inside
// the constructor.

/**
 * Picks and holds the shared {@link NativeSocketLibraryBase} instance for
 * the current OS. See that class for why a native poll is needed at all.
 */
export abstract class NativeSocketLibrary {
  /**
   * Reports whether the given socket currently has data ready to read,
   * without waiting.
   *
   * @param fd - OS-level file descriptor for an open socket.
   * @returns `true` if the socket is currently readable, `false` otherwise.
   * @throws {Error} If `fd` is negative, or if the readiness check itself fails.
   */
  public isReadable(fd: number): boolean {
    this.assertIsValidFileDescriptor(fd);

    const status = this.pollReadable(fd, 0);

    if (status < 0) {
      throw new Error(this.checkingReadableStatusFailedErrorMessage(fd, status));
    }

    return status > 0;
  }

  private assertIsValidFileDescriptor(fd: number) {
    if (fd < 0) {
      throw new Error(this.invalidFileDescriptorErrorMessage(fd));
    }
  }

  /**
   * Builds the message reported when {@link isReadable} is given a negative,
   * and therefore never valid, file descriptor.
   *
   * @param fd - The invalid file descriptor.
   * @returns The error message text.
   */
  public invalidFileDescriptorErrorMessage(fd: number) {
    return `Cannot check whether socket ${fd} is readable: the file descriptor must be greater than or equal to 0.`;
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
