import { NativeSocketLibrary } from '../../nativeSocketLibrary';
import { LoopbackClient, LoopbackConnection, openLoopbackConnection } from './loopbackConnection';

/**
 * The Windows side of {@link ConnectLoopbackClient}: a raw `SOCKET` obtained
 * via `NativeWindowsSocketLibrary.connectRawSocket`, bypassing Node's `net`
 * module entirely (see that method's doc for why).
 */
function connectRawLoopbackClient(port: number): LoopbackClient {
  const windowsSocketLibrary = NativeSocketLibrary.forWindows();
  const fd = windowsSocketLibrary.connectRawSocket(port);

  return { fd, disconnect: () => windowsSocketLibrary.closeRawSocket(fd) };
}

/**
 * Opens a real TCP loopback connection whose client side is a raw Windows
 * `SOCKET` (see {@link connectRawLoopbackClient}), and resolves with that
 * socket's handle, a `write` callback to send bytes from the server side, a
 * `reset` callback to have the server side reset the connection, and a
 * `close` callback to close both ends. The client socket is never read from,
 * so any bytes sent stay at the OS level rather than being drained, leaving
 * the handle's readiness exactly as a real `WSAPoll` caller would see it.
 *
 * `write`, `reset`, and `close` resolve once their effect has actually
 * happened at the OS level (the write has flushed; the reset/closed socket
 * has closed) rather than after a guessed delay: on loopback there's no real
 * wire transfer, so by the time the local op completes, the peer side has
 * already seen it.
 */
export async function openRawLoopbackConnection(): Promise<LoopbackConnection> {
  return await openLoopbackConnection(connectRawLoopbackClient);
}
