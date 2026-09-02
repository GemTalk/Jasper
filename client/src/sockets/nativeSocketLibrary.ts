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

    return this.hasDataReady(fd);
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
   * Builds the message reported when the underlying poll syscall itself
   * fails, as opposed to succeeding but reporting the socket unusable (see
   * {@link socketUnusableErrorMessage}).
   *
   * @param fd - OS-level file descriptor the check was performed on.
   * @param diagnostic - platform-specific detail about the failure, e.g. an
   *   errno or a `WSAGetLastError` code.
   * @returns The error message text.
   */
  public pollSyscallFailedErrorMessage(fd: number, diagnostic: string) {
    return `Checking whether socket ${fd} is readable failed: the poll syscall itself failed (${diagnostic}).`;
  }

  /**
   * Builds the message reported when polling succeeds but reports the
   * socket as errored, hung up, or otherwise unusable rather than readable.
   *
   * @param fd - OS-level file descriptor the check was performed on.
   * @param revents - the `revents` bitmask the poll call reported.
   * @returns The error message text.
   */
  public socketUnusableErrorMessage(fd: number, revents: number) {
    return `Checking whether socket ${fd} is readable failed: the socket is in an unusable state (revents=0x${revents.toString(16).padStart(4, '0')}).`;
  }

  /**
   * Polls the given socket for read-readiness, without waiting.
   *
   * @param fd - OS-level file descriptor for an open socket.
   * @returns `true` if the socket is currently readable, `false` if the
   *   check found nothing ready.
   * @throws {Error} If the poll syscall itself fails, or if it succeeds but
   *   reports the socket as errored, hung up, or otherwise unusable.
   */
  protected abstract hasDataReady(fd: number): boolean;
}
