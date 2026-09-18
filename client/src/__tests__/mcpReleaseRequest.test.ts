import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  RELEASE_REQUEST_TTL_MS,
  clearReleaseRequest,
  readReleaseRequest,
  requestsReleaseFrom,
  writeReleaseRequest,
} from '../mcpReleaseRequest';

let dir: string;
let requestPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-mcp-release-'));
  requestPath = path.join(dir, 'mcp.release-request.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const request = (over: Partial<Parameters<typeof writeReleaseRequest>[0]> = {}) => ({
  ownerPid: 100,
  requesterPid: 200,
  requestedAt: new Date().toISOString(),
  ...over,
});

describe('the release request file', () => {
  it('round-trips a request', () => {
    const req = request();
    writeReleaseRequest(req, requestPath);
    expect(readReleaseRequest(requestPath)).toEqual(req);
  });

  it('creates its directory, since the first ask can precede any sidecar write', () => {
    const nested = path.join(dir, 'not', 'yet', 'mcp.release-request.json');
    writeReleaseRequest(request(), nested);
    expect(fs.existsSync(nested)).toBe(true);
  });

  it('reads as absent when there is no file, and when the file is garbage', () => {
    expect(readReleaseRequest(requestPath)).toBeUndefined();
    fs.writeFileSync(requestPath, 'not json');
    expect(readReleaseRequest(requestPath)).toBeUndefined();
    fs.writeFileSync(requestPath, JSON.stringify({ ownerPid: 'nope' }));
    expect(readReleaseRequest(requestPath)).toBeUndefined();
  });

  it('clears without complaint when already gone', () => {
    expect(() => clearReleaseRequest(requestPath)).not.toThrow();
    writeReleaseRequest(request(), requestPath);
    clearReleaseRequest(requestPath);
    expect(fs.existsSync(requestPath)).toBe(false);
  });
});

describe('whether an owner should honour a request', () => {
  it('honours a fresh request naming it', () => {
    expect(requestsReleaseFrom(request(), 100)).toBe(true);
  });

  it('ignores a request naming a different owner', () => {
    // The window it names may be about to see it; releasing on its behalf
    // would hand the server to a third window nobody asked.
    expect(requestsReleaseFrom(request({ ownerPid: 999 }), 100)).toBe(false);
  });

  it('ignores its own request, which would otherwise be a release loop', () => {
    // A window that asked and then won the socket anyway must not read its own
    // file back and drop what it just took.
    expect(requestsReleaseFrom(request({ ownerPid: 100, requesterPid: 100 }), 100)).toBe(false);
  });

  it('ignores a stale request, so a dead asker cannot unseat the next owner', () => {
    const old = new Date(Date.now() - RELEASE_REQUEST_TTL_MS - 1_000).toISOString();
    expect(requestsReleaseFrom(request({ requestedAt: old }), 100)).toBe(false);
  });

  it('ignores a request with no readable timestamp', () => {
    expect(requestsReleaseFrom(request({ requestedAt: 'whenever' }), 100)).toBe(false);
  });

  it('ignores nothing at all', () => {
    expect(requestsReleaseFrom(undefined, 100)).toBe(false);
  });
});
