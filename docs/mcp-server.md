# MCP Server

Jasper embeds an [MCP](https://modelcontextprotocol.io) server that exposes the
GemStone IDE's query and code-execution surface to AI clients. Tools act on the
**currently active GemStone session** in the owning Jasper window — there are
no separate credentials, no per-database subprocesses, and no off-host
listeners.

## Quick reference

| Surface | Endpoint | Used by |
|---------|----------|---------|
| stdio (via local proxy) | `~/.jasper/mcp.sock` (Unix) / `\\.\pipe\jasper-mcp` (Windows) | Claude Code, Claude Desktop |
| HTTPS/SSE | `https://127.0.0.1:27101/sse` | "Add custom connector" UIs, MCP Inspector, any URL-based client |

Both surfaces are served by the same Jasper window and share the same active
session — what you see from one transport is what you see from the other.

## Architecture

```
   Claude Code ────┐
                   │ stdio (JSON-RPC)
   Claude Desktop ─┤
                   │
                   ▼
        mcp-server/out/index.js  ◄── launched per-client by the client
        (the "proxy" — one Node process per MCP connection)
                   │
                   │ Unix socket / named pipe
                   ▼
   ╔═════════════════════════════════════════════════╗
   ║ Jasper VS Code extension (the "owning" window)  ║
   ║                                                 ║
   ║   McpSocketServer  ◄──── listens on the socket  ║
   ║         │                                       ║
   ║         ▼                                       ║
   ║   registerMcpTools(getSession)                  ║
   ║         │                                       ║
   ║         ▼                                       ║
   ║   GemStone session (the active one in this      ║
   ║   window — switches as the user switches)       ║
   ╚═════════════════════════════════════════════════╝
                 ▲
                 │ HTTPS/SSE (TLS to 127.0.0.1)
                 │
        Claude Desktop "Add custom connector",
        MCP Inspector, MCP-aware editors
```

Three Node processes are involved on a typical install:

1. **The Jasper extension host** ([`client/src/mcpSocketServer.ts`](../client/src/mcpSocketServer.ts), [`client/src/mcpHttpServer.ts`](../client/src/mcpHttpServer.ts)) — owns the GemStone session, executes tools, serves both transports.
2. **The proxy** ([`mcp-server/src/index.ts`](../mcp-server/src/index.ts)) — a tiny per-connection Node process that Claude Code/Desktop launch as a subprocess. It connects to Jasper's socket and forwards JSON-RPC frames in both directions. This indirection lets clients that expect a `command + args` stdio server attach to the long-running extension host.
3. **The MCP Inspector** (optional, launched on demand) — a browser UI for poking at the server. Run via the `GemStone: Open MCP Inspector` command.

All three speak the same MCP wire protocol; the difference is just whether the transport is a pipe, a TCP socket, or HTTPS.

## Ownership model

The socket and HTTPS port are global resources, so only one Jasper window can serve MCP at a time. Ownership is decided lazily:

- **On activation**, every Jasper window with `jasper.mcp.enabled` set writes
  the well-known `mcpServers.jasper` entry into `~/.claude.json` and into
  Claude Desktop's global config. Both entries point at the **fixed** socket
  path, so they're correct no matter which window ends up owning it. No
  window then attempts to bind the socket and HTTPS port straight away, before
  it has a session: Claude Code fails the proxy on a short timeout, so the
  socket has to be live by the time it spawns the proxy on the same window
  reload. With the setting off, the window does none of this: no config is
  written, no socket or port is claimed, and the MCP commands are gated out of
  the UI (`jasper.mcpAvailable`, which also covers the no-folder-open case)
  rather than left to fail when used.
- **The successful claimant** becomes the **MCP owner** for the rest of that
  VS Code run, and writes a sidecar file at `~/.jasper/mcp.owner.json` so other
  Jasper windows can tell that someone else holds the role — and which window
  that is.
- **Once owned, the socket stays bound across logout/login cycles.** Tool calls
  during a logged-out gap return "no session selected"; the moment the user
  logs back in, tools resume working. Claude Code's MCP connection never sees
  a disconnect.
- **Ownership is released only by its owner** — `GemStone: Stop MCP Server`, or
  the window closing. A claim from another window cannot take a socket that is
  still bound, which is why the owning window has to be identified and told to
  stop rather than simply overruled.
- **A passive window can ask for it.** `mcp.release-request.json`, written
  beside the sidecar, names the pid being asked; the owner is already watching
  that directory, sees its own pid, releases and deletes the request. The
  asking window then polls for the socket to come free and claims it. The
  request is a request, not a seizure: the owner closes its own socket and
  HTTPS listener in its own process, a request naming a different pid is left
  alone, a window never honours its own request (which would be a release
  loop), and anything older than a minute is ignored so an asker that died
  cannot unseat the next owner. A window running a Jasper without this
  protocol simply never answers — the asker reports a timeout rather than
  hanging, and points at Stop MCP in that window.

This means MCP "follows the work" — the window the user is actually using is
the one the AI talks to.

## The MCP Server tab

`GemStone: Show MCP Server`, or the plug button on the **Databases** section
header, opens one tab that answers every MCP question in a single place:
whether this window serves MCP, which session its tools act on, the socket path
(in every state — there is one per machine, and it is what Claude's config
points at) and the HTTPS endpoint, each copied by clicking it, and — when
another window holds the server — that window's workspace, pid, claim time and
selected session.

Every value carries the sentence explaining it, which the removed pane could
only fit on a row tooltip: what the socket is for, what the HTTPS endpoint is
for, and that switching the active session in the owning window changes which
database the tools hit without any re-claim. An owning window holding the
server with *no* session selected says so explicitly — every tool call fails,
which is strictly worse than an unclaimed server.

It is also where the actions are, including the two that need each other:

- **Claim MCP Server** takes the server for this window.
- **Stop MCP** releases it, so another window can claim it. The old pane had no
  release at all — when a window owned the server it showed status and nothing
  to act on — so the only way to hand MCP over was to close or disable Jasper
  in the owning window.
- **Ask It to Release** is the remote form of that: it has the *other* window
  let go, then claims here. This is the action offered when another window
  holds the server, because Claim alone cannot succeed against a bound socket.
- **Open Owning Window** focuses the window currently serving MCP, by opening
  its workspace folder — VS Code focuses an already-open folder rather than
  opening it twice. Best effort: an owner with no folder open, or one whose
  sidecar recorded only the first folder of a multi-root workspace, cannot be
  reached this way and says so.
- **Refresh** re-reads ownership from the socket and sidecar.

**Open MCP Inspector is deliberately not on the tab.** It shells out to `npx`,
whose first run on a machine installs around 130 packages — minutes on a slow
link, with almost no output — and then prints a token-bearing URL that exists
only in terminal scrollback. That is a detour, not a readout, so it stays the
`GemStone: Open MCP Inspector` palette command.

The tab is offered even with `jasper.mcp.enabled` off, because that is exactly
when someone is hunting for why Claude has no GemStone tools — it is the thing
that says so.

The **Databases** section header carries the same state at a glance —
`MCP: this window`, `MCP: other window`, or `MCP: unclaimed`, and nothing at all
when MCP is off in this window. It is on that header, rather than on a session
or database row, because claiming the server is a property of the *window*:
there is exactly one Databases header per window, and a user has several rows.

## Which session does MCP use?

The owning window's **currently active session** — the one selected in the
Sessions view (or shown in the status bar `$(database) <label>` indicator). If
the owning window has two logins, MCP tools act on whichever one is active
*right now*. Switching sessions in the owning window changes which database
the AI sees on the next tool call.

The **Logins & Sessions** view shows the live answer on the session itself: the
row MCP is serving is marked `· MCP` in its description. That is the only thing
a session row says about MCP, and the only part of MCP that is genuinely
session-scoped — claiming the server belongs to the window, and lives on the
Databases header and in the MCP Server tab.

## Client registration

Three clients are wired up out of the box. Each gets the same `jasper` entry pointing at the proxy script + socket path. (The server is named `jasper`, not `gemstone`, so the name `gemstone` stays free for the separate GemStone-native MCP server.)

### Claude Code

- **Config file:** `~/.claude.json` (top-level `mcpServers.jasper`, user-scope)
- **Written by:** [`client/src/claudeCodeUserMcpConfig.ts`](../client/src/claudeCodeUserMcpConfig.ts)
- **Always on.** The Claude Code CLI is the same on all platforms, so one path covers macOS/Linux/Windows.
- Claude Code snapshots its MCP server list when each session starts. The
  *first* time Jasper writes the entry, any Claude Code session already running
  in that VS Code window won't see it via `/mcp` until it re-activates — Jasper
  detects this case and pops a one-time **"Reload Window"** prompt. Every
  subsequent VS Code launch is silent.
- Leftovers from earlier Jasper versions are stripped on each activation: the
  pre-rename top-level `gemstone` entry, and any project-scope `gemstone`
  entries left by older `claude mcp add` shell-outs. Only Jasper's own entries
  are removed — a `gemstone` entry belonging to something else (e.g. the
  GemStone-native MCP server) is left untouched.

### Claude Desktop

- **Config file (macOS):** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Config file (Windows):** `%APPDATA%\Claude\claude_desktop_config.json`
- **Config file (Linux):** `~/.config/Claude/claude_desktop_config.json`
- **Written by:** [`client/src/mcpSocketServer.ts`](../client/src/mcpSocketServer.ts)`#writeClaudeDesktopMcpConfig`
- **Controlled by:** `jasper.mcp.registerWithClaudeDesktop` (default `true`).
  Set to `false` if you do not want Jasper touching this file.
- The Linux path is the conventional XDG location; an official Claude Desktop
  Linux build does not exist at the time of writing, but the path is the right
  one for community/unofficial builds and for future-proofing.

### MCP Inspector

- Launched on demand by the `GemStone: Open MCP Inspector` command.
- Runs `npx @modelcontextprotocol/inspector` in a dedicated terminal with
  `NODE_EXTRA_CA_CERTS` set so Node's TLS stack accepts Jasper's self-signed
  cert (OS keychain trust does not apply to Node).
- The command is run **without** `npx --yes`, so the first launch on a machine
  stops at npx's own `Ok to proceed? (y)` prompt and waits for an answer in
  that terminal. That is deliberate: Jasper does not approve a package
  installation on the user's behalf. It does mean the Inspector appears to hang
  until the prompt is answered, so the button that launches it says so.

### Other clients

Anything that can run an `command + args` stdio MCP server can use Jasper:

```jsonc
{
  "mcpServers": {
    "jasper": {
      "command": "node",
      "args": [
        "/absolute/path/to/extension/mcp-server/out/index.js",
        "--proxy-socket",
        "/Users/<you>/.jasper/mcp.sock"
      ]
    }
  }
}
```

The proxy script lives at `<extension-install-dir>/mcp-server/out/index.js` —
on a marketplace install that path includes the version, so let Jasper's
auto-registration handle it where possible.

For URL-based clients (Cursor's remote MCP, custom integrations, web tooling),
use the HTTPS/SSE endpoint after trusting the cert (see below).

## TLS for HTTPS/SSE

The HTTPS surface lives on `127.0.0.1` only and uses a self-signed cert that
Jasper generates on first run. The cert is stored in the extension's global
storage directory and is shared across workspaces.

Steps to use:

1. Run `GemStone: Install MCP TLS Certificate` from the Command Palette.
2. Choose **Run in Terminal** (macOS will prompt for an admin password) or
   copy the command and run it yourself. This trusts the cert system-wide.
3. Run `GemStone: Copy MCP Server URL` and paste it into the connector dialog.

Trusting the cert is per-machine, not per-workspace. You only do it once.

## Multiple VS Code windows

Several Jasper windows can run side-by-side, but only one serves MCP at a
time. In a passive window no session row is marked `· MCP`, the Databases
header reads `MCP: other window`, and the MCP Server tab names the window that
holds it and offers to open it. Taking the server over is **Ask It to Release**
in the MCP Server tab, which has the owner let go and then claims here; failing
that (an owner too old to answer), **Stop MCP** there and **Claim MCP Server**
here. To run two MCP-serving windows simultaneously:

- The stdio surface is one-per-machine (fixed socket path).
- Override `jasper.mcp.httpPort` in the second workspace's
  `.vscode/settings.json` to give it its own HTTPS port. The two windows can
  then both serve HTTPS, but only one serves stdio.

This is intentional. A single AI client should not be routed to two different
GemStone sessions depending on timing — the ownership model makes the routing
predictable and visible.

## Tool surface

The full tool list lives in [`client/src/mcpTools.ts`](../client/src/mcpTools.ts). Roughly, they fall into:

- **Class & method browsing** — `list_classes`, `describe_class`, `get_method_source`, `find_implementors`, `find_senders`, `find_references_to`, `search_method_source`, `get_class_definition`, `get_class_hierarchy`, `export_class_source`.
- **Code execution** — `execute_code`, `eval_python`, `compile_method`, `compile_python`, `compile_class_definition`, `delete_method`, `delete_class`.
- **Session control** — `commit`, `abort`, `refresh`, `status`.
- **Dictionaries** — `list_dictionaries`, `list_dictionary_entries`, `add_dictionary`, `remove_dictionary`, `list_all_classes`.
- **Testing** — `list_test_classes`, `list_failing_tests`, `run_test_class`, `run_test_method`, `describe_test_failure`.
- **Misc** — `set_class_comment`, `list_methods`, `search_method_source`.

All tools share the same query/execution layer as the IDE itself
([`client/src/queries/`](../client/src/queries/)), so the AI sees exactly what
a human looking at the Browser/Inspector would see.

## Limitations

- **Single owner.** Only one Jasper window can serve stdio MCP at a time. This
  is a feature (predictable routing), not a bug to fix.
- **Single session per call.** Tools always act on the owning window's
  currently active session. The AI cannot fan out across multiple sessions in
  one call.
- **127.0.0.1 only.** No off-host listener, by design. Remote AI access would
  require an explicit tunnel (e.g. SSH port-forward) and is the user's
  responsibility.
- **Self-signed TLS only.** No ACME, no user-supplied certs yet — the
  expectation is local-only use.
- **Node.js required on PATH** for the stdio proxy to launch. Most developer
  machines already meet this; bare server installs may not.
- **GemStone on macOS cannot detect stale stoned locks.** This is a GemStone
  limitation, not an MCP one, but it surfaces here because killing/restarting
  the stone affects which session MCP can use. See the **Processes** view's
  *Delete Stale Lock File* action for the workaround.
- **No write-side audit trail.** Tools that mutate state (`compile_method`,
  `delete_class`, `commit`) act with the active session's full privileges and
  leave no Jasper-side log. Use the regular GemStone audit facilities if you
  need one.

## Implementation reference

- [`client/src/mcpSocketServer.ts`](../client/src/mcpSocketServer.ts) — socket listener, ownership claim, config writers, sidecar.
- [`client/src/mcpHttpServer.ts`](../client/src/mcpHttpServer.ts) — HTTPS/SSE listener, TLS cert plumbing.
- [`client/src/mcpTools.ts`](../client/src/mcpTools.ts) — tool registration; the one place every tool is declared.
- [`client/src/mcpOwnerSidecar.ts`](../client/src/mcpOwnerSidecar.ts) — sidecar read/write/PID-liveness check behind the ownership readout.
- [`client/src/mcpReleaseRequest.ts`](../client/src/mcpReleaseRequest.ts) — the release-request file, and the rules an owner applies before honouring one.
- [`client/src/mcpOwnership.ts`](../client/src/mcpOwnership.ts) — `McpOwnershipController`: claiming, releasing, and the handover handshake. It takes a dependency bag rather than living in `activate()`, because these are the decisions worth testing and nothing in `activate()` can be reached by a test.
- [`client/src/mcpServerTreeProvider.ts`](../client/src/mcpServerTreeProvider.ts) — `resolveOwnership`, which reduces socket state + sidecar to a three-state answer. (The tree provider in this file is no longer contributed as a view.)
- [`client/src/mcpWindowStatus.ts`](../client/src/mcpWindowStatus.ts) — turns that answer into the report the Databases header and the MCP Server tab both render.
- [`client/src/mcpPanel.ts`](../client/src/mcpPanel.ts) + [`client/src/mcpView.js`](../client/src/mcpView.js) — the MCP Server tab: host and webview.
- [`client/src/loginTreeProvider.ts`](../client/src/loginTreeProvider.ts) — `sessionMcpState`, the `· MCP` mark on the served session row.
- [`client/src/claudeCodeUserMcpConfig.ts`](../client/src/claudeCodeUserMcpConfig.ts) — `~/.claude.json` writer.
- [`mcp-server/src/index.ts`](../mcp-server/src/index.ts) — the stdio proxy script that clients launch.
- [`client/src/tlsCert.ts`](../client/src/tlsCert.ts) — TLS cert generation and on-disk layout.
