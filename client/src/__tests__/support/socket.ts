import { isWindows } from '../../wslBridge';
import path from 'path';
import os from 'os';
import * as crypto from 'crypto';

/**
 * A socket / named-pipe path, unique per call. Unlike {@link defaultSocketPath},
 * never collides across parallel test runs or with a real Jasper window's
 * shared socket, so tests can freely start and dispose many
 * {@link McpSocketServer} instances without stepping on each other.
 *
 * `process.pid` keeps the name human-readable for debugging leftover
 * `.sock` files, but pids get recycled and don't by themselves guarantee
 * uniqueness across runs. The `crypto.randomBytes(6)` suffix is what
 * actually carries the guarantee: 2^48 possible values makes collision
 * probability negligible, independent of process lifetime, reboots, or a
 * test runner's per-file module resets.
 **/
export function temporarySocketPath(): string {
  const socketName = `jasper-mcp-socket-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;

  if (isWindows()) {
    return `\\\\.\\pipe\\${socketName}`;
  }

  return path.join(os.tmpdir(), `${socketName}.sock`);
}
