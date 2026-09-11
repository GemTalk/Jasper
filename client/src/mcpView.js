/**
 * Webview-side behavior for the MCP Server panel (mcpPanel.ts).
 *
 * Like debuggerView.js, this is read at runtime via fs.readFileSync and
 * injected into the webview as a <script> tag — it is NOT compiled into the
 * bundle, so it must stay listed in .vscodeignore's re-includes. It lives in
 * its own file so the rendering can be unit-tested in jsdom (see
 * mcpView.test.ts) rather than being trapped in an inline <script> string.
 *
 * The host owns every action and all clipboard writes; this module owns the
 * DOM. Exposed as the global `JasperMcpView` so both the webview (classic
 * <script>) and tests (new Function(source)()) can reach it.
 *
 * The removed MCP Server pane could only explain itself through row tooltips —
 * what the socket is for, what HTTPS is for, that switching sessions changes
 * which database the tools hit. A page has room for that text, so it is
 * rendered under the value it describes rather than left on hover.
 */
(function () {
  var TITLES = {
    this: 'This window serves MCP',
    other: 'Another window serves MCP',
    none: 'No window is serving MCP',
    disabled: 'MCP is off in this window',
  };

  // Text the pane kept on hover, now visible. Kept together so the wording is
  // in one place rather than scattered through the renderers.
  var HINTS = {
    socket:
      'Local stdio socket the Claude Code proxy connects to. One per machine, so this is ' +
      'the same path in every VS Code window — the entry written into Claude’s config stays ' +
      'correct whichever window owns the server.',
    https: 'Endpoint for Claude Desktop’s “Add custom connector” and the MCP Inspector.',
    noHttps:
      'The HTTPS/SSE listener is not running, so Claude Desktop’s custom connector has nothing ' +
      'to reach (the stdio socket above is unaffected, so Claude Code still works). Its port ' +
      'may be held by another Jasper window; the GemStone Admin output channel says which.',
    servedHere:
      'MCP tools act on this session. Switching the active session in this window ' +
      'changes which database they use, with no need to re-claim.',
    noSessionHere:
      'Tool calls return “no session selected” until a session is selected ' +
      'in this window. The socket stays bound meanwhile, so Claude never sees a disconnect.',
    servedThere: 'MCP tools act on that window’s session, not on anything selected here.',
    noSessionThere:
      'That window holds the server with no session selected, so every tool call ' +
      'Claude makes fails — even though sessions are logged in here.',
    ownerWindow:
      'What that window’s title bar says — how to pick it out of a row of VS Code windows.',
    ownerWorkspace:
      'Click to open that window. A bound socket is only released by its owner, so ' +
      'Stop MCP has to be run there — or use Ask It to Release, which has it let go from here.',
    ownerWorkspaceFile:
      'That window has a multi-root workspace open; this is the .code-workspace file it was ' +
      'opened from.',
    ownerPid:
      'The extension host process holding the socket. Nothing else can release it — which is ' +
      'why Ask It to Release asks rather than takes.',
    ownerClaimed: 'When that window took the server.',
    askRelease:
      'Asks that window to release the server, then claims it here. It answers only if it is ' +
      'running a Jasper that knows how; otherwise this reports a timeout rather than waiting, ' +
      'and you can open it and use Stop MCP.',
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(label, className, onClick, title) {
    var b = el('button', className, label);
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  /**
   * One definition row: a term, a value, and optionally the sentence that
   * explains the value. `valueNode` is a span for plain data or a link button
   * for data that does something.
   */
  function row(dl, term, valueNode, hint) {
    dl.appendChild(el('dt', null, term));
    var dd = el('dd');
    dd.appendChild(valueNode);
    if (hint) dd.appendChild(el('div', 'hint', hint));
    dl.appendChild(dd);
  }

  function textValue(value) {
    return el('span', 'mono', value);
  }

  /**
   * A link-styled value. Every one of these does what its appearance promises:
   * the socket path and HTTPS URL copy themselves, because pasting them
   * elsewhere is their whole purpose, and the owning window's workspace path
   * opens that window, because that is what a path to another window reads as —
   * and is only rendered as a link where opening it would in fact reach that
   * window (see canRevealOwnerWindow); elsewhere it is plain text with the
   * reason beneath it.
   */
  function linkValue(value, title, onClick) {
    return button(value, 'link mono', onClick, title);
  }

  function copyValue(value, vscode) {
    return linkValue(value, 'Click to copy', function () {
      vscode.postMessage({ command: 'copyText', text: value });
    });
  }

  function section(root, heading) {
    var wrap = el('div', 'section');
    wrap.appendChild(el('h2', null, heading));
    var dl = el('dl');
    wrap.appendChild(dl);
    root.appendChild(wrap);
    return dl;
  }

  /**
   * Which actions apply in each state. Claim is offered whenever this window
   * is not already the owner — including while another window holds it, where
   * it is expected to fail: the host reports why, and that is more useful than
   * a button that isn't there.
   */
  function renderActions(root, report, vscode) {
    var actions = el('div', 'actions');

    if (report.state === 'this') {
      actions.appendChild(
        button(
          'Stop MCP',
          'secondary',
          function () {
            vscode.postMessage({ command: 'stop' });
          },
          'Release the server so another VS Code window can claim it.',
        ),
      );
    } else if (report.state !== 'disabled') {
      actions.appendChild(
        button(
          'Claim MCP Server',
          report.state === 'other' ? 'secondary' : null,
          function () {
            vscode.postMessage({ command: 'claim' });
          },
          report.state === 'other'
            ? 'Tries to take the socket. It will not succeed until the window holding it lets ' +
                'go — Ask It to Release does that first.'
            : 'Make this window the one Claude’s GemStone tools are answered by.',
        ),
      );
    }

    if (report.state === 'other' && report.owner) {
      var owner = report.owner;
      // Claim alone cannot succeed here — the socket is bound — so the action
      // that actually resolves it sits right beside it.
      actions.appendChild(
        button(
          'Ask It to Release',
          null,
          function () {
            vscode.postMessage({ command: 'requestRelease' });
          },
          HINTS.askRelease,
        ),
      );
      // Withheld where opening the path would not reach that window; the
      // Workspace row says why, and Ask It to Release works regardless.
      if (owner.canReveal) {
        actions.appendChild(
          button(
            'Open Owning Window',
            'secondary',
            function () {
              vscode.postMessage({
                command: 'revealOwner',
                workspacePath: owner.workspacePath,
              });
            },
            HINTS.ownerWorkspace,
          ),
        );
      }
    }

    actions.appendChild(
      button(
        'Refresh',
        'secondary',
        function () {
          vscode.postMessage({ command: 'refresh' });
        },
        'Re-read ownership from the socket and the owner sidecar.',
      ),
    );

    root.appendChild(actions);
  }

  function renderThisWindow(root, report, vscode) {
    var dl = section(root, 'This window');
    if (report.servedSession) {
      row(dl, 'Session served', textValue(report.servedSession), HINTS.servedHere);
    } else {
      row(dl, 'Session served', textValue('None selected'), HINTS.noSessionHere);
    }
    if (report.socketPath) {
      row(dl, 'Socket', copyValue(report.socketPath, vscode), HINTS.socket);
    }
    if (report.httpsUrl) {
      row(dl, 'HTTPS', copyValue(report.httpsUrl, vscode), HINTS.https);
    } else {
      row(dl, 'HTTPS', textValue('Not listening'), HINTS.noHttps);
    }
  }

  /** ISO 8601 is what the sidecar stores; a person reads a local time. */
  function readableTime(iso) {
    var when = new Date(iso);
    if (isNaN(when.getTime())) return iso;
    return when.toLocaleString() + ' (' + iso + ')';
  }

  function renderOwningWindow(root, report, vscode) {
    var owner = report.owner;
    var dl = section(root, 'Owning window');
    if (owner.workspaceName) {
      row(dl, 'Window', textValue(owner.workspaceName), HINTS.ownerWindow);
    }
    if (owner.canReveal) {
      row(
        dl,
        'Workspace',
        linkValue(owner.workspacePath, 'Click to open this window', function () {
          vscode.postMessage({ command: 'revealOwner', workspacePath: owner.workspacePath });
        }),
        HINTS.ownerWorkspace,
      );
    } else {
      // Offering the jump where it would open a duplicate window is worse than
      // not offering it: it looks like the switch worked.
      row(dl, 'Workspace', textValue(owner.workspacePath), owner.revealBlockedReason);
    }
    if (owner.workspaceFile) {
      row(dl, 'Workspace file', textValue(owner.workspaceFile), HINTS.ownerWorkspaceFile);
    }
    row(dl, 'Process', textValue('pid ' + owner.pid), HINTS.ownerPid);
    row(dl, 'Claimed', textValue(readableTime(owner.claimedAt)), HINTS.ownerClaimed);
    if (owner.selectedSession) {
      row(dl, 'Session served', textValue(owner.selectedSession), HINTS.servedThere);
    } else {
      row(dl, 'Session served', textValue('None selected'), HINTS.noSessionThere);
    }
    // The socket path is the same in every window, and it is what the Claude
    // config points at — worth having here rather than only while we own it.
    if (report.socketPath) {
      row(dl, 'Socket', copyValue(report.socketPath, vscode), HINTS.socket);
    }
  }

  function render(root, report, readAt, vscode) {
    root.innerHTML = '';

    var head = el('div', 'state');
    head.appendChild(el('span', 'dot ' + report.state));
    head.appendChild(el('h1', null, TITLES[report.state] || 'MCP Server'));
    // The read time rides on the title line rather than trailing the page: it
    // is the feedback that Refresh did something, and at the bottom it is the
    // first thing to fall off the end of a short window.
    if (readAt) head.appendChild(el('span', 'stamp', 'Read at ' + readAt));
    root.appendChild(head);
    root.appendChild(el('p', 'detail', report.detail));

    renderActions(root, report, vscode);

    if (report.state === 'this') renderThisWindow(root, report, vscode);
    if (report.state === 'other' && report.owner) renderOwningWindow(root, report, vscode);
  }

  var api = {
    init: function (dom, vscode) {
      window.addEventListener('message', function (event) {
        var msg = event.data;
        if (msg && msg.command === 'report') {
          render(dom.root, msg.report, msg.readAt, vscode);
        }
      });
    },
    // Exported for tests, which drive render directly rather than through
    // the message listener.
    render: render,
  };

  if (typeof window !== 'undefined') window.JasperMcpView = api;
  if (typeof globalThis !== 'undefined') globalThis.JasperMcpView = api;
})();
