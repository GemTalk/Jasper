import { NativeSocketLibrary, RawSocketConnection } from './nativeSocketLibrary';
import { windowsSocket2Library } from './bindings/windowsSocketLibrary';

/**
 * All `ws2_32.dll` bindings the extension needs live here: the `WSAPoll`
 * primitive {@link isReadable} polls production sockets through, plus the
 * raw `socket`/`connect`/`closesocket` calls test fixtures use to obtain a
 * genuine, `WSAPoll`-able handle (see {@link connectRawSocket}).
 */
export class NativeWindowsSocketLibrary extends NativeSocketLibrary {
  /**
   * Creates an instance backed by the given Windows polling bindings.
   *
   * @param ws2 - the polling bindings to use; defaults to the shared,
   *   lazily-loaded `ws2_32.dll` bindings.
   * @throws {Error} If the native bindings can't be loaded on this machine.
   */
  constructor(private readonly ws2 = windowsSocket2Library()) {
    super();
  }

  public invalidSocketDescriptor() {
    return this.ws2.INVALID_SOCKET;
  }

  public isReadable(fd: bigint): boolean {
    this.assertIsValidFileDescriptor(fd);

    // `pollFd` must stay in a variable, not an inline literal: koffi writes
    // WSAPoll's output back into this same object, and we need to read the
    // resulting `revents` below.
    const pollFd = { fd, events: this.ws2.POLLRDNORM, revents: 0 };
    const status = this.ws2.WSAPoll(pollFd, 1, 0);

    // A negative status means WSAPoll itself failed. Capture the reason
    // immediately, via WSAGetLastError(), before any other ws2_32.dll call
    // can overwrite it.
    if (status < 0) {
      this.throwPollFailedError(fd, `WSAGetLastError ${this.ws2.WSAGetLastError()}`);
    }

    // 0 means it timed out with nothing to report; there's no meaningful
    // revents to check.
    if (status === 0) {
      return false;
    }

    // WSAPoll counts the fd as having an event (status > 0) for POLLERR/
    // POLLHUP/POLLNVAL too, not just POLLRDNORM, so a positive status alone
    // doesn't mean the socket is readable. Only report readable when
    // POLLRDNORM is actually set; otherwise treat it as a failed check
    // rather than a false positive on a dead or errored socket.
    if (!(pollFd.revents & this.ws2.POLLRDNORM)) {
      this.throwUnusableSocketError(fd, pollFd.revents);
    }

    return true;
  }

  /**
   * Opens a real client `SOCKET` to 127.0.0.1:`port`, bypassing Node's `net`
   * module entirely.
   *
   * This is the only way to get a real, `WSAPoll`-able socket handle on
   * Windows: Node's `net.Socket` doesn't expose one (`.fd`/`_handle.fd` is
   * known to return `-1` there, since Windows sockets aren't in the same
   * handle namespace as POSIX fds/CRT descriptors), so a `net.Socket` can't
   * stand in for the kind of handle production code actually polls for
   * readiness. Production code never opens its own sockets through this
   * method; it exists for test fixtures that need such a handle.
   *
   * Relies on Winsock already being initialized: libuv calls `WSAStartup`
   * while setting up Node's own event loop on Windows, before any user code
   * runs, so no separate `WSAStartup` call is needed here.
   *
   * @param port - TCP port on the loopback interface to connect to.
   * @returns The connected socket's raw handle, and a way to close it.
   * @throws {Error} If the native `socket()` or `connect()` call fails.
   */
  public async connectRawSocket(port: number): Promise<RawSocketConnection> {
    // Koffi only returns a BigInt for a `uint64` when the value actually
    // needs one; a small handle value comes back as a plain Number, so it
    // must be normalized here to match `RawSocketConnection.fd`'s `bigint`
    // type (and the `INVALID_SOCKET` comparison below).
    const handle = BigInt(
      this.ws2.socket(this.ws2.AF_INET, this.ws2.SOCK_STREAM, this.ws2.IPPROTO_TCP) as
        number | bigint,
    );
    if (handle === this.ws2.INVALID_SOCKET) {
      throw new Error(`socket() failed (WSAGetLastError ${this.ws2.WSAGetLastError()})`);
    }

    const address = {
      family: this.ws2.AF_INET,
      portBytes: [(port >> 8) & 0xff, port & 0xff],
      addrBytes: [127, 0, 0, 1],
      zero: [0, 0, 0, 0, 0, 0, 0, 0],
    };

    const status = this.ws2.connect(handle, address, this.ws2.SOCKADDR_IN_SIZE) as number;
    if (status === this.ws2.SOCKET_ERROR) {
      const error = this.ws2.WSAGetLastError();
      this.ws2.closesocket(handle);
      throw new Error(`connect() failed (WSAGetLastError ${error})`);
    }

    return { fd: handle, disconnect: () => this.ws2.closesocket(handle) };
  }
}
