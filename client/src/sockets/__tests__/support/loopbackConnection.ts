import { connect, createServer, Socket } from 'net';
import { createNativeWindowsSocketLibrary } from '../../factory';

export type LoopbackConnection = {
  fd: number;
  write: (data: string) => Promise<void>;
  reset: () => Promise<void>;
  close: () => Promise<void>;
};

/**
 * A connected client handle for a loopback fixture: `fd` is whatever raw
 * fd/handle the platform's `poll`/`WSAPoll` call expects, and `disconnect`
 * tears down that same client side.
 */
export type LoopbackClient = {
  fd: number;
  disconnect: () => void;
};

export type ConnectLoopbackClient = (port: number) => LoopbackClient | Promise<LoopbackClient>;

/**
 * Opens a real TCP loopback connection and resolves with the client's raw
 * fd/handle (obtained from `connectClient`, which supplies the
 * platform-specific way to get one — see `nativeSocketLibrary.test.ts` for
 * the POSIX client and `rawWindowsSocket.ts` for the Windows one), a `write`
 * callback to send bytes from the server side, a `reset` callback to have
 * the server side reset the connection, and a `close` callback to close both
 * ends. The client side is never read from, so any bytes sent stay at the OS
 * level rather than being drained — leaving the handle's readiness exactly
 * as a real `poll`/`WSAPoll` caller would see it.
 *
 * `write`, `reset`, and `close` resolve once their effect has actually
 * happened at the OS level (the write has flushed; the reset/closed socket
 * has closed) rather than after a guessed delay: on loopback there's no real
 * wire transfer, so by the time the local op completes, the client side has
 * already seen it.
 */
export async function openLoopbackConnection(
  connectClient: ConnectLoopbackClient,
): Promise<LoopbackConnection> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);

    let peer: Socket | undefined;
    let client: LoopbackClient | undefined;

    const resolveOnceBothEndsAreUp = () => {
      if (peer && client) {
        resolve({
          fd: client.fd,
          write: (data) => new Promise((writeResolve) => peer!.end(data, writeResolve)),
          reset: () =>
            new Promise((resetResolve) => {
              peer!.once('close', resetResolve);
              peer!.resetAndDestroy();
            }),
          close: () =>
            new Promise((closeResolve) => {
              const finish = () => server.close(() => closeResolve());
              // The peer may already be closed (e.g. after `reset`), in which
              // case its one-time 'close' event has already fired and
              // registering a new listener for it would wait forever.
              if (peer!.destroyed) {
                client!.disconnect();
                finish();
              } else {
                peer!.once('close', finish);
                client!.disconnect();
              }
            }),
        });
      }
    };

    server.on('connection', (socket) => {
      peer = socket;
      // Disconnecting the client can send an RST if it still has unread data
      // waiting (see `close`/`disconnect` above), which surfaces here as an
      // 'error' on the peer. Node rethrows an un-listened-for socket 'error'
      // as an uncaught exception that would otherwise crash the whole test
      // run.
      peer.on('error', () => undefined);
      resolveOnceBothEndsAreUp();
    });

    server.listen(0, '127.0.0.1', async () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Expected the loopback server to report a network address'));
        return;
      }

      client = await connectClient(address.port);
      resolveOnceBothEndsAreUp();
    });
  });
}

/**
 * The Windows side of {@link ConnectLoopbackClient}: a raw `SOCKET` obtained
 * via `NativeWindowsSocketLibrary.connectRawSocket`, bypassing Node's `net`
 * module entirely (see that method's doc for why).
 */
function connectWindowsLoopbackClient(port: number): LoopbackClient {
  const windowsSocketLibrary = createNativeWindowsSocketLibrary();
  const fd = windowsSocketLibrary.connectRawSocket(port);

  return { fd, disconnect: () => windowsSocketLibrary.closeRawSocket(fd) };
}

/**
 * Returns `socket`'s underlying OS file descriptor. There's no public API
 * for this — `_handle.fd` is an internal Node property — but it's exactly
 * the kind of fd `GciLibrary.socketFor` hands to `NativeSocketLibrary` in
 * production, so it's the only way to test the real poll/WSAPoll call
 * against a genuine socket rather than a fake `hasDataReady`.
 */
function rawFdOf(socket: Socket): number {
  return (socket as unknown as { _handle: { fd: number } })._handle.fd;
}

/** The POSIX side of {@link ConnectLoopbackClient}: a real `net.Socket`, whose fd is read via {@link rawFdOf}. */
function connectPosixLoopbackClient(port: number): Promise<LoopbackClient> {
  return new Promise((resolve) => {
    const clientSocket = connect(port, '127.0.0.1');
    // The client under test is never read from, so a peer reset (used to
    // exercise the POLLHUP/POLLERR case below) arrives as an ECONNRESET
    // here. Node rethrows an un-listened-for socket 'error' as an
    // uncaught exception that would otherwise crash the whole test run.
    clientSocket.on('error', () => undefined);
    clientSocket.on('connect', () =>
      resolve({ fd: rawFdOf(clientSocket), disconnect: () => clientSocket.destroy() }),
    );
  });
}

export async function openLoopbackConnection2() {
  switch (process.platform) {
    case 'win32':
      return await openLoopbackConnection(connectWindowsLoopbackClient);
    default:
      return await openLoopbackConnection(connectPosixLoopbackClient);
  }
}
