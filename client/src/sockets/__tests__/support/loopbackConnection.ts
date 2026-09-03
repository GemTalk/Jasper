import { createServer, Socket } from 'net';
import { createNativeSocketLibrary } from '../../factory';
import { RawSocketConnection } from '../../nativeSocketLibrary';

export type LoopbackConnection = {
  fd: bigint;
  writeFromServer: (data: string) => Promise<void>;
  resetFromServer: () => Promise<void>;
  close: () => Promise<void>;
};

export type ConnectLoopbackClient = (port: number) => Promise<RawSocketConnection>;

/**
 * Opens a real TCP loopback connection and resolves with the client's raw
 * fd/handle (obtained from `connectClient`, which supplies the
 * platform-specific way to get one), a `writeFromServer` callback to send bytes from
 * the server side, a `resetFromServer` callback to have the server side reset the
 * connection, and a `close` callback to close both ends. The client side is
 * never read from, so any bytes sent stay at the OS level rather than being
 * drained, leaving the handle's readiness exactly as a real `poll`/`WSAPoll`
 * caller would see it.
 *
 * `writeFromServer`, `resetFromServer`, and `close` resolve once their effect has actually
 * happened at the OS level (the write has flushed; the reset/closed socket
 * has closed) rather than after a guessed delay: on loopback there's no real
 * wire transfer, so by the time the local op completes, the client side has
 * already seen it.
 *
 * @param connectClient - supplies the platform-specific way to obtain the
 * client's raw fd/handle for a given port.
 * @returns the connected client's raw fd/handle, a `writeFromServer` callback
 * to send bytes from the server side, a `resetFromServer` callback to have
 * the server side reset the connection, and a `close` callback to close both
 * ends.
 */
export async function openLoopbackConnectionWith(
  connectClient: ConnectLoopbackClient,
): Promise<LoopbackConnection> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);

    let peer: Socket | undefined;
    let client: RawSocketConnection | undefined;
    let closed = false;

    const resolveOnceBothEndsAreUp = () => {
      if (peer && client) {
        resolve({
          fd: client.fd,
          writeFromServer: (data) =>
            new Promise((writeResolve, writeReject) =>
              peer!.write(data, (error) => (error ? writeReject(error) : writeResolve())),
            ),
          resetFromServer: () =>
            new Promise((resetResolve) => {
              peer!.once('close', resetResolve);
              peer!.resetAndDestroy();
            }),
          close: () =>
            new Promise((closeResolve) => {
              // Idempotent: a test may close the connection itself and the
              // shared `afterEach` closes it again. `client!.disconnect()`
              // isn't guaranteed idempotent on every platform (e.g. it's a
              // bare `closesocket()` FFI call on Windows), so calling it
              // twice on the same handle must be avoided here rather than
              // relied on there.
              if (closed) {
                closeResolve();
                return;
              }
              closed = true;

              const finish = () => server.close(() => closeResolve());
              // The peer may already be closed (e.g. after `resetFromServer`), in which
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

    const onListening = async () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Expected the loopback server to report a network address'));
        return;
      }

      client = await connectClient(address.port);
      resolveOnceBothEndsAreUp();
    };

    // `server.listen`'s callback type is `() => void`; it doesn't await a
    // returned promise, so a rejection from `connectClient` would otherwise
    // become an unhandled rejection instead of failing this Promise.
    server.listen(0, '127.0.0.1', () => onListening().catch(reject));
  });
}

/**
 * Opens a real TCP loopback connection using the current platform's native
 * socket library to obtain the client's handle.
 *
 * @returns the connected client's raw fd/handle, a `writeFromServer` callback to send
 * bytes from the server side, a `resetFromServer` callback to have the server side
 * reset the connection, and a `close` callback to close both ends.
 */
export async function openLoopbackConnection() {
  const library = createNativeSocketLibrary();

  return await openLoopbackConnectionWith((port) => library.connectRawSocket(port));
}
