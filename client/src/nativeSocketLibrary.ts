import koffi, { KoffiFunction } from 'koffi';
import { NativeSocketLibraryBase } from './nativeSocketLibraryBase';
import { NativeWindowsSocketLibrary } from './nativeWindowsSocketLibrary';

// Registered once at module scope, rather than per instance: koffi's struct
// registry is process-wide, and re-declaring an already-registered name
// throws — which a second `NativePOSIXSocketLibrary` instance (e.g. after
// `NativeSocketLibrary.reset()`, as tests do) would hit if it lived inside
// the constructor.
koffi.struct('libc_PollFd', {
  fd: 'int',
  events: 'int16',
  revents: 'int16',
});

/**
 * Picks and holds the shared {@link NativeSocketLibraryBase} instance for
 * the current OS. See that class for why a native poll is needed at all.
 */
export abstract class NativeSocketLibrary extends NativeSocketLibraryBase {
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
        return this.forWindows();
      case 'darwin':
        return NativePOSIXSocketLibrary.forDarwin();
      case 'linux':
        return NativePOSIXSocketLibrary.forLinux();
      default:
        throw new Error(`Unsupported platform: ${process.platform}`);
    }
  }

  /**
   * @returns A new `NativeWindowsSocketLibrary` instance.
   */
  public static forWindows(): NativeWindowsSocketLibrary {
    return new NativeWindowsSocketLibrary();
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
