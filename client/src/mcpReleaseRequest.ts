import * as fs from 'fs';
import * as path from 'path';
import { extensionPathFrom } from './extensionPath';

// A window asking the MCP owner to let go.
//
// The socket is bound by one process, so a second window cannot take it —
// Claim simply fails while someone holds it. Until there was a Stop, the only
// remedy was to go to the owning window and close or disable Jasper there.
// This is the remote form of that Stop: the asking window drops a request file
// beside the owner sidecar, and the owner — which already watches that
// directory for sidecar changes — sees its own pid named and releases.
//
// Deliberately a request rather than a seizure. The owner decides, its HTTPS
// listener and socket come down in its own process where they were created,
// and a window running a Jasper too old to watch for this simply ignores it —
// which the asking window reports rather than waiting forever.

export interface McpReleaseRequest {
  /** The pid being asked to let go. Ignored by any other owner. */
  ownerPid: number;
  /** Who asked, for the log and to spot our own request. */
  requesterPid: number;
  requestedAt: string; // ISO 8601
}

/**
 * How long a request stays live. A window that asked and then died must not
 * leave a file that makes the next owner release itself on startup, so the
 * owner ignores anything older than this.
 */
export const RELEASE_REQUEST_TTL_MS = 60_000;

/**
 * How long the asking window waits for the owner to let go, and how often it
 * looks. Generous enough for a file-watch round trip plus closing a socket and
 * an HTTPS listener in another process, short enough that a window running a
 * Jasper without this protocol is reported rather than waited on.
 */
export const RELEASE_POLL_MS = 250;
export const RELEASE_WAIT_ATTEMPTS = 40;

export function defaultReleaseRequestPath(): string {
  return extensionPathFrom('mcp.release-request.json');
}

export function writeReleaseRequest(
  request: McpReleaseRequest,
  requestPath: string = defaultReleaseRequestPath(),
): void {
  const dir = path.dirname(requestPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = `${requestPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(request, null, 2) + '\n');
  fs.renameSync(tmp, requestPath);
}

export function readReleaseRequest(
  requestPath: string = defaultReleaseRequestPath(),
): McpReleaseRequest | undefined {
  if (!fs.existsSync(requestPath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(requestPath, 'utf-8'));
    if (
      typeof parsed.ownerPid === 'number' &&
      typeof parsed.requesterPid === 'number' &&
      typeof parsed.requestedAt === 'string'
    ) {
      return {
        ownerPid: parsed.ownerPid,
        requesterPid: parsed.requesterPid,
        requestedAt: parsed.requestedAt,
      };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Remove the request. Called by the owner once it has released. */
export function clearReleaseRequest(requestPath: string = defaultReleaseRequestPath()): void {
  try {
    fs.unlinkSync(requestPath);
  } catch {
    /* already gone, or never written */
  }
}

/**
 * Whether `request` asks the process `pid` to release, and is recent enough to
 * act on. A request naming someone else is left alone — the window it names
 * may be about to see it.
 */
export function requestsReleaseFrom(
  request: McpReleaseRequest | undefined,
  pid: number,
  now: number = Date.now(),
): boolean {
  if (!request) return false;
  if (request.ownerPid !== pid) return false;
  // Never honour our own request: we would be asking ourselves to let go of a
  // socket we only just took, which is how a claim/release loop starts.
  if (request.requesterPid === pid) return false;
  const requestedAt = Date.parse(request.requestedAt);
  if (Number.isNaN(requestedAt)) return false;
  return now - requestedAt <= RELEASE_REQUEST_TTL_MS && now >= requestedAt - RELEASE_REQUEST_TTL_MS;
}
