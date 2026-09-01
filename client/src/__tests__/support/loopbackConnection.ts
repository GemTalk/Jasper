import { createServer, Socket } from 'net';

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
