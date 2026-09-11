// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Evaluate mcpView.js in jsdom so it registers the global JasperMcpView,
// exactly as the webview does when it injects the file as a <script> tag.
beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../mcpView.js'), 'utf8');
  new Function(source)();
});

interface McpReportLike {
  state: 'disabled' | 'this' | 'other' | 'none';
  headline?: string;
  detail: string;
  socketPath?: string;
  httpsUrl?: string;
  servedSession?: string;
  owner?: {
    workspaceName?: string;
    workspacePath: string;
    workspaceFile?: string;
    pid: number;
    claimedAt: string;
    selectedSession?: string;
    canReveal: boolean;
    revealBlockedReason?: string;
  };
}

interface McpViewApi {
  render(
    root: HTMLElement,
    report: McpReportLike,
    readAt: string | undefined,
    vscode: { postMessage(msg: unknown): void },
  ): void;
}

function view(): McpViewApi {
  return (globalThis as unknown as { JasperMcpView: McpViewApi }).JasperMcpView;
}

let root: HTMLElement;
let posted: { command: string; [k: string]: unknown }[];
const vscode = {
  postMessage: (msg: unknown) => {
    posted.push(msg as { command: string });
  },
};

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  posted = [];
});

function buttons(): string[] {
  return Array.from(root.querySelectorAll('.actions button')).map((b) => b.textContent ?? '');
}

function click(label: string): void {
  const button = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === label);
  if (!button) throw new Error(`no button labelled "${label}" — have: ${buttons().join(', ')}`);
  button.click();
}

const serving: McpReportLike = {
  state: 'this',
  headline: 'MCP: this window',
  detail: 'served here',
  socketPath: '/tmp/jasper.sock',
  httpsUrl: 'https://127.0.0.1:27101/sse',
  servedSession: 'foo (id 7)',
};

const elsewhere: McpReportLike = {
  state: 'other',
  headline: 'MCP: other window',
  detail: 'served elsewhere',
  socketPath: '/tmp/jasper.sock',
  owner: {
    workspaceName: 'their-project',
    workspacePath: '/somewhere/else',
    pid: 4242,
    claimedAt: '2026-01-01T00:00:00.000Z',
    selectedSession: 'bar (id 3)',
    canReveal: true,
  },
};

const elsewhereMultiRoot: McpReportLike = {
  ...elsewhere,
  owner: {
    ...elsewhere.owner!,
    workspaceFile: '/their/proj.code-workspace',
    canReveal: false,
    revealBlockedReason:
      'That window has a multi-root workspace open, and the path above is only its first folder.',
  },
};

