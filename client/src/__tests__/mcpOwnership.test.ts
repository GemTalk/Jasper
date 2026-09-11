// Taking, holding and handing over the MCP server. These are the decisions the
// sidebar rework turns on, and every one of them was previously inline in
// activate() where nothing could reach it — two of the bugs below (a claim that
// reported nothing, a Stop undone by the next session change) shipped in review
// builds because of exactly that.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { McpOwnershipController, McpOwnershipDeps } from '../mcpOwnership';
import {
  RELEASE_WAIT_ATTEMPTS,
  readReleaseRequest,
  writeReleaseRequest,
} from '../mcpReleaseRequest';
import type { McpOwnership } from '../mcpServerTreeProvider';

const OUR_PID = 4242;
const THEIR_PID = 777;

const unowned: McpOwnership = { kind: 'none' };
const theirs: McpOwnership = {
  kind: 'other',
  info: {
    pid: THEIR_PID,
    workspacePath: '/their/workspace',
    socketPath: '/tmp/jasper.sock',
    claimedAt: '2026-01-01T00:00:00.000Z',
  },
};

/** An owner whose window cannot be reached by opening its recorded path. */
const theirsMultiRoot: McpOwnership = {
  kind: 'other',
  info: {
    ...theirs.info,
    workspaceName: 'their-proj (Workspace)',
    workspaceFile: '/their/proj.code-workspace',
  },
};
const ours: McpOwnership = { kind: 'this', socketPath: '/tmp/jasper.sock' };

let dir: string;
let requestPath: string;

/** A controller over a fake socket, with every notification captured. */
function harness(
  options: {
    startSucceeds?: boolean;
    ownership?: () => McpOwnership;
    sessionLabel?: string;
    warnAnswers?: (string | undefined)[];
  } = {},
) {
  const socket = {
    isOwner: false,
    start: vi.fn(async () => {
      if (options.startSucceeds === false) return false;
      socket.isOwner = true;
      return true;
    }),
    dispose: vi.fn(async () => {
      socket.isOwner = false;
    }),
  };
  const warnAnswers = [...(options.warnAnswers ?? [])];
  const info: string[] = [];
  const warns: { message: string; actions: string[] }[] = [];
  const logs: string[] = [];
  const deps: McpOwnershipDeps = {
    socket,
    startHttps: vi.fn(async () => {}),
    stopHttps: vi.fn(async () => {}),
    ownership: options.ownership ?? (() => (socket.isOwner ? ours : unowned)),
    selectedSessionLabel: () => options.sessionLabel,
    pid: OUR_PID,
    releaseRequestPath: requestPath,
    notifier: {
      info: (m) => info.push(m),
      warn: async (m, ...actions) => {
        warns.push({ message: m, actions });
        return warnAnswers.shift();
      },
      progress: (_title, task) => task(),
      log: (m) => logs.push(m),
    },
    onChanged: vi.fn(),
    revealOwner: vi.fn(async () => {}),
    showPanel: vi.fn(async () => {}),
    // No real waiting: the poll is 40 × 250ms in production.
    sleep: async () => {},
  };
  return { controller: new McpOwnershipController(deps), socket, deps, info, warns, logs };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-mcp-own-'));
  requestPath = path.join(dir, 'mcp.release-request.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('claiming', () => {
  it('takes the socket, starts HTTPS, and says which session it serves', () => {
    const h = harness({ sessionLabel: 'session 7 (Foo)' });

    return h.controller.claim().then(() => {
      expect(h.socket.isOwner).toBe(true);
      expect(h.deps.startHttps).toHaveBeenCalled();
      expect(h.info).toEqual(['This window now serves MCP, on session 7 (Foo).']);
      expect(h.deps.onChanged).toHaveBeenCalled();
    });
  });

  it('claims with no session selected, and says what is missing', async () => {
    const h = harness();

    await h.controller.claim();

    expect(h.info[0]).toContain('Select a session');
  });

  it('reports a failed claim instead of failing silently', async () => {
    // The bug this exists for: the tab's Claim button went straight to the
    // silent path, so a claim against a held socket looked like a dead button.
    const h = harness({ startSucceeds: false, ownership: () => theirs });

    await h.controller.claim();

    expect(h.warns).toHaveLength(1);
    expect(h.warns[0].message).toContain('/their/workspace');
    expect(h.warns[0].actions).toEqual(['Ask It to Release', 'Show MCP Server']);
  });

  it('names the holder by its window name when it has one', async () => {
    const h = harness({ startSucceeds: false, ownership: () => theirsMultiRoot });

    await h.controller.claim();

    expect(h.warns[0].message).toContain('their-proj (Workspace)');
  });

  it('offers the action that can actually resolve a failed claim', async () => {
    const h = harness({
      startSucceeds: false,
      ownership: () => theirs,
      warnAnswers: ['Ask It to Release', undefined],
    });

    await h.controller.claim();

    // Choosing it runs the whole release handshake — which, against a window
    // that never answers, ends in its own timeout warning. Two warnings is the
    // evidence the first one led somewhere; the request file is gone by then
    // because the timeout path clears it.
    expect(h.warns).toHaveLength(2);
    expect(h.warns[1].message).toContain('did not release');
    expect(h.logs.join(' ')).toContain(`Asked MCP owner pid ${THEIR_PID}`);
  });

  it('opens the tab when that is the action chosen', async () => {
    const h = harness({
      startSucceeds: false,
      ownership: () => theirs,
      warnAnswers: ['Show MCP Server'],
    });

    await h.controller.claim();

    expect(h.deps.showPanel).toHaveBeenCalled();
  });

  it('says so rather than re-claiming when this window already serves', async () => {
    const h = harness();
    await h.controller.claim();
    h.info.length = 0;
    vi.mocked(h.socket.start).mockClear();

    await h.controller.claim();

    expect(h.socket.start).not.toHaveBeenCalled();
    expect(h.info).toEqual(['This window already serves MCP.']);
  });

  it('stays silent when claiming unprompted', async () => {
    // tryClaim runs at activation and on every session change; a toast there
    // would fire on work the user never asked for.
    const h = harness({ startSucceeds: false, ownership: () => theirs });

    await h.controller.tryClaim();

    expect(h.info).toEqual([]);
    expect(h.warns).toEqual([]);
  });

  it('reports a thrown claim to the log, not to the user', async () => {
    const h = harness();
    h.socket.start.mockRejectedValueOnce(new Error('EACCES'));

    await h.controller.tryClaim();

    expect(h.logs.join(' ')).toContain('EACCES');
    expect(h.socket.isOwner).toBe(false);
  });

  it('does not start a second claim while one is in flight', async () => {
    const h = harness();
    let release!: () => void;
    h.socket.start.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => {
            h.socket.isOwner = true;
            resolve(true);
          };
        }),
    );

    const first = h.controller.tryClaim();
    const second = h.controller.tryClaim();
    release();
    await Promise.all([first, second]);

    expect(h.socket.start).toHaveBeenCalledTimes(1);
  });
});

