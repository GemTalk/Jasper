import koffi, { KoffiFunction } from 'koffi';

// Registered once at module scope, rather than per instance: koffi's struct
// registry is process-wide, and re-declaring an already-registered name
// throws — which a second `NativeWindowsSocketLibrary`/`NativePOSIXSocketLibrary`
// instance (e.g. after `NativeSocketLibrary.reset()`, as tests do) would hit
// if these lived inside the constructor.
koffi.struct('WS2_WsaPollFd', {
  fd: 'uint64',
  events: 'int16',
  revents: 'int16',
});

koffi.struct('libc_PollFd', {
  fd: 'int',
  events: 'int16',
  revents: 'int16',
});

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
 */
export abstract class NativeSocketLibrary {
  private static instance?: NativeSocketLibrary;

  /**
   * Returns the shared socket library instance for the current OS,
   * creating it on first use.
   *
   * @returns The shared instance.
   * @throws {Error} If the current platform isn't supported.
   */
  public static forCurrentPlatform() {
    return (this.instance ||= this.createForCurrentPlatform());
  }

  /** Clears the shared instance, so the next call to {@link forCurrentPlatform} creates a fresh one. */
  public static reset() {
    this.instance = undefined;
  }

  /**
   * Creates a new socket library instance for the current OS.
   *
   * @returns The new instance.
   * @throws {Error} If the current platform isn't supported.
   */
  private static createForCurrentPlatform() {
    switch (process.platform) {
      case 'win32':
        return new NativeWindowsSocketLibrary();
      case 'darwin':
        return NativePOSIXSocketLibrary.forDarwin();
      case 'linux':
        return NativePOSIXSocketLibrary.forLinux();
      default:
        throw new Error(`Unsupported platform: ${process.platform}`);
    }
  }

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

class NativeWindowsSocketLibrary extends NativeSocketLibrary {
  private readonly POLLRDNORM = 0x0100;

  private readonly WSAPoll: KoffiFunction;

  /** @throws {Error} If the native polling primitive can't be loaded on this machine. */
  constructor() {
    super();
    this.WSAPoll = this.initializeWSAPollFunction();
  }

  /**
   * Loads the native primitive `pollReadable` polls through.
   *
   * @returns A callable bound to that primitive.
   * @throws {Error} If it can't be loaded on this machine.
   */
  private initializeWSAPollFunction() {
    const ws2 = koffi.load('ws2_32.dll');

    return ws2.func(
      'int __stdcall WSAPoll(_Inout_ WS2_WsaPollFd *fdArray, unsigned long fds, int timeout)',
    );
  }

  public pollReadable(fd: number, timeoutMs: number): number {
    // `pollFd` must stay in a variable, not an inline literal: koffi writes
    // WSAPoll's output back into this same object, and we need to read the
    // resulting `revents` below.
    const pollFd = { fd: BigInt(fd), events: this.POLLRDNORM, revents: 0 };
    const status = this.WSAPoll(pollFd, 1, timeoutMs);

    // A negative status means WSAPoll itself failed; 0 means it timed out
    // with nothing to report. Neither leaves a meaningful revents to check.
    if (status <= 0) {
      return status;
    }

    // WSAPoll counts the fd as having an event (status > 0) for POLLERR/
    // POLLHUP/POLLNVAL too, not just POLLRDNORM, so a positive status alone
    // doesn't mean the socket is readable. Only report readable when
    // POLLRDNORM is actually set; otherwise treat it as a failed check, so
    // the caller falls back to the authoritative result instead of acting on
    // a dead or errored socket.
    return pollFd.revents & this.POLLRDNORM ? status : -1;
  }
}

class NativePOSIXSocketLibrary extends NativeSocketLibrary {
  /**
   * Creates an instance for polling sockets on Linux.
   *
   * @throws {Error} If the native polling primitive can't be loaded on this machine.
   */
  public static forLinux() {
    return new NativePOSIXSocketLibrary('libc.so.6');
  }

  /**
   * Creates an instance for polling sockets on macOS.
   *
   * @throws {Error} If the native polling primitive can't be loaded on this machine.
   */
  public static forDarwin() {
    return new NativePOSIXSocketLibrary('libSystem.dylib');
  }

  private readonly POLLIN = 0x0001;
  private readonly libcPoll: KoffiFunction;

  /**
   * @param libraryName - name of the native library providing the poll primitive.
   * @throws {Error} If it can't be loaded on this machine.
   */
  constructor(libraryName: string) {
    super();
    this.libcPoll = this.initializePollFunction(libraryName);
  }

  /**
   * Loads the native primitive `pollReadable` polls through.
   *
   * @param libraryName - name of the native library providing the poll primitive.
   * @returns A callable bound to that primitive.
   * @throws {Error} If it can't be loaded on this machine.
   */
  private initializePollFunction(libraryName: string) {
    const libc = koffi.load(libraryName);

    return libc.func('int poll(_Inout_ libc_PollFd *fds, unsigned long nfds, int timeout)');
  }

  public pollReadable(fd: number, timeoutMs: number): number {
    // `pollFd` must stay in a variable, not an inline literal: koffi writes
    // poll()'s output back into this same object, and we need to read the
    // resulting `revents` below.
    const pollFd = { fd, events: this.POLLIN, revents: 0 };
    const status = this.libcPoll(pollFd, 1, timeoutMs);

    // A negative status means poll() itself failed; 0 means it timed out
    // with nothing to report. Neither leaves a meaningful revents to check.
    if (status <= 0) {
      return status;
    }

    // POSIX counts the fd as having an event (status > 0) for POLLERR/
    // POLLHUP/POLLNVAL too, not just POLLIN, so a positive status alone
    // doesn't mean the socket is readable. Only report readable when POLLIN
    // is actually set; otherwise treat it as a failed check, so the caller
    // falls back to the authoritative result instead of acting on a dead or
    // errored socket.
    return pollFd.revents & this.POLLIN ? status : -1;
  }
}
