// Webview-side script for the GemStone Manager panel (gemstoneManager.ts).
// Plain JS that runs in the webview DOM (not bundled). Renders the state posted
// by the host and dispatches every action back to the host as a postMessage.
// Exposes a single global `GemstoneManager` so it can be unit-tested in jsdom.
//
// Convention (see debuggerView.js): host injects this, then calls
// GemstoneManager.init(refs, vscode) from a nonce'd bootstrap <script>. The whole
// panel is built from plain HTML styled with --vscode-* theme variables and the
// codicon font — no web-component framework — so it renders natively and can
// never degrade to unstyled boxes when a runtime bundle fails to load.
(function () {
  let vscode;
  let els;
  // dirNames of databases the user has expanded — preserved across re-renders.
  const expandedDbs = new Set();
  // dirNames whose Files group the user opened — Files starts closed.
  const expandedFiles = new Set();
  // Sections the user has opened or closed by hand, against whatever the panel
  // would have chosen — their answer, kept across re-renders.
  const sectionChoice = new Map();
  // Windows with WSL: gates the actions that only mean anything there.
  let windowsHost = false;
  // The last state drawn, so the tour can be started from a click without the
  // host having to post it again.
  let lastState = {};

  // Internal key -> the real codicon name. This is the single place a key is
  // translated; nothing else invents a glyph.
  const CODICON = {
    memory: 'server-environment',
    versions: 'versions',
    database: 'database',
    download: 'cloud-download',
    install: 'desktop-download',
    folder: 'folder',
    folderOpen: 'folder-opened',
    trash: 'trash',
    play: 'play',
    stop: 'debug-stop',
    terminal: 'terminal',
    reveal: 'eye',
    login: 'key',
    swap: 'arrow-swap',
    plus: 'add',
    warn: 'warning',
    gear: 'gear',
    check: 'check',
    target: 'target',
    plug: 'plug',
    signIn: 'sign-in',
    listTree: 'list-tree',
    notebook: 'notebook',
    discard: 'discard',
    disconnect: 'debug-disconnect',
    pulse: 'pulse',
    files: 'files',
    output: 'output',
    archive: 'archive',
    restore: 'history',
    refresh: 'refresh',
  };

  /** The codicon name for an internal key (or the name itself, if already one). */
  function codicon(key) {
    return CODICON[key] || key;
  }

  /** An inline codicon glyph. */
  function icon(key) {
    return `<i class="codicon codicon-${codicon(key)}" aria-hidden="true"></i>`;
  }

  const ICONS = Object.fromEntries(Object.keys(CODICON).map((k) => [k, icon(k)]));

  /** How long something has been up, phrased as a duration rather than an instant. */
  function since(ms) {
    const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
    // gslist reports a start time to the minute, so anything younger than one
    // rounds to zero — and "running 0 min" reads like a fault rather than a
    // stone that came up a moment ago.
    if (mins < 1) return 'just started';
    if (mins < 60) return `running ${mins} min`;
    const hours = Math.round(mins / 60);
    if (hours < 48) return `running ${hours} h`;
    return `running ${Math.round(hours / 24)} d`;
  }

  /** A codicon used as a state mark, tinted by class rather than drawn by hand. */
  function mark(name, tone, title) {
    return `<i class="codicon codicon-${name} mark ${tone}" title="${esc(title)}" aria-hidden="true"></i>`;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  }

  // The twin of formatBytes in gemstoneManager.ts — this script runs in the
  // webview DOM and cannot import from the extension bundle, so keep the two in
  // step. The one difference is deliberate: nothing to measure renders as
  // nothing here, where the host is always formatting a figure it has.
  function formatBytes(n) {
    if (!n || n <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v >= 10 || i === 0 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
  }

  // A button. Ordinary buttons carry a label (and maybe a leading icon); icon-only
  // buttons are a bare glyph with an accessible label. `cls` picks the visual
  // weight: `btn-primary` is the one filled call to action; everything else is the
  // quieter secondary treatment.
  function btn(action, label, iconKey, cls, attrs) {
    const a = attrs || {};
    const data =
      (a.version ? ` data-version="${esc(a.version)}"` : '') +
      (a.dir ? ` data-dir="${esc(a.dir)}"` : '') +
      (a.folder ? ` data-folder="${esc(a.folder)}"` : '') +
      (a.login ? ` data-login="${esc(a.login)}"` : '') +
      (a.name ? ` data-name="${esc(a.name)}"` : '');
    const title = ` title="${esc(a.title || label)}"`;

    if (a.iconOnly) {
      return `<button type="button" class="icon-btn" data-action="${action}"${data}${title} aria-label="${esc(label)}">${icon(iconKey)}</button>`;
    }
    const variant = cls === 'btn-primary' ? ' btn-primary' : '';
    const glyph = iconKey ? `${icon(iconKey)}` : '';
    return `<button type="button" class="btn${variant}" data-action="${action}"${data}${title}>${glyph}<span>${esc(label)}</span></button>`;
  }

  /** A pill counter/label, styled off --vscode-badge-*. */
  function badge(text, kind) {
    return `<span class="badge${kind ? ` badge-${kind}` : ''}">${esc(text)}</span>`;
  }

  // A section is a native disclosure: a header that toggles a body, with the
  // free keyboard and focus handling <details>/<summary> already provide.
  //   opts: { key, title, desc, count (badge on the right), actions (html), open }
  function section(opts, bodyHtml) {
    const desc = opts.desc ? `<span class="section-desc">${esc(opts.desc)}</span>` : '';
    // A count is passive inventory, not an alert, so it reads as muted text — the
    // badge token is reserved for things that actually want the eye.
    const count = opts.count != null ? `<span class="section-count">${esc(opts.count)}</span>` : '';
    const right =
      count || opts.actions
        ? `<span class="section-head-actions">${count}${opts.actions || ''}</span>`
        : '';
    return `<details class="section" data-section="${esc(opts.key || opts.title)}"${opts.open ? ' open' : ''}>
      <summary class="section-head">
        <i class="codicon codicon-chevron-right section-twist" aria-hidden="true"></i>
        <span class="section-title">${esc(opts.title)}</span>
        ${desc}
        ${right}
      </summary>
      <div class="section-body">${bodyHtml}</div>
    </details>`;
  }

  // A group inside a database's body — the same disclosure idiom, one weight down.
  function group(opts, bodyHtml) {
    const data =
      (opts.group ? ` data-group="${esc(opts.group)}"` : '') +
      (opts.db ? ` data-db="${esc(opts.db)}"` : '');
    const desc = opts.desc ? `<span class="group-desc">${esc(opts.desc)}</span>` : '';
    return `<details class="db-group"${data}${opts.open ? ' open' : ''}>
      <summary class="db-group-head">
        <i class="codicon codicon-chevron-right section-twist" aria-hidden="true"></i>
        <span class="db-group-title">${esc(opts.title)}</span>
        ${desc}
        ${opts.actions ? `<span class="db-group-actions">${opts.actions}</span>` : ''}
      </summary>
      <div class="db-group-body">${bodyHtml}</div>
    </details>`;
  }

  // ── OS section ──────────────────────────────────────────────────────────────
  // An OS "warning" is anything the user may need to fix: shared memory below
  // the 1 GB threshold, or state that couldn't be read at all.
  function osHasWarning(os) {
    return !!os.supported && (os.unknown || !os.sharedMemoryConfigured);
  }

  // A bare button doesn't explain itself. When a check fails, say what is wrong,
  // why it stops GemStone working, and what Quick Setup will actually do — it runs
  // the shared-memory script and then takes you all the way to a running database.
  function renderOsRemedy(os) {
    if (!osHasWarning(os)) return '';
    const problem = os.unknown
      ? `Jasper could not read this machine's shared-memory limits, so it can't tell whether a stone will start.`
      : `This machine allows ${esc(formatBytes(os.shmmaxBytes))}, short of the 1 GB a stone needs.`;
    return `<div class="os-remedy">
      <div class="os-remedy-body">
        <div class="os-remedy-head">${ICONS.warn}<span>Shared memory needs configuring</span></div>
        <p class="os-remedy-copy">GemStone keeps its object cache in shared memory, so the operating system has to allow a large enough segment before a stone will start. ${problem}</p>
        <p class="os-remedy-copy dim">Quick Setup runs the shared-memory script, then installs a GemStone version, creates a database, starts it, and adds a login you can connect with.</p>
      </div>
      <div class="os-remedy-action">${btn('quickSetup', 'Run Quick Setup', 'gear', 'btn-primary')}</div>
    </div>`;
  }

  // One row per prerequisite: what it is, what the machine says, and — only when
  // it is not ok — the one thing that fixes it. This is how the Configure OS tree
  // read, so a machine that cannot run a stone says which part is wrong.
  function renderOsChecks(checks) {
    if (!checks || !checks.length) return '';
    const rows = checks
      .map((c) => {
        const tone = c.state === 'ok' ? 'ok' : c.state === 'warn' ? 'warn' : 'off';
        const glyph =
          c.state === 'ok' ? 'pass-filled' : c.state === 'warn' ? 'warning' : 'circle-outline';
        const remedy = c.remedy
          ? `<button type="button" class="btn" data-action="osRemedy" data-cmd="${esc(c.remedy.command)}" title="${esc(c.remedy.note ? `${c.remedy.label} — ${c.remedy.note}` : c.remedy.label)}"><span>${esc(c.remedy.label)}</span></button>${
              c.remedy.note ? `<span class="os-check-note">${esc(c.remedy.note)}</span>` : ''
            }`
          : '';
        return `<li class="os-check">
          ${mark(glyph, tone, c.label)}
          <span class="os-check-label">${esc(c.label)}</span>
          <span class="os-check-detail mono dim">${esc(c.detail)}</span>
          <span class="os-check-action">${remedy}</span>
        </li>`;
      })
      .join('');
    return `<ul class="os-checks">${rows}</ul>`;
  }

  function renderOs(os, open, rootPath) {
    if (!os.supported) {
      return section(
        { key: 'os', title: 'Operating System', open },
        `<div class="note">${ICONS.warn}<span>OS prerequisites are not surfaced on this platform.</span></div>`,
      );
    }

    const body = `${renderOsRemedy(os)}
      ${renderOsChecks(os.checks)}
      <dl class="facts">
        <dt>Platform</dt><dd>${esc(os.platformLabel)}</dd>
        ${
          os.unknown
            ? ''
            : `<dt>shmmax</dt><dd class="mono">${esc(formatBytes(os.shmmaxBytes))}</dd>
               <dt>shmall</dt><dd class="mono">${os.shmallBytes ? esc(formatBytes(os.shmallBytes * 4096)) : '—'}</dd>`
        }
        <dt>Databases folder</dt>
        <dd class="facts-action">
          <span class="mono dim">${esc(rootPath || '')}</span>
          ${btn('openSettings', 'Change…', 'gear', 'btn-ghost')}
        </dd>
      </dl>`;
    return section({ key: 'os', title: 'Operating System', desc: os.platformLabel, open }, body);
  }

  // The actions a live session offers, mirroring the sidebar's inline set. They
  // only appear on a connected row: none of them mean anything without a session.
  const SESSION_ACTIONS = [
    ['gemstone.openBrowser', 'listTree', 'Open System Browser'],
    ['gemstone.sessionOpenWorkspace', 'notebook', 'Open Workspace'],
    ['gemstone.sessionCommit', 'check', 'Commit'],
    ['gemstone.sessionAbort', 'discard', 'Abort'],
    ['gemstone.sessionPing', 'pulse', 'Ping session'],
    ['gemstone.exportClasses', 'output', 'Export Classes'],
    ['gemstone.fullLogicalBackup', 'archive', 'Full Logical Backup'],
    ['gemstone.fullLogicalRestore', 'restore', 'Full Logical Restore'],
    ['gemstone.sessionLogout', 'disconnect', 'Log out'],
  ];

  function sessionActions(sessionId) {
    return SESSION_ACTIONS.map(
      ([cmd, ic, label]) =>
        `<button type="button" class="icon-btn login-act" data-action="sessionAction" data-session="${esc(sessionId)}" data-cmd="${cmd}" title="${label}" aria-label="${label}">${ICONS[ic]}</button>`,
    ).join('');
  }

  // ── Connect ────────────────────────────────────────────────────────────────
  // Connecting is what this screen is usually opened to do, so it leads the page
  // instead of sitting three levels down inside a database. Logins whose stone is
  // up are listed first and preselected, because those are the ones a click will
  // actually succeed on.
  function renderConnect(state, open) {
    const logins = state.logins || [];
    if (!logins.length) {
      return section(
        { key: 'connect', title: 'Connect', open },
        `<div class="connect-empty">
          <span>No logins yet — add one to connect to a stone.</span>
          ${btn('createLogin', 'New Login', 'plus', 'btn-primary')}
        </div>`,
      );
    }

    // GemStone's superuser sorts last: it is reached for rarely and should never
    // look like the obvious default.
    const isRoot = (l) => l.user === 'SystemUser';

    // One row per login, read left to right:
    //   <target> user  stone            <status / action>
    // The target marks the session the editor actually works through. The status
    // is the stone's business: a green light when it is up, and when it is not,
    // the button that fixes that and logs in.
    function loginRow(l) {
      const identity = `<span class="login-current">${l.current ? ICONS.target : ''}</span>
          <span class="login-user">${esc(l.user)}</span>
          <span class="login-stone">${esc(l.stone)}</span>`;

      // A stopped stone cannot be logged into, so the row itself does nothing and
      // the only affordance is the button that starts it first. A session already
      // open outranks that: it is first-hand knowledge that the stone is up,
      // where "running" is read from a process list this machine may have no way
      // to consult — and offering to start a stone you are working in reads as
      // the session not being there at all.
      if (!l.running && !l.connected) {
        return `<div class="login-row login-row-idle">
            <span class="login-main">${identity}</span>
            <span class="login-status">
              <button type="button" class="btn" data-action="startAndConnect" data-login="${esc(l.label)}" title="Start ${esc(l.stone)}, then log in as ${esc(l.user)}"><span>Start &amp; log in</span>${ICONS.play}</button>
            </span>
          </div>`;
      }

      const action = l.connected ? 'selectSession' : 'connectLogin';
      const hint = l.connected
        ? l.current
          ? 'This is the session Display It and Execute It run in'
          : `Work in this session instead`
        : `Log in to ${esc(l.stone)} as ${esc(l.user)}`;
      const data = l.connected
        ? ` data-session="${esc(l.sessionId)}"`
        : ` data-login="${esc(l.label)}"`;
      return `<div class="login-row${l.current ? ' login-row-current' : ''}${l.connected ? ' login-row-live' : ''}">
          <button type="button" class="login-main" data-action="${action}"${data} title="${hint}">${identity}</button>
          <span class="login-acts">${l.connected ? sessionActions(l.sessionId) : ''}</span>
          <span class="login-status">
            ${mark('circle-filled', 'ok', `${esc(l.stone)} is running`)}
            ${
              l.connected
                ? `<button type="button" class="btn" data-action="sessionAction" data-session="${esc(l.sessionId)}" data-cmd="gemstone.sessionLogout" title="Log out of ${esc(l.stone)}">${ICONS.disconnect}<span>Log out</span></button>`
                : `<button type="button" class="btn" data-action="connectLogin" data-login="${esc(l.label)}" title="Log in to ${esc(l.stone)} as ${esc(l.user)}"><span>Log in</span>${ICONS.signIn}</button>`
            }
          </span>
        </div>`;
    }

    // The current session leads the column; everything else is a list beneath it.
    const current = logins.find((l) => l.current);
    const others = logins
      .filter((l) => !l.current)
      .sort((a, b) => Number(isRoot(a)) - Number(isRoot(b)));
    // Connection state lives in the header (the description), not the body: when
    // connected it names the session, and when not it just says so.
    const lead = current ? `<div class="col-lead">${loginRow(current)}</div>` : '';

    const body = `${lead}
      ${others.length ? `<div class="login-rows col-rest">${others.map(loginRow).join('')}</div>` : ''}`;
    return section(
      {
        key: 'connect',
        title: 'Connect',
        desc: current ? `${current.user} · ${current.stone}` : 'Not connected',
        actions: btn('createLogin', 'New Login', 'plus', 'btn-ghost', { iconOnly: true }),
        open,
      },
      body,
    );
  }

  // ── Versions section ────────────────────────────────────────────────────────
  function versionState(v) {
    if (v.local) return 'local';
    if (v.extracted) return 'installed';
    if (v.downloaded) return 'downloaded';
    return 'available';
  }

  // Two action cells, the same in every row: a quiet icon, then the one primary
  // action. Install and Uninstall are mutually exclusive, so they share a cell.
  function versionActions(v) {
    const state = versionState(v);
    const cell = (html) => `<td class="v-cell">${html || ''}</td>`;
    const openFolder = btn('openVersionFolder', 'Open Folder', 'folder', 'btn-ghost', {
      version: v.version,
      iconOnly: true,
      title: 'Open product folder',
    });
    const openTerminal = btn('openVersionTerminal', 'Open Terminal', 'terminal', 'btn-ghost', {
      version: v.version,
      iconOnly: true,
      title: 'Open a terminal for this version',
    });
    // The Windows client is a separate download from the server product, and only
    // means anything on Windows.
    const client = !windowsHost
      ? ''
      : v.clientExtracted
        ? btn('openWindowsClientFolder', 'Open Client Folder', 'folderOpen', 'btn-ghost', {
            version: v.version,
            iconOnly: true,
            title: 'Open the Windows client folder',
          }) +
          btn('deleteWindowsClient', 'Delete Client', 'trash', 'btn-ghost', {
            version: v.version,
            iconOnly: true,
            title: 'Remove the extracted Windows client',
          })
        : btn('installWindowsClient', 'Install Client', 'install', 'btn-ghost', {
            version: v.version,
            iconOnly: true,
            title: 'Download and extract the Windows client',
          });

    if (state === 'downloaded') {
      return (
        cell(
          btn('deleteDownload', 'Delete Download', 'trash', 'btn-ghost', {
            version: v.version,
            iconOnly: true,
            title: 'Delete the downloaded archive',
          }),
        ) +
        cell(
          btn('extractVersion', 'Install', 'install', 'btn-primary', {
            version: v.version,
            title: 'Extract this version',
          }),
        )
      );
    }
    if (state === 'local') {
      return (
        cell(openFolder + openTerminal + client) +
        cell(
          btn('unregisterLocalVersion', 'Unregister', null, 'btn-ghost', {
            version: v.version,
            title: 'Remove the local symlink',
          }),
        )
      );
    }
    return (
      cell(openFolder + openTerminal + client) +
      cell(
        btn('uninstallVersion', 'Uninstall', 'trash', 'btn-ghost', {
          version: v.version,
          title: 'Remove the extracted product',
        }),
      )
    );
  }

  function pill(state) {
    const labels = {
      installed: 'Installed',
      downloaded: 'Downloaded',
      available: 'Available',
      local: 'Local',
    };
    return `<span class="badge badge-state state-${state}">${labels[state]}</span>`;
  }

  function versionsInstalledCount(versions) {
    return versions.filter((v) => v.extracted || v.local).length;
  }

  // ── Getting set up: the order, and where each step lives ────────────────────
  // The sections are ordered by what needs attention, which answers "what is
  // wrong" but not "what do I do first" — a new user reading Connect at the top
  // cannot tell that a version has to exist before any of it works. These steps
  // name that order once, and the tour below points at each section in turn.
  //
  // Every step reports whether it is already satisfied, so the sequence doubles
  // as a progress read: the first `todo` is where the user actually is.
  // The one action that moves a step forward, when exactly one choice is
  // obvious. Each is a message the section's own button already sends, so the
  // host runs the same command with the same confirmations, prompts and progress
  // — the callout is a shortcut to those controls, not a second implementation.
  // A label ending in an ellipsis is one that will ask the user something.
  function osDo(os) {
    const failing = (os.checks || []).find((c) => c.state !== 'ok' && c.remedy);
    return failing
      ? { command: 'osRemedy', action: failing.remedy.command, label: failing.remedy.label }
      : undefined;
  }

  function versionsDo(versions) {
    // Only while there is nothing installed. Once there is, the newest release
    // this machine lacks is an older one it never asked for, and offering to
    // fetch it is noise rather than help.
    if (versionsInstalledCount(versions || []) > 0) return undefined;
    // The list is newest first, so the first row not already on disk is the
    // newest release this machine could install.
    const next = (versions || []).find((v) => !v.extracted && !v.local);
    return next
      ? { command: 'installVersion', version: next.version, label: `Install ${next.version}` }
      : undefined;
  }

  // Creating a database with the defaults stays on offer after the first one:
  // the names are made unique against the databases that already exist, so a
  // second is as safe as the first.
  function databasesDo(databases) {
    return {
      command: 'createDatabaseDefaults',
      label: (databases || []).length
        ? 'Create another with the defaults'
        : 'Create one with the defaults',
    };
  }

  function connectDo(logins, databases) {
    const list = logins || [];
    // Already in. Offering to log in again would read as the session not being
    // there at all.
    if (list.some((l) => l.connected)) return undefined;
    if (!list.length) {
      const db = (databases || [])[0];
      return db
        ? { command: 'createDefaultLogin', dirName: db.dirName, label: 'Log in as DataCurator' }
        : { command: 'createLogin', label: 'Add a login…' };
    }
    // A login whose stone is up can be logged straight into; otherwise the stone
    // has to come up first, which the panel treats as one action.
    const up = list.find((l) => l.running);
    return up
      ? { command: 'connectLogin', login: up.label, label: `Log in as ${up.user}` }
      : {
          command: 'startAndConnect',
          login: list[0].label,
          label: `Start ${list[0].stone} and log in`,
        };
  }

  function tourSteps(state) {
    const steps = [];
    if (state.os && state.os.supported) {
      steps.push({
        section: 'os',
        title: 'Let the machine run a stone',
        body: 'GemStone keeps its object cache in shared memory, so the operating system has to allow a large enough segment before a stone will start. This section reads what this machine reports and carries the fix for anything short.',
        action:
          'Usually nothing — every row here is already ok on a machine that has run GemStone before. A row that is not carries the one button that fixes it.',
        do: osDo(state.os),
        done: !osHasWarning(state.os),
      });
    }
    steps.push({
      section: 'versions',
      title: 'Install a version',
      body: 'Nothing downstream can happen until a GemStone release is on disk — a database is made from one, and a login runs against one.',
      action:
        'Usually: + , then pick the newest release and let it download and install. Register Local instead if you already have a build on this machine.',
      do: versionsDo(state.versions),
      done: versionsInstalledCount(state.versions || []) > 0,
    });
    steps.push({
      section: 'databases',
      title: 'Create a database, and start it',
      body: 'A database is built from an installed version. Creating one asks four questions, each explained again as it is asked:',
      lines: [
        'Version — which installed release this database runs.',
        'Base extent — the starting repository to copy. extent0.dbf is the standard one.',
        'Stone name — the process that owns the repository, and the name you log in to.',
        'NetLDI name — the listener that starts a gem process for each session.',
      ],
      note: 'Once it exists, opening its row lists the log, configuration and backup files it owns: a configuration file opens in the editor to be changed by hand, and Terminal and Reveal open the database on disk for anything the panel does not cover.',
      action: 'Usually: + , accept the four defaults, then Start to bring the stone and NetLDI up.',
      do: databasesDo(state.databases),
      done: (state.databases || []).length > 0,
    });
    steps.push({
      section: 'connect',
      title: 'Log in',
      body: 'A login pairs a user with a stone. The session it opens is what the class browser, workspaces and the debugger all work through.',
      action:
        'Usually: + to add a login, then Log in. Use Start & log in when the stone is not running yet — it does both.',
      do: connectDo(state.logins, state.databases),
      done: (state.logins || []).some((l) => l.connected),
    });
    return steps;
  }

  // A line above the sections saying what is left and offering to point at it.
  // Quick Setup earns its place here: on a machine with nothing installed it does
  // all four steps in one go, and it is otherwise only offered inside the OS
  // warning — which a machine with healthy shared memory never shows.
  function renderHeader(state) {
    const steps = tourSteps(state);
    const todo = steps.filter((s) => !s.done);
    const nothingInstalled = versionsInstalledCount(state.versions || []) === 0;
    const lead = todo.length
      ? `<span class="gm-head-lead">Next: ${esc(todo[0].title.charAt(0).toLowerCase() + todo[0].title.slice(1))}</span>
         <span class="dim">${esc(steps.length - todo.length)} of ${esc(steps.length)} done</span>`
      : `<span class="gm-head-lead">Set up and connected.</span>`;
    const quick =
      nothingInstalled && !(state.databases || []).length
        ? btn('quickSetup', 'Run Quick Setup', 'gear', 'btn-primary')
        : '';
    return `<div class="gm-head">
      <div class="gm-head-text">${lead}</div>
      <div class="gm-head-acts">
        ${quick}
        <button type="button" class="btn" data-tour="start">${ICONS.target}<span>Show me how</span></button>
        ${btn('refresh', 'Refresh', 'refresh', null, { iconOnly: true, title: 'Read this machine again, and ask the download catalogue for new releases' })}
      </div>
    </div>`;
  }

  // ── The tour: a spotlight on one section at a time ──────────────────────────
  // The overlay is built in document.body rather than inside #root, because a
  // rebuild replaces #root wholesale — a tour anchored inside it would vanish the
  // moment anything in the environment changed. It re-anchors after each render
  // instead.
  let tour = null;

  function endTour() {
    if (!tour) return;
    const { overlay, onScroll, onKey, returnFocusTo } = tour;
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onScroll);
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    tour = null;
    // Hand focus back to the button that started it, so a keyboard user is not
    // dropped at the top of the document.
    const back = returnFocusTo && document.querySelector(returnFocusTo);
    if (back) back.focus();
  }

  /** The element a step points at: the section's header row. */
  function stepTarget(step) {
    return els.root.querySelector(`details.section[data-section="${step.section}"]`);
  }

  function positionTour() {
    if (!tour) return;
    const step = tour.steps[tour.index];
    const details = stepTarget(step);
    if (!details) {
      // The section a step names is not on the page (a platform that surfaces no
      // OS prerequisites, say). Nothing to point at, so leave the tour.
      endTour();
      return;
    }
    const head = details.querySelector('.section-head') || details;
    const r = head.getBoundingClientRect();
    const pad = 6;
    Object.assign(tour.spot.style, {
      top: `${r.top - pad}px`,
      left: `${r.left - pad}px`,
      width: `${r.width + pad * 2}px`,
      height: `${r.height + pad * 2}px`,
    });

    // Below the target when there is room, above it otherwise; the arrow flips
    // with it so it always points at the thing being described.
    const call = tour.call;
    const ch = call.offsetHeight;
    const below = r.bottom + 14 + ch < window.innerHeight || r.top - 14 - ch < 0;
    call.classList.toggle('gm-call-above', !below);
    call.style.top = below ? `${r.bottom + 14}px` : `${r.top - 14 - ch}px`;
    const left = Math.max(12, Math.min(r.left, window.innerWidth - call.offsetWidth - 12));
    call.style.left = `${left}px`;
  }

  function showStep(i) {
    if (!tour) return;
    tour.index = Math.max(0, Math.min(i, tour.steps.length - 1));
    const step = tour.steps[tour.index];
    tour.call.dataset.section = step.section;

    // A collapsed or scrolled-away section cannot be pointed at, so open it and
    // bring it into view before measuring.
    const details = stepTarget(step);
    if (details) {
      if (!details.open) {
        details.open = true;
        sectionChoice.set(step.section, true);
      }
      // Guarded: not every host implements scrollIntoView, and failing to scroll
      // is not a reason to abandon the step.
      if (details.scrollIntoView) details.scrollIntoView({ block: 'center', behavior: 'auto' });
    }

    tour.call.querySelector('.gm-call-step').textContent =
      `Step ${tour.index + 1} of ${tour.steps.length}`;
    const mark = tour.call.querySelector('.gm-call-mark');
    mark.textContent = step.done ? 'Already done' : 'To do';
    mark.className = `gm-call-mark ${step.done ? 'is-done' : 'is-todo'}`;
    tour.call.querySelector('.gm-call-title').textContent = step.title;
    tour.call.querySelector('.gm-call-body').textContent = step.body;
    // Built as elements with textContent rather than markup: these are the only
    // strings in the panel that describe themselves, and there is no reason for
    // them to travel as HTML.
    const list = tour.call.querySelector('.gm-call-list');
    list.replaceChildren(
      ...(step.lines || []).map((line) => {
        const li = document.createElement('li');
        li.textContent = line;
        return li;
      }),
    );
    list.hidden = !(step.lines || []).length;
    const note = tour.call.querySelector('.gm-call-note');
    note.textContent = step.note || '';
    note.hidden = !step.note;
    tour.call.querySelector('.gm-call-do').textContent = step.action;
    // The callout offers to do the step only while it is still outstanding, and
    // only when one action is unambiguously the right one.
    const doBtn = tour.call.querySelector('[data-tour="do"]');
    doBtn.hidden = !step.do;
    if (step.do) doBtn.querySelector('span').textContent = step.do.label;
    const settled = tour.call.querySelector('.gm-call-settled');
    settled.hidden = !!step.do;

    tour.call.querySelector('[data-tour="prev"]').disabled = tour.index === 0;
    const last = tour.index === tour.steps.length - 1;
    tour.call.querySelector('[data-tour="next"]').hidden = last;
    tour.call.querySelector('[data-tour="end"]').textContent = last ? 'Done' : 'Skip';

    positionTour();
    tour.call.focus();
  }

  function startTour(state) {
    endTour();
    const steps = tourSteps(state);
    if (!steps.length) return;

    const overlay = document.createElement('div');
    overlay.className = 'gm-tour';
    const spot = document.createElement('div');
    spot.className = 'gm-spot';
    const call = document.createElement('div');
    call.className = 'gm-call';
    call.setAttribute('role', 'dialog');
    call.setAttribute('aria-modal', 'true');
    call.setAttribute('aria-labelledby', 'gm-call-title');
    call.tabIndex = -1;
    call.innerHTML = `<div class="gm-call-arrow" aria-hidden="true"></div>
      <div class="gm-call-meta">
        <span class="gm-call-step"></span>
        <span class="gm-call-mark"></span>
      </div>
      <h2 class="gm-call-title" id="gm-call-title"></h2>
      <p class="gm-call-body"></p>
      <ul class="gm-call-list"></ul>
      <p class="gm-call-note"></p>
      <p class="gm-call-do"></p>
      <p class="gm-call-hint">Escape closes this box — the highlighted controls work either way.</p>
      <p class="gm-call-settled">Nothing to do here.</p>
      <button type="button" class="btn btn-primary gm-call-do-btn" data-tour="do"><span></span></button>
      <div class="gm-call-acts">
        <button type="button" class="btn" data-tour="prev">Back</button>
        <button type="button" class="btn" data-tour="next">Next</button>
        <button type="button" class="btn" data-tour="end">Skip</button>
      </div>`;
    overlay.append(spot, call);
    // The overlay sits outside #root, so the panel's delegated click handler
    // never sees it — it carries its own.
    overlay.addEventListener('click', (e) => {
      const el = e.target.closest('[data-tour]');
      if (!el) return;
      e.preventDefault();
      onTourClick(el);
    });
    document.body.appendChild(overlay);

    const onScroll = () => positionTour();
    const onKey = (e) => {
      if (!tour) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        endTour();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (tour.index < tour.steps.length - 1) showStep(tour.index + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        showStep(tour.index - 1);
      }
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    document.addEventListener('keydown', onKey, true);

    tour = {
      overlay,
      spot,
      call,
      steps,
      index: 0,
      onScroll,
      onKey,
      returnFocusTo: '[data-tour="start"]',
    };
    showStep(0);
  }

  /** Tour clicks are handled here, not posted to the host — nothing leaves the webview. */
  function onTourClick(el) {
    const what = el.dataset.tour;
    if (what === 'start') startTour(lastState);
    else if (what === 'next') showStep(tour ? tour.index + 1 : 0);
    else if (what === 'prev') showStep(tour ? tour.index - 1 : 0);
    else if (what === 'end') endTour();
    else if (what === 'do') runStepAction();
  }

  /**
   * Do the current step, by sending the message the section's own control sends.
   * Nothing is reimplemented here and nothing is decided here: the host runs the
   * same command, so a step that prompts still prompts and a step that shows
   * progress still shows it.
   */
  function runStepAction() {
    if (!tour) return;
    const step = tour.steps[tour.index];
    // Whether there is anything to do is the step's `do` — a settled step can
    // still carry an action worth taking, like a second default database.
    if (!step.do) return;
    const { label, ...msg } = step.do;
    void label;
    post(msg);
    // The host redraws the panel once the command lands. If that settles this
    // step, move to the next outstanding one rather than leaving the user
    // looking at a finished step — but only after an action they asked for, not
    // on every redraw.
    tour.advanceFrom = tour.index;
  }

  function renderVersions(versions, open) {
    const onDisk = versions.filter((v) => v.extracted || v.downloaded || v.local);
    const installed = versionsInstalledCount(versions);
    const actions =
      btn('installNewVersion', 'Install Version…', 'plus', 'btn-ghost', { iconOnly: true }) +
      btn('registerLocalVersion', 'Register Local…', 'folderOpen', 'btn-ghost', {
        iconOnly: true,
      }) +
      btn('openWalkthrough', 'Get Started with GemStone', 'notebook', 'btn-ghost', {
        iconOnly: true,
      });

    if (!onDisk.length) {
      return section(
        { key: 'versions', title: 'Versions', count: `${installed} installed`, actions, open },
        `<div class="empty">No GemStone releases on this machine yet — install one, or register a local build.</div>`,
      );
    }

    // A release is a record with the same fields every time — version, state,
    // size, date — so it reads as a table rather than a stack of cards.
    const rows = onDisk
      .map((v) => {
        const state = versionState(v);
        return `<tr>
          <td>
            <span class="v-name mono">${esc(v.version)}</span>
            ${v.bundled ? badge('bundled GCI') : ''}
          </td>
          <td>${pill(state)}</td>
          <td class="v-num">${v.size ? esc(formatBytes(v.size)) : '—'}</td>
          <td class="v-num">${v.date ? esc(v.date) : '—'}</td>
          ${versionActions(v)}
        </tr>`;
      })
      .join('');

    const body = `<table class="versions-table">
      <thead>
        <tr>
          <th>Version</th><th>Status</th><th class="v-num">Size</th><th class="v-num">Released</th><th></th><th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
    return section(
      { key: 'versions', title: 'Versions', count: `${installed} installed`, actions, open },
      body,
    );
  }

  // ── Databases section ───────────────────────────────────────────────────────
  // The combined running-status + whole-database power control. Colour carries
  // running-vs-stopped: red stops a running database, green starts a stopped one.
  function powerControl(db) {
    return db.stoneRunning
      ? `<button type="button" class="btn power power-stop" data-action="stopDatabase" data-dir="${esc(db.dirName)}" title="Stop ${esc(db.stoneName)}">${ICONS.stop}<span>Stop</span></button>`
      : `<button type="button" class="btn power power-start" data-action="startDatabase" data-dir="${esc(db.dirName)}" title="Start ${esc(db.stoneName)}">${ICONS.play}<span>Start</span></button>`;
  }

  /** What the row says about liveness: how long it has been up, when it is. */
  function dbState(db) {
    if (!db.stoneRunning) return '';
    const stone = (db.processes || []).find((p) => p.type === 'stone');
    const parts = [db.startedAtMs ? since(db.startedAtMs) : 'running'];
    if (stone) parts.push(`pid ${stone.pid}`);
    return `<span class="db-state">${parts.map((t) => esc(t)).join(' · ')}</span>`;
  }

  // Logins that target this database, plus a New Login affordance. Logins lead the
  // panel: connecting is what the user came for. The stone is already the row's
  // context, so each login shows only the user it connects as.
  function renderLogins(db) {
    const rows = db.logins.length
      ? db.logins
          .map(
            (l) =>
              `<div class="db-line db-login">
                <span class="db-line-name"><span class="db-login-user">${esc(l.user)}</span></span>
                <span class="db-line-actions">${btn('editLogin', 'Edit login', 'edit', null, { login: l.label, iconOnly: true })}${btn('connectLogin', 'Log in', null, 'btn-secondary', { login: l.label, title: `Log in to ${esc(db.stoneName)} as ${esc(l.user)}` })}</span>
              </div>`,
          )
          .join('')
      : `<div class="db-empty">No logins yet.</div>`;
    const add = `<button type="button" class="icon-btn" data-action="createLoginFromDb" data-dir="${esc(db.dirName)}" title="New login" aria-label="New login">${ICONS.plus}</button>`;
    return group({ title: 'Logins', actions: add, open: true }, rows);
  }

  // One row per process, carrying both its live state and its start/stop control.
  function processRow(db, type) {
    const isStone = type === 'stone';
    const label = isStone ? 'Stone' : 'NetLDI';
    const name = isStone ? db.stoneName : db.ldiName;
    const running = isStone ? db.stoneRunning : db.netldiRunning;
    const proc = db.processes.find((p) => p.type === type);
    const stale = !!proc && !proc.responding;

    let state;
    if (proc) {
      const meta = [`pid ${esc(proc.pid)}`];
      if (proc.port) meta.push(`port ${esc(proc.port)}`);
      if (stale) meta.push(`stale · ${esc(proc.status)}`);
      state = `<span class="db-line-meta mono">${meta.join(' · ')}</span>`;
    } else {
      state = `<span class="svc-state off">Stopped</span>`;
    }

    const extras =
      (stale
        ? btn('deleteStaleLock', 'Delete stale lock', 'trash', 'btn-ghost', {
            dir: db.dirName,
            name: proc.name,
            iconOnly: true,
            title: `Remove the stale lock file for ${esc(proc.name)}`,
          })
        : '') +
      (!isStone && windowsHost && proc
        ? btn('copyNetldiHost', 'Copy host', 'target', 'btn-ghost', {
            dir: db.dirName,
            name: proc.name,
            iconOnly: true,
            title: 'Copy the host clients should use to reach this NetLDI',
          })
        : '');

    const toggle = running
      ? btn(isStone ? 'stopStone' : 'stopNetldi', 'Stop', 'stop', 'btn-ghost', {
          dir: db.dirName,
          iconOnly: true,
          title: `Stop ${label}`,
        })
      : btn(isStone ? 'startStone' : 'startNetldi', 'Start', 'play', 'btn-ghost', {
          dir: db.dirName,
          iconOnly: true,
          title: `Start ${label}`,
        });

    return `<div class="db-line${stale ? ' row-warn' : ''}">
      <span class="db-line-name">
        ${mark(stale ? 'warning' : running ? 'circle-filled' : 'circle-outline', stale ? 'warn' : running ? 'ok' : 'off', label)}
        <span class="proc-name mono">${esc(name)}</span>
        ${badge(label)}
      </span>
      <span class="db-line-actions">${state}${extras}${toggle}</span>
    </div>`;
  }

  function renderProcesses(db) {
    return group(
      { title: 'Processes', open: true },
      `${processRow(db, 'stone')}${processRow(db, 'netldi')}`,
    );
  }

  // Each kind of file is a root in a tree — Logs, Config, Backups — rather than
  // three columns racing for width. A root discloses its files as indented rows;
  // each row opens the path it carries and gets VS Code's own hover and focus
  // ring from the stylesheet. Roots start collapsed, so Files stays compact.
  // `rowAction` is an optional per-file action — {action, label, iconKey} — that
  // rides beside the name instead of inside it, since a button cannot nest in a
  // button.
  function fileRoot(db, label, iconKey, folder, files, action, emptyText, rowAction) {
    const extra = (f) =>
      rowAction
        ? `<button type="button" class="icon-btn" data-action="${rowAction.action}" data-path="${esc(f.path)}" data-dir="${esc(db.dirName)}" title="${esc(rowAction.label)} ${esc(f.name)}" aria-label="${esc(rowAction.label)} ${esc(f.name)}">${icon(rowAction.iconKey)}</button>`
        : '';
    const rows = files.length
      ? files
          .map(
            (f) =>
              `<li class="file-line"><button type="button" class="file-row" data-action="${action}" data-path="${esc(f.path)}" data-dir="${esc(db.dirName)}" title="${esc(f.name)}">${esc(f.name)}</button>${extra(f)}</li>`,
          )
          .join('')
      : `<li class="file-empty">${esc(emptyText)}</li>`;
    const reveal = `<button type="button" class="icon-btn" data-action="openDbSubfolder" data-dir="${esc(db.dirName)}" data-folder="${esc(folder)}" aria-label="Reveal ${esc(label)} folder" title="Reveal the ${esc(label)} folder">${ICONS.folderOpen}</button>`;
    return `<details class="file-root">
      <summary class="file-root-head">
        <i class="codicon codicon-chevron-right section-twist" aria-hidden="true"></i>
        <span class="file-root-icon">${ICONS[iconKey]}</span>
        <span class="file-root-name">${esc(label)}</span>
        <span class="file-root-count">${files.length}</span>
        <span class="file-root-actions">${reveal}</span>
      </summary>
      <ul class="file-list">${rows}</ul>
    </details>`;
  }

  function renderFiles(db, open) {
    const reveal = `<button type="button" class="icon-btn" data-action="openDbInFinder" data-dir="${esc(db.dirName)}" title="Open ${esc(db.path)}" aria-label="Open database folder">${ICONS.folderOpen}</button>`;
    const body = `<div class="file-tree">
      ${fileRoot(db, 'Logs', 'output', 'log', db.logFiles || [], 'openDbFile', 'No logs yet.')}
      ${fileRoot(db, 'Config', 'gear', 'conf', db.confFiles || [], 'openDbFile', 'No config files.')}
      ${fileRoot(db, 'Backups', 'archive', 'backups', db.backupFiles || [], 'revealDbFile', 'No backups yet.', { action: 'restoreBackup', label: 'Restore from', iconKey: 'discard' })}
    </div>`;
    return group(
      { title: 'Files', desc: db.path, group: 'files', db: db.dirName, actions: reveal, open },
      body,
    );
  }

  // The everyday tools sit on the row, reachable without expanding it; only the
  // irreversible action waits inside.
  function dbRowTools(db) {
    // Backing up copies live extents, so it is only offered while the stone is
    // up — the same condition the sidebar put it behind.
    const backup = db.stoneRunning
      ? btn('backupDatabase', 'Back up', 'archive', 'btn-ghost', {
          dir: db.dirName,
          iconOnly: true,
          title: 'Online extent backup',
        })
      : '';
    return (
      backup +
      btn('installServerSupport', 'Install Server Support', 'install', 'btn-ghost', {
        dir: db.dirName,
        iconOnly: true,
        title: 'Install the Enhanced Inspector and refactoring support into this stone',
      }) +
      btn('openDbTerminal', 'Terminal', 'terminal', 'btn-ghost', {
        dir: db.dirName,
        iconOnly: true,
        title: 'Open a terminal for this database',
      }) +
      btn('openDbInFinder', 'Reveal', 'reveal', 'btn-ghost', {
        dir: db.dirName,
        iconOnly: true,
        title: 'Reveal the database folder',
      })
    );
  }

  // A real select. Changing it opens the guarded replace flow rather than swapping
  // silently: replacing an extent destroys the database and its transaction logs.
  function extentChooser(db) {
    const extents = db.availableExtents || [];
    const current = String(db.baseExtent || '').replace(/\.dbf$/, '');
    const options = (extents.includes(current) ? extents : [current, ...extents])
      .map((e) => `<option value="${esc(e)}"${e === current ? ' selected' : ''}>${esc(e)}</option>`)
      .join('');
    const locked = !!db.stoneRunning;
    const title = locked
      ? 'Stop the stone to replace its base extent'
      : 'Base extent — choosing another replaces the database';
    return `<label class="extent" title="${esc(title)}">
      <span class="extent-label">Extent</span>
      <select class="extent-select" data-select="replaceExtent" data-dir="${esc(db.dirName)}"${locked ? ' disabled' : ''}>${options}</select>
    </label>`;
  }

  function renderDbItem(db, isCurrent) {
    // The database is a native disclosure. The always-visible facts — version,
    // liveness and the power control — ride in the summary, so they read whether
    // the row is open or closed; the tools and detail live in the body.
    return `<details class="db-item${isCurrent ? ' db-item-current' : ''}" data-db="${esc(db.dirName)}">
      <summary class="db-head">
        <i class="codicon codicon-chevron-right section-twist" aria-hidden="true"></i>
        <span class="db-name">${esc(db.stoneName)}</span>
        <span class="db-dir mono dim">${esc(db.dirName)}</span>
        <span class="db-version mono">${esc(db.version)}</span>
        ${dbState(db)}
        ${powerControl(db)}
      </summary>
      <div class="db-body">
        <div class="db-toolbar">
          ${extentChooser(db)}
          <span class="db-toolbar-tools">${dbRowTools(db)}</span>
        </div>
        <div class="db-cols">
          ${renderLogins(db)}
          ${renderProcesses(db)}
        </div>
        ${renderFiles(db, expandedFiles.has(db.dirName))}
        <div class="db-footer">
          ${btn('deleteDatabase', 'Delete Database', 'trash', 'btn-ghost', { dir: db.dirName })}
        </div>
      </div>
    </details>`;
  }

  function renderDatabases(databases, open, currentDir) {
    // The database the current session works in leads the column; the others
    // follow as a list, so the pair of top columns read the same way.
    const lead = currentDir ? databases.find((d) => d.dirName === currentDir) : undefined;
    const rest = databases.filter((d) => d !== lead);
    const body = databases.length
      ? (lead ? `<div class="col-lead">${renderDbItem(lead, true)}</div>` : '') +
        (rest.length
          ? `<div class="col-rest">${rest.map((d) => renderDbItem(d, false)).join('')}</div>`
          : '')
      : `<div class="empty">No databases yet.<div>${btn('createDatabase', 'New Database…', 'plus', 'btn-ghost')}</div></div>`;
    return section(
      {
        key: 'databases',
        title: 'Databases',
        desc: lead ? `${lead.stoneName} · ${lead.dirName}` : undefined,
        count: databases.length,
        actions: btn('createDatabase', 'New Database…', 'plus', 'btn-ghost', { iconOnly: true }),
        open,
      },
      body,
    );
  }

  // Connect leads (it is what the screen is opened to do), then Databases, then
  // the reference sections. Everything stacks full-width: a single readable column
  // beats two dense panels racing each other for room.
  function orderedSections(state) {
    const osWarn = osHasWarning(state.os);
    const nothingInstalled = versionsInstalledCount(state.versions) === 0;
    const currentDir = (state.logins || []).find((l) => l.current)?.dirName;

    const out = [];
    // A machine that cannot run a stone gets told that before anything else.
    if (osWarn) out.push({ html: renderOs(state.os, true, state.rootPath) });
    // With no release installed there is nothing to connect to yet.
    if (nothingInstalled) out.push({ html: renderVersions(state.versions, true) });

    out.push({ html: renderConnect(state, true) });
    out.push({ html: renderDatabases(state.databases, true, currentDir) });

    if (!nothingInstalled) out.push({ html: renderVersions(state.versions, true) });
    if (!osWarn) out.push({ html: renderOs(state.os, false, state.rootPath) });
    return out;
  }

  function render(state) {
    windowsHost = !!state.windows;
    lastState = state;
    els.root.innerHTML =
      renderHeader(state) +
      orderedSections(state)
        .map((s) => s.html)
        .join('');
    // Which sections start open follows what needs attention, which is right on
    // arrival and wrong afterwards: the panel redraws itself whenever anything
    // changes, and a reader who opened Operating System to work through it would
    // watch it snap shut under them. Once they have said, their answer stands.
    els.root.querySelectorAll('details.section[data-section]').forEach((d) => {
      const chosen = sectionChoice.get(d.dataset.section);
      if (chosen !== undefined) d.open = chosen;
      d.addEventListener('toggle', () => sectionChoice.set(d.dataset.section, d.open));
    });
    // Restore each database's expanded state across re-renders, and keep the sets
    // in sync as the user opens and closes them. Scoped to .db-item so it does not
    // also match the Files group, which carries data-db for its own key.
    els.root.querySelectorAll('details.db-item[data-db]').forEach((d) => {
      if (expandedDbs.has(d.dataset.db)) d.open = true;
      d.addEventListener('toggle', () => {
        if (d.open) expandedDbs.add(d.dataset.db);
        else expandedDbs.delete(d.dataset.db);
      });
    });
    els.root.querySelectorAll('details[data-group="files"]').forEach((d) => {
      d.addEventListener('toggle', () => {
        if (d.open) expandedFiles.add(d.dataset.db);
        else expandedFiles.delete(d.dataset.db);
      });
    });
    // The section the tour points at was just replaced, so re-anchor onto the new
    // element rather than leaving the spotlight over stale coordinates. If the
    // overlay is gone from the document, the tour went with it.
    if (tour && !tour.overlay.isConnected) {
      endTour();
    } else if (tour) {
      tour.steps = tourSteps(state);
      const acted = tour.advanceFrom;
      tour.advanceFrom = undefined;
      const settled = acted !== undefined && tour.steps[acted] && tour.steps[acted].done;
      showStep(settled ? acted + 1 : tour.index);
    }
  }

  function post(msg) {
    vscode.postMessage(msg);
  }

  function onClick(e) {
    const tourEl = e.target.closest('[data-tour]');
    if (tourEl) {
      e.preventDefault();
      onTourClick(tourEl);
      return;
    }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    // Prevent an action button inside a <summary> from also toggling the section.
    e.preventDefault();
    post({
      command: el.dataset.action,
      version: el.dataset.version,
      dirName: el.dataset.dir,
      folder: el.dataset.folder,
      login: el.dataset.login,
      name: el.dataset.name,
      path: el.dataset.path,
      sessionId: el.dataset.session ? Number(el.dataset.session) : undefined,
      action: el.dataset.cmd,
    });
  }

  // Changing the extent select is destructive, so it opens the guarded replace
  // flow through the host rather than swapping the file silently.
  function onChange(e) {
    const el = e.target.closest('[data-select]');
    if (!el) return;
    post({ command: el.dataset.select, dirName: el.dataset.dir });
  }

  function init(refs, api) {
    els = refs;
    vscode = api;
    els.root.addEventListener('click', onClick);
    els.root.addEventListener('change', onChange);
    els.root.innerHTML = '<div class="skeleton">Loading GemStone environment…</div>';
    // Messages arrive from the extension host, which VS Code relays in from the
    // frame around this one — so `ev.source` is never this window, and testing
    // for that drops every message the panel exists to receive. What guards this
    // listener is the webview boundary itself: nothing else can reach it.
    window.addEventListener('message', (ev) => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.command === 'loading') {
        els.root.setAttribute('aria-busy', 'true');
      } else if (msg.command === 'state') {
        if (!msg.state || typeof msg.state !== 'object') return;
        els.root.setAttribute('aria-busy', 'false');
        render(msg.state);
      }
    });
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.GemstoneManager = {
    init,
    render,
    renderOs,
    renderVersions,
    renderDatabases,
    orderedSections,
    tourSteps,
    renderHeader,
    osHasWarning,
    versionState,
    formatBytes,
  };
})();
