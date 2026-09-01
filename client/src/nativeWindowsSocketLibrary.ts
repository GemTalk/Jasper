import koffi, { KoffiFunction } from 'koffi';
import { NativeSocketLibraryBase } from './nativeSocketLibraryBase';

// Registered once at module scope, rather than per instance: koffi's struct
// registry is process-wide, and re-declaring an already-registered name
// throws — which a second `NativeWindowsSocketLibrary` instance (e.g. after
// `NativeSocketLibrary.reset()`, as tests do) would hit if these lived
// inside the constructor.
koffi.struct('WS2_WsaPollFd', {
  fd: 'uint64',
  events: 'int16',
  revents: 'int16',
});

// A minimal `sockaddr_in`: 2-byte family, 2-byte port, 4-byte address, 8
// bytes of zero padding — 16 bytes total, matching the real struct's layout
// exactly. Port and address are declared as raw byte arrays rather than
// `uint16`/`uint32` so the network-byte-order bytes written are exactly the
// bytes koffi puts in memory, regardless of the host's own endianness.
koffi.struct('WS2_RawSockAddrIn', {
  family: 'uint16',
  portBytes: 'uint8[2]',
  addrBytes: 'uint8[4]',
  zero: 'uint8[8]',
});

const AF_INET = 2;
const SOCK_STREAM = 1;
const IPPROTO_TCP = 6;
const INVALID_SOCKET = 0xffffffffffffffffn;
const SOCKET_ERROR = -1;

/**
 * All `ws2_32.dll` bindings the extension needs live here: the `WSAPoll`
 * primitive {@link pollReadable} polls production sockets through, plus the
 * raw `socket`/`connect`/`closesocket` calls test fixtures use to obtain a
 * genuine, `WSAPoll`-able handle (see {@link connectRawSocket}).
 */
export class NativeWindowsSocketLibrary extends NativeSocketLibraryBase {
  private readonly POLLRDNORM = 0x0100;

  private readonly WSAPoll: KoffiFunction;
  private readonly wsaSocket: KoffiFunction;
  private readonly wsaConnect: KoffiFunction;
  private readonly wsaCloseSocket: KoffiFunction;
  private readonly WSAGetLastError: KoffiFunction;

  /** @throws {Error} If the native ws2_32.dll bindings can't be loaded on this machine. */
  constructor() {
    super();

    const ws2 = koffi.load('ws2_32.dll');

    this.WSAPoll = ws2.func(
      'int __stdcall WSAPoll(_Inout_ WS2_WsaPollFd *fdArray, unsigned long fds, int timeout)',
    );
    this.wsaSocket = ws2.func('uint64 __stdcall socket(int af, int type, int protocol)');
    this.wsaConnect = ws2.func(
      'int __stdcall connect(uint64 s, WS2_RawSockAddrIn *name, int namelen)',
    );
    this.wsaCloseSocket = ws2.func('int __stdcall closesocket(uint64 s)');
    this.WSAGetLastError = ws2.func('int __stdcall WSAGetLastError()');
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

  /**
   * Opens a real client `SOCKET` to 127.0.0.1:`port` by calling `ws2_32.dll`'s
   * `socket`/`connect` directly, bypassing Node's `net` module entirely.
   *
   * This is the only way to get a real, `WSAPoll`-able socket handle on
   * Windows: Node's `net.Socket` doesn't expose one — `.fd`/`_handle.fd` is
   * documented to return `-1` there, since Windows sockets aren't in the same
   * handle namespace as POSIX fds/CRT descriptors — so a `net.Socket` can't
   * stand in for the kind of handle `pollReadable` actually polls in
   * production (see `GciLibrary.socketFor`). Production code never opens its
   * own sockets through this method; it exists for test fixtures that need
   * such a handle.
   *
   * Relies on Winsock already being initialized: libuv calls `WSAStartup`
   * while setting up Node's own event loop on Windows, before any user code
   * runs, so no separate `WSAStartup` call is needed here.
   *
   * @param port - TCP port on the loopback interface to connect to.
   * @returns The connected socket's raw handle.
   * @throws {Error} If the native `socket()` or `connect()` call fails.
   */
  public connectRawSocket(port: number): number {
    const handle = this.wsaSocket(AF_INET, SOCK_STREAM, IPPROTO_TCP) as bigint;
    if (handle === INVALID_SOCKET) {
      throw new Error(`socket() failed (WSAGetLastError ${this.WSAGetLastError()})`);
    }

    const address = {
      family: AF_INET,
      portBytes: [(port >> 8) & 0xff, port & 0xff],
      addrBytes: [127, 0, 0, 1],
      zero: [0, 0, 0, 0, 0, 0, 0, 0],
    };

    const status = this.wsaConnect(handle, address, 16) as number;
    if (status === SOCKET_ERROR) {
      const error = this.WSAGetLastError();
      this.wsaCloseSocket(handle);
      throw new Error(`connect() failed (WSAGetLastError ${error})`);
    }

    return Number(handle);
  }

  /** Closes a handle previously returned by {@link connectRawSocket}. */
  public closeRawSocket(fd: number): void {
    this.wsaCloseSocket(BigInt(fd));
  }
}
