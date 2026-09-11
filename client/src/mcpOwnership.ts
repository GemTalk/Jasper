import { McpOwnership } from './mcpServerTreeProvider';
import { canRevealOwnerWindow } from './mcpWindowStatus';
import {
  RELEASE_POLL_MS,
  RELEASE_WAIT_ATTEMPTS,
  clearReleaseRequest,
  readReleaseRequest,
  requestsReleaseFrom,
  writeReleaseRequest,
} from './mcpReleaseRequest';

// Taking, holding and handing over the MCP server.
//
// One socket per machine, bound by one process: a window that wants the server
// cannot take it while another holds it, and the holder is the only thing that
// can let go. Every consequence of that lives here — claiming, releasing,
// asking another window to release, and not quietly re-claiming something the
// user just gave up.
//
// It is a class taking a dependency bag rather than code inside activate()
// because these are the decisions worth testing, and nothing in activate() can
// be reached by a test. VS Code, the sockets and the clock all arrive through
// the bag; this file imports none of them.

/** How the controller talks to the user. `warn` resolves to the chosen action. */
export interface McpOwnershipNotifier {
  info(message: string): void;
  warn(message: string, ...actions: string[]): Promise<string | undefined>;
  /** Run `task` with a progress indicator titled `title`. */
  progress<T>(title: string, task: () => Promise<T>): Promise<T>;
  /** Write to the output channel — for what a user has not asked about. */
  log(message: string): void;
}

export interface McpOwnershipDeps {
  socket: {
    readonly isOwner: boolean;
    start(): Promise<boolean>;
    dispose(): Promise<void>;
  };
  /** Bring up the HTTPS/SSE listener once the socket is ours. Reports its own outcome. */
  startHttps: () => Promise<void>;
  /** Take it back down. A no-op when it never started. */
  stopHttps: () => Promise<void>;
  ownership: () => McpOwnership;
  /** The session this window would serve, for the message after a claim. */
  selectedSessionLabel: () => string | undefined;
  /** This extension host's pid — what a release request names. */
  pid: number;
  releaseRequestPath: string;
  notifier: McpOwnershipNotifier;
  /** Redraw every MCP surface: the Databases header, the session rows, the tab. */
  onChanged: () => void;
  revealOwner: (workspacePath: string) => Promise<void>;
  showPanel: () => Promise<void>;
  /** Injectable so a test does not wait out the real poll. */
  sleep?: (ms: number) => Promise<void>;
}

const ASK = 'Ask It to Release';
const SHOW = 'Show MCP Server';
const REVEAL = 'Open That Window';

export class McpOwnershipController {
  private claimInFlight = false;
  /**
   * Set whenever this window gives the server up — by Stop MCP, or by
   * honouring another window's request. Without it the next session change
   * would take the server straight back through {@link tryClaim}, which is the
   * opposite of what was asked in both cases. Cleared only by an explicit claim.
   */
  private released = false;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: McpOwnershipDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** True once this window has deliberately given the server up. */
  get releasedByUser(): boolean {
    return this.released;
  }

  /**
   * Try to take the socket, saying nothing either way.
   *
   * This also runs unprompted — at activation, and on every session change —
   * so it must stay silent; {@link claim} is the version a user asked for.
   */
  async tryClaim(): Promise<void> {
    if (this.deps.socket.isOwner || this.claimInFlight || this.released) return;
    this.claimInFlight = true;
    try {
      const claimed = await this.deps.socket.start();
      this.deps.onChanged();
      if (!claimed) return;
      await this.deps.startHttps();
      this.deps.onChanged();
    } catch (err) {
      this.deps.notifier.log(`MCP claim failed: ${(err as Error).message}`);
    } finally {
      this.claimInFlight = false;
    }
  }