describe('stopping', () => {
  it('drops both listeners and says another window can take it', async () => {
    const h = harness();
    await h.controller.claim();
    h.info.length = 0;

    await h.controller.stop();

    expect(h.deps.stopHttps).toHaveBeenCalled();
    expect(h.socket.dispose).toHaveBeenCalled();
    expect(h.socket.isOwner).toBe(false);
    expect(h.info[0]).toContain('released the MCP server');
  });

  it('says so rather than disposing when this window is not serving', async () => {
    const h = harness();

    await h.controller.stop();

    expect(h.socket.dispose).not.toHaveBeenCalled();
    expect(h.info).toEqual(['This window is not serving MCP.']);
  });

  it('is not undone by the next session change', async () => {
    // The automatic re-claim runs on every session change. Without the
    // released flag, Stop lasted until the user next clicked a session — which
    // is the opposite of what Stop was asked to do.
    const h = harness();
    await h.controller.claim();
    await h.controller.stop();
    vi.mocked(h.socket.start).mockClear();

    await h.controller.tryClaim();

    expect(h.socket.start).not.toHaveBeenCalled();
    expect(h.socket.isOwner).toBe(false);
    expect(h.controller.releasedByUser).toBe(true);
  });

  it('is undone by an explicit claim, which is the way back', async () => {
    const h = harness();
    await h.controller.claim();
    await h.controller.stop();

    await h.controller.claim();

    expect(h.socket.isOwner).toBe(true);
    expect(h.controller.releasedByUser).toBe(false);
  });
});

