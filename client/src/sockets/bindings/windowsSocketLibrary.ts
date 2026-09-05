import koffi, { KoffiFunction } from 'koffi';

export type WindowsSocketLibrary = {
  WSAPoll: KoffiFunction;
  socket: KoffiFunction;
  connect: KoffiFunction;
  closesocket: KoffiFunction;
  WSAGetLastError: KoffiFunction;
  POLLRDNORM: number;
  AF_INET: number;
  SOCK_STREAM: number;
  IPPROTO_TCP: number;
  INVALID_SOCKET: bigint;
  SOCKET_ERROR: number;
  SOCKADDR_IN_SIZE: number;
};

let instance: WindowsSocketLibrary | undefined;

/**
 * Returns the shared Windows polling library, loading it on first use.
 *
 * @returns the loaded library's bindings.
 * @throws {Error} If the library can't be loaded on this machine.
 */
export function windowsSocket2Library(): WindowsSocketLibrary {
  return (instance ??= loadWindowsSocket2Library());
}

/**
 * Loads the Windows polling library and builds its bindings.
 *
 * @returns the loaded library's bindings.
 * @throws {Error} If the library can't be loaded on this machine.
 */
function loadWindowsSocket2Library(): WindowsSocketLibrary {
  const ws2 = koffi.load('ws2_32.dll');

  // Registered once at module scope, rather than per instance: koffi's struct
  // registry is process-wide, and re-declaring an already-registered name
  // throws, which a second `NativeWindowsSocketLibrary` instance would hit
  // if these lived inside the constructor.
  koffi.struct('WS2_WsaPollFd', {
    fd: 'uint64',
    events: 'int16',
    revents: 'int16',
  });

  // A minimal `sockaddr_in`: 2-byte family, 2-byte port, 4-byte address, 8
  // bytes of zero padding (16 bytes total, matching the real struct's layout
  // exactly). Port and address are declared as raw byte arrays rather than
  // `uint16`/`uint32` so the network-byte-order bytes written are exactly the
  // bytes koffi puts in memory, regardless of the host's own endianness.
  koffi.struct('WS2_RawSockAddrIn', {
    family: 'uint16',
    portBytes: 'uint8[2]',
    addrBytes: 'uint8[4]',
    zero: 'uint8[8]',
  });

  return {
    WSAPoll: ws2.func(
      'int __stdcall WSAPoll(_Inout_ WS2_WsaPollFd *fdArray, unsigned long fds, int timeout)',
    ),
    socket: ws2.func('uint64 __stdcall socket(int af, int type, int protocol)'),
    connect: ws2.func('int __stdcall connect(uint64 s, WS2_RawSockAddrIn *name, int namelen)'),
    closesocket: ws2.func('int __stdcall closesocket(uint64 s)'),
    WSAGetLastError: ws2.func('int __stdcall WSAGetLastError()'),
    POLLRDNORM: 0x0100,
    AF_INET: 2,
    SOCK_STREAM: 1,
    IPPROTO_TCP: 6,
    INVALID_SOCKET: 0xffffffffffffffffn,
    SOCKET_ERROR: -1,
    SOCKADDR_IN_SIZE: koffi.sizeof('WS2_RawSockAddrIn'),
  };
}