  /**
   * Claim, and always say what happened. Every claim a user asked for comes
   * through here — the command, the tab's button, and the retry after a
   * release request — because a claim that fails silently is indistinguishable
   * from a dead button.
   */
  async claim(): Promise<void> {
    if (this.deps.socket.isOwner) {
      this.deps.notifier.info('This window already serves MCP.');
      return;
    }
    this.released = false;
    await this.tryClaim();
    if (this.deps.socket.isOwner) {
      const session = this.deps.selectedSessionLabel();
      this.deps.notifier.info(
        session
          ? `This window now serves MCP, on ${session}.`
          : 'This window now serves MCP. Select a session for Claude’s tools to act on.',
      );
      return;
    }
    // A bind only fails because someone else holds the socket, so offer the
    // thing that can actually resolve it rather than merely reporting.
    const owner = this.deps.ownership();
    const where =
      owner.kind === 'other' ? ` ("${owner.info.workspaceName ?? owner.info.workspacePath}")` : '';
    const choice = await this.deps.notifier.warn(
      `Another VS Code window${where} is still serving MCP. A bound socket is only released ` +
        'by the window holding it.',
      ASK,
      SHOW,
    );
    if (choice === ASK) await this.requestRelease();
    if (choice === SHOW) await this.deps.showPanel();
  }

  /** Give the server up so another window can take it. */
  async stop(): Promise<void> {
    if (!this.deps.socket.isOwner) {
      this.deps.notifier.info('This window is not serving MCP.');
      return;
    }
    await this.release();
    this.deps.notifier.info(
      'This window has released the MCP server. Another Jasper window can claim it now.',
    );
  }

  /**
   * Ask whichever window owns the server to release it, then take it.
   *
   * The remote half of {@link stop}. Nothing about it is guaranteed — a window
   * running a Jasper without this protocol never answers — so the wait is
   * bounded and a timeout is reported against the window that ignored it,
   * rather than hanging.
   */
  async requestRelease(): Promise<void> {
    if (this.deps.socket.isOwner) {
      this.deps.notifier.info('This window already serves MCP.');
      return;
    }
    const owner = this.deps.ownership();
    if (owner.kind !== 'other') {
      // Nobody holds it, so there is nobody to ask. Just take it.
      await this.claim();
      return;
    }
    const { pid, workspacePath } = owner.info;
    writeReleaseRequest(
      { ownerPid: pid, requesterPid: this.deps.pid, requestedAt: new Date().toISOString() },
      this.deps.releaseRequestPath,
    );
    this.deps.notifier.log(`Asked MCP owner pid ${pid} (${workspacePath}) to release the server.`);

    const released = await this.deps.notifier.progress(
      'Asking the other window to release MCP…',
      async () => {
        // Poll rather than watch: we are waiting on another process to close a
        // socket, and its sidecar going away is the signal.
        for (let attempt = 0; attempt < RELEASE_WAIT_ATTEMPTS; attempt += 1) {
          await this.sleep(RELEASE_POLL_MS);
          if (this.deps.ownership().kind !== 'other') return true;
        }
        return false;
      },
    );

    if (!released) {
      clearReleaseRequest(this.deps.releaseRequestPath);
      const reveal = canRevealOwnerWindow(owner.info);
      const where = owner.info.workspaceName ?? workspacePath;
      const message =
        `The window "${where}" did not release the MCP server. It may be running a Jasper old ` +
        'enough not to answer the request — use Stop MCP there, or close it.';
      // Only offer to open it where that would actually reach it; elsewhere the
      // action would open a duplicate window and look like it had worked.
      const choice = reveal.canReveal
        ? await this.deps.notifier.warn(message, REVEAL)
        : await this.deps.notifier.warn(message);
      if (choice === REVEAL) await this.deps.revealOwner(workspacePath);
      this.deps.onChanged();
      return;
    }
    await this.claim();
  }

  /**
   * Answer a release request if one names this window. Called when anything
   * appears in the watched sidecar directory. Returns whether it released, so
   * a caller can tell an answered request from an irrelevant file event.
   */
  async handleReleaseRequest(): Promise<boolean> {
    if (!this.deps.socket.isOwner) return false;
    const request = readReleaseRequest(this.deps.releaseRequestPath);
    if (!requestsReleaseFrom(request, this.deps.pid)) return false;
    this.deps.notifier.log('Another Jasper window asked for the MCP server; releasing it.');
    await this.release();
    clearReleaseRequest(this.deps.releaseRequestPath);
    this.deps.notifier.info(
      'Another VS Code window asked for the MCP server, so this window released it.',
    );
    return true;
  }

  /** Drop both listeners and remember that we did. */
  private async release(): Promise<void> {
    await this.deps.stopHttps();
    await this.deps.socket.dispose();
    this.released = true;
    this.deps.notifier.log('MCP server released by this window.');
    this.deps.onChanged();
  }
}
