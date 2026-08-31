import koffi, { KoffiFunction } from 'koffi';
import { createServer, Socket } from 'net';

// A minimal `sockaddr_in`: 2-byte family, 2-byte port, 4-byte address, 8
// bytes of zero padding — 16 bytes total, matching the real struct's layout
// exactly. Port and address are declared as raw byte arrays rather than
// `uint16`/`uint32` so the network-byte-order bytes we write are exactly the
// bytes koffi puts in memory, regardless of the host's own endianness.
koffi.struct('RawSockAddrIn', {
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

let ws2Functions:
  | {
      socket: KoffiFunction;
      connect: KoffiFunction;
      closesocket: KoffiFunction;
      WSAGetLastError: KoffiFunction;
    }
  | undefined;

function ws2() {
  return (ws2Functions ??= (() => {
    const lib = koffi.load('ws2_32.dll');

    return {
      socket: lib.func('uint64 __stdcall socket(int af, int type, int protocol)'),
      connect: lib.func('int __stdcall connect(uint64 s, RawSockAddrIn *name, int namelen)'),
      closesocket: lib.func('int __stdcall closesocket(uint64 s)'),
      WSAGetLastError: lib.func('int __stdcall WSAGetLastError()'),
    };
  })());
}

/**
 * Opens a real client `SOCKET` to 127.0.0.1:`port` by calling `ws2_32.dll`'s
 * `socket`/`connect` directly, bypassing Node's `net` module entirely.
 *
 * This is the only way to get a real, `WSAPoll`-able socket handle on
 * Windows: Node's `net.Socket` doesn't expose one — `.fd`/`_handle.fd` is
 * documented to return `-1` there, since Windows sockets aren't in the same
 * handle namespace as POSIX fds/CRT descriptors — so a `net.Socket` can't
 * stand in for the kind of handle `NativeSocketLibrary` actually polls in
 * production (see `GciLibrary.socketFor`).
 *
 * Relies on Winsock already being initialized: libuv calls `WSAStartup`
 * while setting up Node's own event loop on Windows, before any user code
 * runs, so no separate `WSAStartup` call is needed here.
 *
 * @param port - TCP port on the loopback interface to connect to.
 * @returns The connected socket's raw handle.
 * @throws {Error} If the native `socket()` or `connect()` call fails.
 */
function connectRawSocket(port: number): number {
  const { socket, connect, WSAGetLastError } = ws2();

  const handle = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP) as bigint;
  if (handle === INVALID_SOCKET) {
    throw new Error(`socket() failed (WSAGetLastError ${WSAGetLastError()})`);
  }

  const address = {
    family: AF_INET,
    portBytes: [(port >> 8) & 0xff, port & 0xff],
    addrBytes: [127, 0, 0, 1],
    zero: [0, 0, 0, 0, 0, 0, 0, 0],
  };

  const status = connect(handle, address, 16) as number;
  if (status === SOCKET_ERROR) {
    throw new Error(`connect() failed (WSAGetLastError ${WSAGetLastError()})`);
  }

  return Number(handle);
}

/** Closes a handle previously returned by {@link connectRawSocket}. */
function closeRawSocket(fd: number) {
  ws2().closesocket(BigInt(fd));
}

/**
 * Opens a real TCP loopback connection whose client side is a raw Windows
 * `SOCKET` (see {@link connectRawSocket}), and resolves with that socket's
 * handle, a `writeFromPeer` callback to send bytes from the server side, a
 * `resetFromPeer` callback to have the server side reset the connection, and
 * a `cleanup` callback to close both ends. The client socket is never read
 * from, so any bytes sent stay at the OS level rather than being drained —
 * leaving the handle's readiness exactly as a real `WSAPoll` caller would
 * see it.
 */
export async function openRawLoopbackConnection(): Promise<{
  fd: number;
  writeFromPeer: (data: string) => void;
  resetFromPeer: () => void;
  cleanup: () => void;
}> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);

    server.once('connection', (peer: Socket) => {
      // The client under test is never read from, so cleanup closes it with
      // unread data still in its receive buffer. Winsock's `closesocket`
      // sends an RST rather than a graceful FIN in that case, and Node
      // surfaces the RST as an 'error' event here on the peer — an expected
      // artifact of this fixture's cleanup, not a real failure, but Node
      // rethrows an un-listened-for socket 'error' as an uncaught exception
      // that would otherwise crash the whole test run.
      peer.on('error', () => undefined);

      resolve({
        fd,
        writeFromPeer: (data) => peer.end(data),
        resetFromPeer: () => peer.resetAndDestroy(),
        cleanup: () => {
          closeRawSocket(fd);
          server.close();
        },
      });
    });

    let fd: number;
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Expected the loopback server to report a network address'));
        return;
      }

      fd = connectRawSocket(address.port);
    });
  });
}

/**
 * Opens a raw loopback connection (see {@link openRawLoopbackConnection}),
 * writes `data` from the server side, and resolves with the client handle
 * once the bytes have had time to land in the OS receive buffer.
 *
 * @param data - Bytes to make available on the returned handle.
 * @returns The readable handle, and a `cleanup` callback to close both ends.
 */
export async function openRawReadableSocket(
  data: string,
): Promise<{ fd: number; cleanup: () => void }> {
  const { fd, writeFromPeer, cleanup } = await openRawLoopbackConnection();

  writeFromPeer(data);
  await new Promise((resolve) => setTimeout(resolve, 50));

  return { fd, cleanup };
}

/**
 * Opens a raw loopback connection (see {@link openRawLoopbackConnection}),
 * has the server side reset it, and resolves with the client handle once
 * the reset has had time to land.
 *
 * @returns The reset handle, and a `cleanup` callback to close it.
 */
export async function openRawResetSocket(): Promise<{ fd: number; cleanup: () => void }> {
  const { fd, resetFromPeer, cleanup } = await openRawLoopbackConnection();

  resetFromPeer();
  await new Promise((resolve) => setTimeout(resolve, 50));

  return { fd, cleanup };
}