describe('the MCP Server tab', () => {
  it('offers Stop, not Claim, while this window serves', () => {
    view().render(root, serving, '10:00:00', vscode);

    expect(buttons()).toContain('Stop MCP');
    expect(buttons()).not.toContain('Claim MCP Server');
    click('Stop MCP');
    expect(posted).toEqual([{ command: 'stop' }]);
  });

  it('shows the socket and HTTPS endpoint, and copies either on click', () => {
    view().render(root, serving, '10:00:00', vscode);

    expect(root.textContent).toContain('/tmp/jasper.sock');
    expect(root.textContent).toContain('foo (id 7)');
    click('https://127.0.0.1:27101/sse');
    expect(posted).toEqual([{ command: 'copyText', text: 'https://127.0.0.1:27101/sse' }]);
  });

  it('says what a missing HTTPS listener costs, not just that it is missing', () => {
    view().render(root, { ...serving, httpsUrl: undefined }, '10:00:00', vscode);

    expect(root.textContent).toContain('Not listening');
    expect(root.textContent).toContain('custom connector has nothing to reach');
    // The stdio socket is a separate listener, so Claude Code is unaffected —
    // worth saying, since "not listening" reads as MCP being down.
    expect(root.textContent).toContain('Claude Code still works');
  });

  it('offers no Inspector button: launching it is a detour, not a readout', () => {
    // npx installs ~130 packages on first use and leaves the token-bearing URL
    // in terminal scrollback. It stays a palette command.
    view().render(root, serving, '10:00:00', vscode);
    expect(buttons()).toEqual(['Stop MCP', 'Refresh']);
  });

  it('explains each value the way the removed pane did on hover', () => {
    // The pane carried this on row tooltips; a page has room to show it.
    view().render(root, serving, '10:00:00', vscode);

    const hints = Array.from(root.querySelectorAll('.hint')).map((h) => h.textContent ?? '');
    expect(hints.join(' ')).toContain('Claude Code proxy connects to');
    expect(hints.join(' ')).toContain('Add custom connector');
    expect(hints.join(' ')).toContain('changes which database they use');
  });

  it('shows the socket path even when another window holds the server', () => {
    // One socket per machine, and it is what Claude's config points at, so it
    // is readable off whichever window is holding it.
    view().render(root, elsewhere, '10:00:00', vscode);

    expect(root.textContent).toContain('/tmp/jasper.sock');
    click('/tmp/jasper.sock');
    expect(posted).toEqual([{ command: 'copyText', text: '/tmp/jasper.sock' }]);
  });

  it('calls out an owning window that holds the server with no session', () => {
    // Strictly worse than unclaimed: every tool call fails, while sessions may
    // be logged in right here.
    view().render(
      root,
      { ...elsewhere, owner: { ...elsewhere.owner!, selectedSession: undefined } },
      '10:00:00',
      vscode,
    );

    expect(root.textContent).toContain('None selected');
    expect(root.textContent).toContain('every tool call');
  });

  it('names the owning window and offers to open it', () => {
    // The whole point of the tab: the socket is held until its owner lets go,
    // so a passive window has to be able to say where to go and take you there.
    view().render(root, elsewhere, '10:00:00', vscode);

    expect(root.textContent).toContain('/somewhere/else');
    expect(root.textContent).toContain('pid 4242');
    expect(root.textContent).toContain('bar (id 3)');
    click('Open Owning Window');
    expect(posted).toEqual([{ command: 'revealOwner', workspacePath: '/somewhere/else' }]);
  });

  it('names the owning window the way its title bar does', () => {
    // A path does not identify a window to a person; the title bar does.
    view().render(root, elsewhere, '10:00:00', vscode);
    expect(root.textContent).toContain('their-project');
  });

  it('shows the claim time in local form, keeping the exact stamp beside it', () => {
    view().render(root, elsewhere, '10:00:00', vscode);
    expect(root.textContent).toContain('2026-01-01T00:00:00.000Z');
    expect(root.textContent).toContain(new Date('2026-01-01T00:00:00.000Z').toLocaleString());
  });

  it('withholds the jump when it would open a duplicate window, and says why', () => {
    // Opening a multi-root owner's first folder gives a new single-folder
    // window — which looks like the switch worked. Worse than no button.
    view().render(root, elsewhereMultiRoot, '10:00:00', vscode);

    expect(buttons()).not.toContain('Open Owning Window');
    expect(root.textContent).toContain('multi-root workspace open');
    expect(root.textContent).toContain('/their/proj.code-workspace');
  });

  it('leaves the path unclickable when the jump is withheld', () => {
    view().render(root, elsewhereMultiRoot, '10:00:00', vscode);

    const dt = Array.from(root.querySelectorAll('dt')).find((d) => d.textContent === 'Workspace');
    expect(dt?.nextElementSibling?.querySelector('button')).toBeNull();
  });

  it('still offers the handover when the jump is withheld', () => {
    // Ask It to Release needs no navigation, so it is the way out of every
    // case the jump cannot serve.
    view().render(root, elsewhereMultiRoot, '10:00:00', vscode);
    expect(buttons()).toContain('Ask It to Release');
  });

  it('opens the owning window from the workspace path itself', () => {
    // The path is link-styled, so it has to navigate. It used to copy instead,
    // which beside an Open Owning Window button read as a dead link.
    view().render(root, elsewhere, '10:00:00', vscode);

    click('/somewhere/else');
    expect(posted).toEqual([{ command: 'revealOwner', workspacePath: '/somewhere/else' }]);
  });

  it('leads with Ask It to Release while another window holds the server', () => {
    // Claim cannot succeed against a bound socket, so the action that actually
    // resolves it is the one offered. Claim stays, demoted, because trying is
    // reasonable once the other window may already have let go.
    view().render(root, elsewhere, '10:00:00', vscode);

    expect(buttons()).toEqual([
      'Claim MCP Server',
      'Ask It to Release',
      'Open Owning Window',
      'Refresh',
    ]);
    click('Ask It to Release');
    expect(posted).toEqual([{ command: 'requestRelease' }]);
  });

  it('does not offer to ask anyone when nobody holds the server', () => {
    view().render(
      root,
      { state: 'none', headline: 'MCP: unclaimed', detail: '' },
      undefined,
      vscode,
    );
    expect(buttons()).not.toContain('Ask It to Release');
  });

  it('offers only Refresh when MCP is off in this window', () => {
    view().render(
      root,
      { state: 'disabled', detail: 'jasper.mcp.enabled is off' },
      '10:00:00',
      vscode,
    );

    expect(buttons()).toEqual(['Refresh']);
  });

  it('offers Claim when nobody is serving', () => {
    view().render(
      root,
      { state: 'none', headline: 'MCP: unclaimed', detail: '' },
      undefined,
      vscode,
    );

    expect(buttons()).toEqual(['Claim MCP Server', 'Refresh']);
  });

  it('stamps when it was read, so Refresh visibly did something', () => {
    view().render(root, serving, '10:04:05', vscode);
    expect(root.textContent).toContain('Read at 10:04:05');

    click('Refresh');
    expect(posted).toEqual([{ command: 'refresh' }]);
  });

  it('puts the read stamp on the title line, not at the end of the page', () => {
    // At the bottom it is the first thing to scroll out of a short window —
    // and it is the only evidence Refresh did anything.
    view().render(root, serving, '10:04:05', vscode);

    const stamp = root.querySelector('.stamp');
    const actions = root.querySelector('.actions');
    if (!stamp || !actions) throw new Error('expected a stamp and an actions row');

    expect(stamp.textContent).toBe('Read at 10:04:05');
    expect(stamp.parentElement?.classList.contains('state')).toBe(true);
    // Ahead of the actions, so it cannot be pushed off by a long owner section.
    const stampComesFirst = Boolean(
      stamp.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(stampComesFirst).toBe(true);
  });

  it('omits the stamp entirely when there is no read time', () => {
    view().render(root, serving, undefined, vscode);
    expect(root.querySelector('.stamp')).toBeNull();
  });

  it('redraws rather than appending, so a refresh does not stack panels', () => {
    view().render(root, elsewhere, '10:00:00', vscode);
    view().render(root, serving, '10:00:01', vscode);

    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(root.textContent).not.toContain('/somewhere/else');
  });
});