describe('asking another window to release', () => {
  it('writes a request naming the owner, waits, then claims', async () => {
    let ownership: McpOwnership = theirs;
    const h = harness({ startSucceeds: true, ownership: () => ownership });
    // The owner answers on the first poll.
    h.deps.sleep = async () => {
      ownership = unowned;
    };
    const controller = new McpOwnershipController({ ...h.deps, ownership: () => ownership });

    await controller.requestRelease();

    expect(readReleaseRequest(requestPath)).toMatchObject({ ownerPid: THEIR_PID });
    expect(h.socket.isOwner).toBe(true);
  });

  it('gives up on a window that never answers, and names it', async () => {
    // A window running a Jasper without this protocol ignores the file. The
    // wait is bounded so that reads as a timeout rather than a hang.
    const h = harness({ startSucceeds: false, ownership: () => theirs });

    await h.controller.requestRelease();

    expect(h.warns).toHaveLength(1);
    expect(h.warns[0].message).toContain('/their/workspace');
    expect(h.warns[0].message).toContain('did not release');
    expect(h.socket.start).not.toHaveBeenCalled();
  });

  it('clears its own request after giving up, so it cannot unseat a later owner', async () => {
    const h = harness({ startSucceeds: false, ownership: () => theirs });

    await h.controller.requestRelease();

    expect(fs.existsSync(requestPath)).toBe(false);
  });

  it('polls a bounded number of times', async () => {
    const h = harness({ startSucceeds: false, ownership: () => theirs });
    const sleep = vi.fn(async () => {});
    const controller = new McpOwnershipController({ ...h.deps, sleep });

    await controller.requestRelease();

    expect(sleep).toHaveBeenCalledTimes(RELEASE_WAIT_ATTEMPTS);
  });

  it('names the window rather than only its path, when the owner recorded one', async () => {
    // A path does not identify a window to a person; the title bar does.
    const h = harness({ startSucceeds: false, ownership: () => theirsMultiRoot });

    await h.controller.requestRelease();

    expect(h.warns[0].message).toContain('their-proj (Workspace)');
  });

  it('does not offer to open an owner that opening cannot reach', async () => {
    // A multi-root owner's recorded path is only its first folder, so the
    // action would open a duplicate window and look like it had worked.
    const h = harness({ startSucceeds: false, ownership: () => theirsMultiRoot });

    await h.controller.requestRelease();

    expect(h.warns).toHaveLength(1);
    expect(h.warns[0].actions).toEqual([]);
    expect(h.deps.revealOwner).not.toHaveBeenCalled();
  });

  it('offers to open the window that ignored it', async () => {
    const h = harness({
      startSucceeds: false,
      ownership: () => theirs,
      warnAnswers: ['Open That Window'],
    });

    await h.controller.requestRelease();

    expect(h.deps.revealOwner).toHaveBeenCalledWith('/their/workspace');
  });

  it('just claims when nobody holds the server', async () => {
    const h = harness({ ownership: () => unowned });

    await h.controller.requestRelease();

    expect(fs.existsSync(requestPath)).toBe(false);
    expect(h.socket.isOwner).toBe(true);
  });

  it('says so rather than asking when this window already serves', async () => {
    const h = harness();
    await h.controller.claim();
    h.info.length = 0;

    await h.controller.requestRelease();

    expect(h.info).toEqual(['This window already serves MCP.']);
    expect(fs.existsSync(requestPath)).toBe(false);
  });
});

describe('answering a release request', () => {
  const asking = (ownerPid: number) => ({
    ownerPid,
    requesterPid: THEIR_PID,
    requestedAt: new Date().toISOString(),
  });

  it('releases when the request names this window', async () => {
    const h = harness();
    await h.controller.claim();
    writeReleaseRequest(asking(OUR_PID), requestPath);

    expect(await h.controller.handleReleaseRequest()).toBe(true);
    expect(h.socket.isOwner).toBe(false);
    expect(h.deps.stopHttps).toHaveBeenCalled();
  });

  it('clears the request, so the asker sees the socket free exactly once', async () => {
    const h = harness();
    await h.controller.claim();
    writeReleaseRequest(asking(OUR_PID), requestPath);

    await h.controller.handleReleaseRequest();

    expect(fs.existsSync(requestPath)).toBe(false);
  });

  it('does not re-claim afterwards on the next session change', async () => {
    // Releasing on request and then taking it straight back would be worse
    // than never answering.
    const h = harness();
    await h.controller.claim();
    writeReleaseRequest(asking(OUR_PID), requestPath);
    await h.controller.handleReleaseRequest();
    vi.mocked(h.socket.start).mockClear();

    await h.controller.tryClaim();

    expect(h.socket.start).not.toHaveBeenCalled();
  });

  it('ignores a request naming a different window', async () => {
    const h = harness();
    await h.controller.claim();
    writeReleaseRequest(asking(THEIR_PID), requestPath);

    expect(await h.controller.handleReleaseRequest()).toBe(false);
    expect(h.socket.isOwner).toBe(true);
  });

  it('ignores any request when this window does not hold the server', async () => {
    const h = harness();
    writeReleaseRequest(asking(OUR_PID), requestPath);

    expect(await h.controller.handleReleaseRequest()).toBe(false);
    expect(h.socket.dispose).not.toHaveBeenCalled();
  });

  it('ignores a file event with no request behind it', async () => {
    const h = harness();
    await h.controller.claim();

    expect(await h.controller.handleReleaseRequest()).toBe(false);
    expect(h.socket.isOwner).toBe(true);
  });
});
