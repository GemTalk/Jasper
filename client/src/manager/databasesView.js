// Webview-side script for the Databases & Versions panel (databasesPanel.ts).
// Plain JS that runs in the webview DOM (not bundled). Renders the state posted
// by the host and dispatches every action back to the host as a postMessage.
// Exposes a single global `GemstoneDatabases` so it can be unit-tested in jsdom.
//
// Convention (see debuggerView.js): host injects this, then calls
// GemstoneDatabases.init(refs, vscode) from a nonce'd bootstrap <script>. The whole
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
  // The last state drawn, so a click that only changes what is on screen can
  // redraw without the host having to post the state again.
  let lastState = {};

  // Whether the New Database form is showing instead of the lists, and the
  // answers held in it. They live here rather than in the host so a refresh
  // arriving mid-typing cannot discard them — the whole point of a form over the
  // old chain of popups.
  let creating = false;
  // Whether the form is the only reason this panel is on screen — set when the
  // host opens it straight into the form, cleared once the user has seen the
  // lists behind it.
  let openedForCreate = false;
  // Ping answers per session id, so a result appears beside the row that asked
  // rather than floating loose. A success clears itself; a warning stays until
  // dismissed, because the stone's words are worth reading and copying.
  const pingNotices = new Map();
  const pingTimers = new Map();
  const OK_NOTICE_MS = 5000;
  const createForm = {
    seeded: false,
    version: '',
    extent: '',
    stoneName: '',
    ldiName: '',
    allowNfs: false,
  };

  // Internal key -> the real codicon name. This is the single place a key is
  // translated; nothing else invents a glyph.
  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

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
    edit: 'edit',
    pass: 'pass',
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
  // weight, and only `'btn-primary'` changes it — that one call to action gets the
  // filled treatment; every other value (there is only `'btn-secondary'`) renders
  // as the default quiet button, which is the base `.btn` style itself. There is
  // deliberately no separate "ghost" variant, so don't invent a class name for one.
  function btn(action, label, iconKey, cls, attrs) {
    const a = attrs || {};
    const data =
      (a.version ? ` data-version="${esc(a.version)}"` : '') +
      (a.dir ? ` data-dir="${esc(a.dir)}"` : '') +
      (a.folder ? ` data-folder="${esc(a.folder)}"` : '') +
      (a.login ? ` data-login="${esc(a.login)}"` : '') +
      (a.name ? ` data-name="${esc(a.name)}"` : '') +
      (a.session !== undefined ? ` data-session="${esc(String(a.session))}"` : '') +
      (a.cmd ? ` data-cmd="${esc(a.cmd)}"` : '');
    const title = ` title="${esc(a.title || label)}"`;
    const off = a.disabled ? ' disabled' : '';

    if (a.iconOnly) {
      return `<button type="button" class="icon-btn" data-action="${action}"${data}${title}${off} aria-label="${esc(label)}">${icon(iconKey)}</button>`;
    }
    const variant = cls === 'btn-primary' ? ' btn-primary' : '';
    const glyph = iconKey ? `${icon(iconKey)}` : '';
    return `<button type="button" class="btn${variant}" data-action="${action}"${data}${title}${off}>${glyph}<span>${esc(label)}</span></button>`;
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
    // The count belongs to the title, the way a view's badge does in VS Code, and
    // the buttons are a toolbar hard against the right edge. They used to be one
    // group pushed right together, which dragged the count away from the words it
    // counts and left the buttons floating mid-header once they carried labels.
    const right = opts.actions ? `<span class="section-head-actions">${opts.actions}</span>` : '';
    // Two groups, not five loose children: the name of the thing on the left and
    // the toolbar on the right. Leaving them loose left the alignment to an auto
    // margin on one child, which put the buttons mid-header in a narrow panel;
    // pushing two groups apart holds at any width, and lets the toolbar drop to
    // its own line — still right — when the panel is too narrow for one.
    return `<details class="section" data-section="${esc(opts.key || opts.title)}"${opts.open ? ' open' : ''}>
      <summary class="section-head">
        <span class="section-head-main">
          <i class="codicon codicon-chevron-right section-twist" aria-hidden="true"></i>
          <span class="section-title">${esc(opts.title)}</span>
          ${count}
          ${desc}
        </span>
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

  // ── Versions section ────────────────────────────────────────────────────────
  function versionState(v) {
    if (v.local) return 'local';
    if (v.extracted) return 'installed';
    if (v.downloaded) return 'downloaded';
    return 'available';
  }

  // Two action cells, the same in every row: quiet icons, then the one primary
  // action. Getting a release and removing one are mutually exclusive, so they
  // share the primary cell.
  //
  // Removing says "Remove" whichever kind of row it is — an archive, an
  // installed product tree, or a link to a build you compiled. Which of those is
  // about to happen is the tooltip's job; making the reader learn three words for
  // one idea was not buying anything.
  function versionActions(v) {
    const state = versionState(v);
    const cell = (html) => `<td class="v-cell">${html || ''}</td>`;
    const openFolder = btn('openVersionFolder', 'Show in Finder', 'folder', 'btn-secondary', {
      version: v.version,
      iconOnly: true,
      title: 'Open the product folder',
    });
    const openTerminal = btn('openVersionTerminal', 'Open Terminal', 'terminal', 'btn-secondary', {
      version: v.version,
      iconOnly: true,
      title: 'Open a terminal for this version',
    });
    // The Windows client is a separate download from the server product, and only
    // means anything on Windows.
    const client = !windowsHost
      ? ''
      : v.clientExtracted
        ? btn('openWindowsClientFolder', 'Open Client Folder', 'folder', 'btn-secondary', {
            version: v.version,
            iconOnly: true,
            title: 'Open the Windows client folder',
          }) +
          btn('deleteWindowsClient', 'Delete Client', 'trash', 'btn-secondary', {
            version: v.version,
            iconOnly: true,
            title: 'Remove the extracted Windows client',
          })
        : btn('installWindowsClient', 'Install Client', 'install', 'btn-secondary', {
            version: v.version,
            iconOnly: true,
            title: 'Download and extract the Windows client',
          });

    if (state === 'downloaded') {
      return (
        cell(
          btn('deleteDownload', 'Remove', 'trash', 'btn-secondary', {
            version: v.version,
            iconOnly: true,
            title: 'Delete the downloaded archive — nothing is installed from it yet',
          }),
        ) +
        cell(
          btn('extractVersion', 'Install', 'install', 'btn-primary', {
            version: v.version,
            title: 'Finish installing this release from the archive already downloaded',
          }),
        )
      );
    }
    if (state === 'local') {
      return (
        cell(openFolder + openTerminal + client) +
        cell(
          btn('unregisterLocalVersion', 'Remove', 'trash', 'btn-secondary', {
            version: v.version,
            title: 'Stop using this local build — the folder you built is left alone',
          }),
        )
      );
    }
    return (
      cell(openFolder + openTerminal + client) +
      cell(
        btn('uninstallVersion', 'Remove', 'trash', 'btn-secondary', {
          version: v.version,
          title: 'Delete the installed product tree from this machine',
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

  function renderVersions(versions, open) {
    const onDisk = versions.filter(
      (v) => v.extracted || v.downloaded || v.local || v.clientExtracted,
    );
    const installed = versionsInstalledCount(versions);
    // The two ways to get a release carry their words. They were icon-only, which
    // read as decoration: three unlabelled glyphs in a header is not an answer to
    // "how do I get a new version?". The walkthrough stays a glyph — it is a
    // pointer to reading, not a thing you do to this machine — and it is the only
    // home that button has now that the Versions tree is gone.
    const getActions =
      btn('installNewVersion', 'Install Version…', 'plus', 'btn-secondary', {
        title: 'Choose a release from the download site, then download and unpack it',
      }) +
      btn('registerLocalVersion', 'Register Local…', 'folderOpen', 'btn-secondary', {
        title: 'Point Jasper at a GemStone tree you built yourself',
      });
    const actions = getActions;

    if (!onDisk.length) {
      // Nothing installed is the one state where this section is the whole job,
      // so the buttons are repeated in the body rather than left in the header
      // where a reader looking at the sentence has to go hunting for them.
      return section(
        { key: 'versions', title: 'Versions', count: `${installed} installed`, actions, open },
        `<div class="empty">
          <div>No GemStone release on this machine yet. Install one from the download site,
          or point Jasper at a build you compiled.</div>
          <div class="empty-acts">${getActions}</div>
        </div>`,
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
  // A login row says which of the two states it is in, because they call for
  // opposite actions: a login you can open, or a session you can work in and
  // eventually close. Showing "Log in" for a login that is already connected was
  // the panel disagreeing with the Logins & Sessions tree about the same fact.
  // A login, and under it the sessions open for it — the same shape as the
  // Logins & Sessions tree, because they describe the same thing and a reader
  // moving between them should not have to translate.
  //
  // The session the rest of Jasper works in is the one Display It and friends
  // run in, so it is called out three ways: a green arrow, bold, and a tooltip
  // that says what "current" buys you. Colour alone would say it to some readers
  // and not others.
  // Everything the Logins & Sessions tree offers on a session row. Kept the same
  // set on purpose: a session is a session, and someone who found Commit in one
  // place should not have to wonder whether the other place can do it.
  //
  // `sessionAction` carries the command name rather than each getting its own
  // message — the host allow-lists what it will run.
  // The body of a ping result: an icon, the message, and — when it did not go
  // well — Copy (keeps the stone's exact words) and Dismiss. Matches the Session
  // Configuration panel's notices, which is where this used to live.
  function pingResultHtml(sessionId) {
    const notice = pingNotices.get(sessionId);
    if (!notice) return '';
    const ok = notice.tone === 'ok';
    const glyph = `<span class="ico">${icon(ok ? 'pass' : 'warn')}</span>`;
    const actions = ok
      ? ''
      : `<span class="notice-actions">
           <button type="button" class="notice-btn" data-action="copyNotice" data-copy="${esc(notice.message)}">Copy</button>
           <button type="button" class="notice-btn" data-action="dismissPing" data-session="${esc(String(sessionId))}">Dismiss</button>
         </span>`;
    return `<span class="ping-result ${ok ? 'ok' : 'warn'}" role="status">${glyph}<span class="notice-msg">${esc(notice.message)}</span>${actions}</span>`;
  }

  function sessionActions(session) {
    const act = (cmd, label, iconKey, title) =>
      btn('sessionAction', label, iconKey, null, {
        session: session.id,
        cmd,
        iconOnly: true,
        title,
      });
    // Making the current session active again does nothing, so it is not offered.
    const makeActive = session.current
      ? ''
      : act(
          'gemstone.selectSession',
          'Make Active',
          'target',
          'Make this session the active one — Display It, Inspect It and the Explorer all follow the active session',
        );
    return (
      pingResultHtml(session.id) +
      makeActive +
      btn('pingSession', 'Ping', 'pulse', null, {
        session: session.id,
        iconOnly: true,
        title: 'Check that this session is alive and responsive',
      }) +
      act('gemstone.sessionCommit', 'Commit', 'check', 'Commit this session') +
      act('gemstone.sessionAbort', 'Abort', 'discard', 'Abort this session') +
      btn('showSessionConfiguration', 'Session Configuration', 'gear', null, {
        session: session.id,
        iconOnly: true,
        title: 'Stone and gem settings for this session',
      }) +
      act(
        'gemstone.fullLogicalBackup',
        'Full Logical Backup',
        'archive',
        'Full logical backup through this session',
      ) +
      act(
        'gemstone.fullLogicalRestore',
        'Full Logical Restore',
        'restore',
        'Full logical restore through this session',
      ) +
      btn('logoutSession', 'Log out', null, 'btn-secondary', {
        session: session.id,
        title: `Log out session ${esc(String(session.id))}`,
      })
    );
  }

  // The session the rest of Jasper works in is where Display It and friends run,
  // so it is called out three ways: a green arrow, bold, and a tooltip saying
  // what "current" buys you. Colour alone would say it to some readers and not
  // others.
  function sessionRow(db, login, session) {
    const mark = session.current
      ? `<span class="session-mark session-current-mark">${ICONS.play}</span>`
      : `<span class="session-mark"></span>`;
    const tip = session.current
      ? 'The session Display It, Inspect It and the Explorer are working in'
      : `An open session on ${db.stoneName}`;
    return `<div class="db-line db-session${session.current ? ' db-session-current' : ''}" title="${esc(tip)}">
        <span class="db-line-name">${mark}<span class="session-name">${esc(login.user)}</span><span class="dim session-id">session ${esc(String(session.id))}</span></span>
        <span class="db-line-actions">${sessionActions(session)}</span>
      </div>`;
  }

  function renderLogins(db) {
    const rows = db.logins.length
      ? db.logins
          .map((l) => {
            const open = l.sessions || [];
            const head = `<div class="db-line db-login">
                <span class="db-line-name"><span class="session-mark"></span><span class="db-login-user">${esc(l.user)}</span></span>
                <span class="db-line-actions">${btn('editLogin', 'Edit login', 'edit', null, {
                  login: l.label,
                  iconOnly: true,
                })}${btn('connectLogin', 'Log in', null, 'btn-secondary', {
                  login: l.label,
                  title: `Log in to ${esc(db.stoneName)} as ${esc(l.user)}`,
                })}</span>
              </div>`;
            // Sessions belong to the login they were opened from, so they are
            // indented under it and captioned — a flat list of near-identical
            // names reads as duplicates rather than as a login and its sessions.
            if (!open.length) return head;
            return (
              head +
              `<div class="session-block">
                <div class="session-caption">${open.length === 1 ? 'Session' : 'Sessions'}</div>
                ${open.map((sess) => sessionRow(db, l, sess)).join('')}
              </div>`
            );
          })
          .join('')
      : `<div class="db-empty">No logins yet.</div>`;
    const add = `<button type="button" class="icon-btn" data-action="createLoginFromDb" data-dir="${esc(db.dirName)}" title="New login" aria-label="New login">${ICONS.plus}</button>`;
    return group({ title: 'Logins', actions: add, open: true }, rows);
  }

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

    // Mirrors what the sidebar's stone and NetLDI rows offer, so the two do not
    // disagree about what can be done to a server.
    const external = (db.external || []).some((e) => e.type === type);
    const extras =
      // Backing up live extents suspends checkpoints over a session, so it is
      // offered on a running stone — the same condition the sidebar puts it
      // behind. The offline copy on the database row is the stopped-stone case.
      (isStone && running && !external
        ? btn('backupDatabase', 'Online Extent Backup', 'archive', 'btn-secondary', {
            dir: db.dirName,
            iconOnly: true,
            title: 'Back up this running stone\u2019s extents through a session',
          })
        : '') +
      // Started outside Jasper's environment: Jasper can see it but cannot stop
      // it, so the one action that helps is restarting it under Jasper.
      (external
        ? btn(
            'restartExternalServers',
            "Restart Under Jasper's Environment",
            'refresh',
            'btn-secondary',
            {
              dir: db.dirName,
              iconOnly: true,
              title: `${label} was started outside Jasper — restart it under Jasper so it can be managed here`,
            },
          )
        : '') +
      (stale
        ? btn('deleteStaleLock', 'Delete stale lock', 'trash', 'btn-secondary', {
            dir: db.dirName,
            name: proc.name,
            iconOnly: true,
            title: `Remove the stale lock file for ${esc(proc.name)}`,
          })
        : '') +
      (!isStone && windowsHost && proc
        ? btn('copyNetldiHost', 'Copy host', 'target', 'btn-secondary', {
            dir: db.dirName,
            name: proc.name,
            iconOnly: true,
            title: 'Copy the host clients should use to reach this NetLDI',
          })
        : '');

    const toggle = external
      ? ''
      : running
        ? btn(isStone ? 'stopStone' : 'stopNetldi', 'Stop', 'stop', 'btn-secondary', {
            dir: db.dirName,
            iconOnly: true,
            title: `Stop ${label}`,
          })
        : btn(isStone ? 'startStone' : 'startNetldi', 'Start', 'play', 'btn-secondary', {
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
  /** "18 Mar 14:32", or this-is-last-year's "18 Mar 2025". Empty when unknown. */
  function whenWritten(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const day = `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]}`;
    const thisYear = d.getFullYear() === new Date().getFullYear();
    return thisYear
      ? `${day} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      : `${day} ${d.getFullYear()}`;
  }

  function fileRoot(db, label, iconKey, folder, files, action, emptyText, rowAction) {
    const extra = (f) =>
      rowAction
        ? `<button type="button" class="icon-btn" data-action="${rowAction.action}" data-path="${esc(f.path)}" data-dir="${esc(db.dirName)}" title="${esc(rowAction.label)} ${esc(f.name)}" aria-label="${esc(rowAction.label)} ${esc(f.name)}">${icon(rowAction.iconKey)}</button>`
        : '';
    const rows = files.length
      ? files
          .map(
            (f) =>
              `<li class="file-line"><button type="button" class="file-row" data-action="${action}" data-path="${esc(f.path)}" data-dir="${esc(db.dirName)}" title="${esc(f.name)}"><span class="file-name">${esc(f.name)}</span><span class="file-when">${esc(whenWritten(f.modifiedMs))}</span></button>${extra(f)}</li>`,
          )
          .join('')
      : `<li class="file-empty">${esc(emptyText)}</li>`;
    const reveal = `<button type="button" class="icon-btn" data-action="openDbSubfolder" data-dir="${esc(db.dirName)}" data-folder="${esc(folder)}" aria-label="Show ${esc(label)} folder in Finder" title="Open the ${esc(label)} folder">${ICONS.folder}</button>`;
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
    const reveal = `<button type="button" class="icon-btn" data-action="openDbInFinder" data-dir="${esc(db.dirName)}" title="Open ${esc(db.path)}" aria-label="Open database folder">${ICONS.folder}</button>`;
    const body = `<div class="file-tree">
      ${fileRoot(db, 'Logs', 'output', 'log', db.logFiles || [], 'openDbFile', 'No logs yet.')}
      ${fileRoot(db, 'Config', 'gear', 'conf', db.confFiles || [], 'openDbFile', 'No config files.')}
      ${fileRoot(db, 'Backups', 'archive', 'backups', db.backupFiles || [], 'revealDbFile', 'No backups yet.', { action: 'restoreBackup', label: 'Restore from', iconKey: 'discard' })}
      ${fileRoot(db, 'Extent backups', 'archive', 'backups/extents', db.extentBackupFiles || [], 'revealDbFile', 'No extent backups yet.')}
    </div>`;
    return group(
      { title: 'Files', desc: db.path, group: 'files', db: db.dirName, actions: reveal, open },
      body,
    );
  }

  // The everyday tools sit on the row, reachable without expanding it; only the
  // irreversible action waits inside.
  // What can be done to a database without logging in to it. Backing up and
  // installing server support both resolve a live session before they can do
  // anything, so they are not offered from a row that describes a database on
  // disk — a button that can only say "log in first" is not worth the space.
  // What can be done to a database without logging in to it. Backing up and
  // installing server support both resolve a live session before they can do
  // anything, so they are not offered from a row that describes a database on
  // disk — a button that can only say "log in first" is not worth the space.
  //
  // Same icons, same order as a version row's pair: they mean the same things.
  function dbRowTools(db) {
    // Only while the stone is down: copying a live extent without suspending
    // checkpoints produces a file that looks like a backup and is not one. The
    // command refuses anyway; not offering it is the honest version.
    const backup = db.stoneRunning
      ? ''
      : btn('offlineExtentBackup', 'Back Up Extents', 'archive', 'btn-secondary', {
          dir: db.dirName,
          iconOnly: true,
          title: 'Copy this database\u2019s extents into its backups folder',
        });
    return (
      backup +
      btn('openDbInFinder', 'Show in Finder', 'folder', 'btn-secondary', {
        dir: db.dirName,
        iconOnly: true,
        title: 'Open the database folder',
      }) +
      btn('openDbTerminal', 'Open Terminal', 'terminal', 'btn-secondary', {
        dir: db.dirName,
        iconOnly: true,
        title: 'Open a terminal for this database',
      })
    );
  }

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
        <span class="db-version mono">${esc(db.version)}</span>
        <span class="db-dir mono dim">${esc(db.dirName)}</span>
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
          ${btn('deleteDatabase', 'Delete Database', 'trash', 'btn-secondary', { dir: db.dirName })}
        </div>
      </div>
    </details>`;
  }

  // `canCreate` is false when no release is installed: a form whose only choice
  // is empty cannot be completed, so the way out is Install, which the Versions
  // section leads with in exactly that case.
  function renderDatabases(databases, open, currentDir, canCreate) {
    // The database the current session works in leads the column; the others
    // follow as a list, so the pair of top columns read the same way.
    const lead = currentDir ? databases.find((d) => d.dirName === currentDir) : undefined;
    const rest = databases.filter((d) => d !== lead);
    const body = databases.length
      ? (lead ? `<div class="col-lead">${renderDbItem(lead, true)}</div>` : '') +
        (rest.length
          ? `<div class="col-rest">${rest.map((d) => renderDbItem(d, false)).join('')}</div>`
          : '')
      : canCreate
        ? `<div class="empty">No databases yet.<div>${btn('beginCreate', 'New Database…', 'plus', 'btn-primary')}</div></div>`
        : `<div class="empty">No databases yet — install a GemStone release first.</div>`;
    return section(
      {
        key: 'databases',
        title: 'Databases',
        desc: lead ? `${lead.stoneName} · ${lead.dirName}` : undefined,
        count: databases.length,
        actions: canCreate
          ? btn('beginCreate', 'New Database…', 'plus', 'btn-secondary', { iconOnly: true })
          : '',
        open,
      },
      body,
    );
  }

  // The panel header: what this machine has, and the two things you can do to it
  // from anywhere in the panel.
  function renderHeader(state) {
    const dbs = (state.databases || []).length;
    const installed = versionsInstalledCount(state.versions || []);
    const lead = !installed
      ? 'No GemStone release on this machine yet — install one to make a database.'
      : dbs
        ? `${dbs} database${dbs === 1 ? '' : 's'} · ${installed} version${installed === 1 ? '' : 's'} installed`
        : 'No databases yet — make one from a release you have installed.';
    // Creating needs something to create from, so the button waits for a release.
    const create = installed ? btn('beginCreate', 'New Database\u2026', 'plus', 'btn-primary') : '';
    return `<div class="gm-head">
      <div class="gm-head-text"><span class="gm-head-lead">${esc(lead)}</span></div>
      <div class="gm-head-acts">
        ${create}
        ${btn('refresh', 'Refresh', 'refresh', null, { iconOnly: true, title: 'Read this machine again, and ask the download catalogue for new releases' })}
      </div>
    </div>`;
  }

  function orderedSections(state) {
    const nothingInstalled = versionsInstalledCount(state.versions) === 0;
    const currentDir = (state.logins || []).find((l) => l.current)?.dirName;

    const out = [];
    // With nothing installed there is no database to make yet, so the way to get
    // a release leads. Once something is installed the databases lead instead and
    // versions sit below, where you go back for a new release.
    if (nothingInstalled) out.push({ html: renderVersions(state.versions, true) });
    out.push({ html: renderDatabases(state.databases, true, currentDir, !nothingInstalled) });
    if (!nothingInstalled) out.push({ html: renderVersions(state.versions, true) });
    return out;
  }

  // ── Creating a database ─────────────────────────────────────────────────────
  // The four questions the old command asked one popup at a time, asked all at
  // once instead. A form can be left and come back to; a chain of popups cannot,
  // which is what made looking up a free NetLDI name lose everything (#257).

  function createVersion(c) {
    const versions = c.versions || [];
    return versions.find((v) => v.version === createForm.version) || versions[0];
  }

  /** Why this name cannot be used, or '' when it can. */
  function nameProblem(name, taken, what) {
    if (!name) return `Enter a ${what} name.`;
    if (!/^\w+$/.test(name)) return 'Letters, digits and underscore only.';
    if ((taken || []).includes(name)) return `A ${what} called "${name}" already exists.`;
    return '';
  }

  function createProblems(c) {
    const v = createVersion(c);
    return {
      extent: v && (v.extents || []).length ? '' : 'This release has no base extent to copy.',
      stoneName: nameProblem(createForm.stoneName, c.stoneNames, 'stone'),
      ldiName: nameProblem(createForm.ldiName, c.ldiNames, 'NetLDI'),
    };
  }

  // One labelled control with a line under it that is either the hint or, when
  // the answer cannot be used, the reason. Both are always in the DOM so typing
  // can swap which one shows without rebuilding the field.
  function field(key, label, help, controlHtml, problem) {
    return `<div class="cf-field${problem ? ' cf-bad' : ''}" data-cf-field="${esc(key)}">
      <label class="cf-label" for="cf-${esc(key)}">${esc(label)}</label>
      ${controlHtml}
      <div class="cf-help">
        <span class="cf-hint"${problem ? ' hidden' : ''}>${esc(help)}</span>
        <span class="cf-problem"${problem ? '' : ' hidden'}>${esc(problem)}</span>
      </div>
    </div>`;
  }

  function renderCreate(state) {
    const c = state.create || {};
    const chosen = createVersion(c);
    const problems = createProblems(c);
    const blocked = Object.values(problems).some(Boolean);

    const versionOpts = (c.versions || [])
      .map(
        (v) =>
          `<option value="${esc(v.version)}"${chosen && v.version === chosen.version ? ' selected' : ''}>${esc(v.version)}</option>`,
      )
      .join('');
    const extents = chosen ? chosen.extents || [] : [];
    const extentOpts = extents
      .map(
        (e) =>
          `<option value="${esc(e)}"${e === createForm.extent ? ' selected' : ''}>${esc(e)}</option>`,
      )
      .join('');

    // Names already in use are the thing you used to leave the popups to look up.
    const takenStones = (c.stoneNames || []).length
      ? `In use: ${(c.stoneNames || []).join(', ')}`
      : 'No stones yet.';
    const takenLdis = (c.ldiNames || []).length
      ? `In use: ${(c.ldiNames || []).join(', ')}`
      : 'No NetLDIs yet.';

    // The NFS question used to be a modal on the first database. Here it is a
    // line you can read and answer without losing the rest of the form.
    const nfs = c.nfsWarning
      ? `<div class="cf-warn">
          <div><strong>${esc(c.rootPath)}</strong> looks like network storage. GemStone extents on NFS
          can be slow and, on some servers, unsafe.</div>
          <label class="cf-check"><input type="checkbox" data-create-field="allowNfs"${createForm.allowNfs ? ' checked' : ''}>
            Create it here anyway</label>
          <div class="cf-help">Or ${btn('chooseRoot', 'Choose another folder…', 'folderOpen', 'btn-secondary')} to keep databases somewhere local.</div>
        </div>`
      : '';

    const body = `<div class="create-form">
      ${field('version', 'GemStone release', 'Which release this database runs. Only releases installed on this machine can be used.', `<select id="cf-version" class="cf-input" data-create-field="version">${versionOpts}</select>`, '')}
      ${field('extent', 'Base extent', 'The starting database file that gets copied. Take the plain one unless you know you want another.', `<select id="cf-extent" class="cf-input" data-create-field="extent">${extentOpts}</select>`, problems.extent)}
      ${field('stoneName', 'Stone name', takenStones, `<input id="cf-stoneName" class="cf-input" type="text" data-create-field="stoneName" value="${esc(createForm.stoneName)}" spellcheck="false" autocomplete="off">`, problems.stoneName)}
      ${field('ldiName', 'NetLDI name', `${takenLdis} The NetLDI is the small service a login talks to on its way to the stone.`, `<input id="cf-ldiName" class="cf-input" type="text" data-create-field="ldiName" value="${esc(createForm.ldiName)}" spellcheck="false" autocomplete="off">`, problems.ldiName)}
      ${nfs}
      <div class="cf-actions">
        ${btn('submitCreate', 'Create Database', 'plus', 'btn-primary', blocked ? { disabled: true } : undefined)}
        ${btn('cancelCreate', 'Cancel', 'close', 'btn-secondary')}
      </div>
      <div class="cf-note dim">A DataCurator login is created with it, so you can connect straight away.</div>
    </div>`;

    return section({ key: 'create', title: 'New Database', open: true }, body);
  }

  function render(state) {
    windowsHost = !!state.windows;
    lastState = state;
    // The redraw replaces the row the pinned ⓘ was anchored to, so drop the bubble.
    closeInfoPopover();

    // Opening the form seeds it from what this machine already has, so the common
    // case is press Create. Seeding happens once per opening, not per redraw, or
    // typing would be overwritten by the next refresh.
    if (creating && !createForm.seeded) seedCreateForm(state);

    // Which field held focus must be read BEFORE the DOM is replaced: rewriting
    // innerHTML removes the old input, so focus has already fallen back to the
    // body by the time the fresh one exists. Reading it afterwards always misses,
    // and the caret is lost on every redraw arriving mid-type.
    const active = document.activeElement;
    const focusField =
      active && active.hasAttribute && active.hasAttribute('data-create-field')
        ? active.getAttribute('data-create-field')
        : null;

    els.root.innerHTML =
      renderHeader(state) +
      (creating
        ? renderCreate(state)
        : orderedSections(state)
            .map((s) => s.html)
            .join(''));

    // Which sections start open follows what needs attention, which is right on
    // arrival and wrong afterwards: the panel redraws itself whenever anything
    // changes, and a reader who opened Versions to work through it would watch it
    // snap shut under them. Once they have said, their answer stands.
    els.root.querySelectorAll('details.section[data-section]').forEach((d) => {
      const chosen = sectionChoice.get(d.dataset.section);
      if (chosen !== undefined) d.open = chosen;
      d.addEventListener('toggle', () => sectionChoice.set(d.dataset.section, d.open));
    });
    // Restore each database's expanded state across re-renders. Scoped to
    // .db-item so it does not also match the Files group, which carries data-db
    // for its own key.
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

    // Focus is returned to the field it was in (captured above, before the
    // rebuild) so a refresh arriving mid-type does not steal the cursor.
    if (focusField) {
      const box = els.root.querySelector(`[data-create-field="${focusField}"]`);
      if (box) {
        box.focus();
        if (box.setSelectionRange && box.type === 'text') {
          const end = box.value.length;
          box.setSelectionRange(end, end);
        }
      }
    }
  }

  /** First free name in the gs64stone, gs64stone2, gs64stone3… series. */
  function freeName(base, taken) {
    const used = taken || [];
    if (!used.includes(base)) return base;
    for (let n = 2; ; n += 1) {
      if (!used.includes(`${base}${n}`)) return `${base}${n}`;
    }
  }

  function seedCreateForm(state) {
    const c = state.create || {};
    const v = (c.versions || [])[0];
    createForm.seeded = true;
    createForm.version = v ? v.version : '';
    createForm.extent = v && (v.extents || [])[0] ? v.extents[0] : '';
    createForm.stoneName = freeName('gs64stone', c.stoneNames);
    createForm.ldiName = freeName('gs64ldi', c.ldiNames);
    createForm.allowNfs = false;
  }

  function post(msg) {
    vscode.postMessage(msg);
  }

  // ── Create-form interaction ─────────────────────────────────────────────────
  // Nothing here reaches this machine. Typing and choosing only update the held
  // answers, and nothing is posted until Create is pressed — which is what lets
  // you leave the panel to look something up and come back to a half-filled form.

  /** Store what a field now says. Returns false when it is not a form field. */
  function readCreateField(el) {
    const key = el.getAttribute && el.getAttribute('data-create-field');
    if (!key) return false;
    createForm[key] = el.type === 'checkbox' ? el.checked : el.value;
    // Changing the release changes which base extents exist, so the extent falls
    // back to that release's first rather than keeping a name it no longer has.
    if (key === 'version') {
      const v = createVersion((lastState && lastState.create) || {});
      createForm.extent = v && (v.extents || [])[0] ? v.extents[0] : '';
    }
    return true;
  }

  // Typing re-checks the answers in place rather than redrawing: rebuilding the
  // form would replace the input mid-keystroke and drop the caret to the end,
  // so a name typed in the middle would scramble.
  function refreshCreateProblems() {
    const problems = createProblems((lastState && lastState.create) || {});
    els.root.querySelectorAll('[data-cf-field]').forEach((wrap) => {
      const problem = problems[wrap.dataset.cfField] || '';
      const hint = wrap.querySelector('.cf-hint');
      const bad = wrap.querySelector('.cf-problem');
      wrap.classList.toggle('cf-bad', !!problem);
      if (hint) hint.hidden = !!problem;
      if (bad) {
        bad.hidden = !problem;
        bad.textContent = problem;
      }
    });
    const submit = els.root.querySelector('[data-action="submitCreate"]');
    if (submit) submit.disabled = Object.values(problems).some(Boolean);
  }

  /** The form's own buttons. Returns true when it consumed the click. */
  /** A positive result clears itself after a few seconds; a warning stays. */
  function setPingNotice(sessionId, tone, message) {
    clearTimeout(pingTimers.get(sessionId));
    pingNotices.set(sessionId, { tone, message });
    if (tone === 'ok') {
      pingTimers.set(
        sessionId,
        setTimeout(() => {
          pingNotices.delete(sessionId);
          if (lastState) render(lastState);
        }, OK_NOTICE_MS),
      );
    }
    if (lastState) render(lastState);
  }

  /** Notice interactions. Returns true when it consumed the click. */
  function onNoticeClick(el) {
    if (el.dataset.action === 'dismissPing') {
      const id = Number(el.dataset.session);
      clearTimeout(pingTimers.get(id));
      pingNotices.delete(id);
      if (lastState) render(lastState);
      return true;
    }
    if (el.dataset.action === 'copyNotice') {
      // Through the host: the webview clipboard is not reliably available under
      // this panel's CSP, but vscode.env.clipboard always is.
      post({ command: 'copyText', text: el.dataset.copy || '' });
      return true;
    }
    return false;
  }

  function onCreateClick(el) {
    const action = el.dataset.action;
    if (action === 'beginCreate') {
      creating = true;
      // Chosen from inside the panel, so the lists are what cancel returns to.
      openedForCreate = false;
      createForm.seeded = false;
      if (lastState) render(lastState);
      return true;
    }
    if (action === 'cancelCreate') {
      creating = false;
      // Opened straight into the form from the sidebar, cancel means "never
      // mind" — landing in a panel the user never asked to see reads as the
      // Cancel having done something else. When the panel was already open and
      // they chose New Database inside it, cancel goes back to the lists.
      if (openedForCreate) {
        post({ command: 'closePanel' });
        return true;
      }
      if (lastState) render(lastState);
      return true;
    }
    if (action === 'submitCreate') {
      // Re-checked here as well as in the button's disabled state: a refresh can
      // land between the last redraw and this click, taking a name that was free.
      if (Object.values(createProblems((lastState && lastState.create) || {})).some(Boolean)) {
        refreshCreateProblems();
        return true;
      }
      post({
        command: 'createDatabase',
        version: createForm.version,
        extent: createForm.extent,
        stoneName: createForm.stoneName,
        ldiName: createForm.ldiName,
        allowNfs: !!createForm.allowNfs,
      });
      // The host answers with fresh state once the database exists, and the new
      // row is the confirmation — so the form closes rather than sitting there
      // half-alive while the work happens.
      creating = false;
      openedForCreate = false;
      if (lastState) render(lastState);
      return true;
    }
    return false;
  }

  function onClick(e) {
    // Clicking an ⓘ pins its tooltip on screen (the hover title is untouched);
    // clicking the same ⓘ again closes it. A click anywhere else that is not in
    // the pinned bubble dismisses it (see also the capture-phase away-click).
    const info = e.target.closest('[data-config-info]');
    if (info) {
      e.preventDefault();
      toggleInfoPopover(info);
      return;
    }
    if (!e.target.closest('.config-info-pop')) closeInfoPopover();
    const el = e.target.closest('[data-action]');
    if (!el) return;
    // Prevent an action button inside a <summary> from also toggling the section.
    e.preventDefault();
    if (onNoticeClick(el)) return;
    if (onCreateClick(el)) return;
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

  function onContextMenu(e) {
    const editable = e.target.closest('input[type="text"], select, textarea');
    if (!editable) e.preventDefault();
  }

  function onInput(e) {
    const el = e.target.closest('[data-create-field]');
    if (!el) return;
    readCreateField(el);
    refreshCreateProblems();
  }

  // The ⓘ tooltip, pinned: the same text the hover title carries, kept on screen
  // so a long description can be read without holding the pointer still. The
  // native title is left in place, so hover still works exactly as before. A
  // redraw, Escape, a second click on the ⓘ, or a click away all close it.
  let infoPopover = null;
  let infoAnchor = null;
  function closeInfoPopover() {
    if (infoPopover) infoPopover.remove();
    infoPopover = null;
    infoAnchor = null;
    window.removeEventListener('scroll', closeInfoPopover, true);
    window.removeEventListener('resize', closeInfoPopover);
  }
  function toggleInfoPopover(anchor) {
    if (infoAnchor === anchor) {
      closeInfoPopover();
      return;
    }
    closeInfoPopover();
    const pop = document.createElement('div');
    pop.className = 'config-info-pop';
    pop.setAttribute('role', 'tooltip');
    // textContent (not innerHTML) — the tip is plain text with newlines that
    // `white-space: pre-line` renders as line breaks; nothing here is markup.
    pop.textContent = anchor.dataset.tip || anchor.getAttribute('title') || '';
    document.body.appendChild(pop);
    // Anchor under the ⓘ, pulled back inside the viewport if it would overflow.
    const r = anchor.getBoundingClientRect();
    const left = Math.max(6, Math.min(r.left, window.innerWidth - pop.offsetWidth - 6));
    pop.style.left = `${left}px`;
    pop.style.top = `${r.bottom + 4}px`;
    infoPopover = pop;
    infoAnchor = anchor;
    // The bubble is fixed-positioned from the ⓘ's current viewport spot, so a
    // scroll or resize would leave it stranded — close it, matching "a redraw
    // closes it". Capture phase catches scrolls on any inner scroller too.
    window.addEventListener('scroll', closeInfoPopover, true);
    window.addEventListener('resize', closeInfoPopover);
  }
  // A click anywhere outside the ⓘ and its bubble dismisses the bubble. Capture
  // phase so it runs even for clicks the panel handles and stops; it ignores the
  // ⓘ itself (the bubble's own toggle in onClick owns that) and clicks inside
  // the bubble.
  function onAwayClick(e) {
    if (!infoPopover) return;
    if (e.target.closest('[data-config-info]') || e.target.closest('.config-info-pop')) return;
    closeInfoPopover();
  }

  // Escape closes a pinned ⓘ first, then abandons the New Database form — the
  // keyboard equivalent of its Cancel button.
  function onKeydown(e) {
    if (e.key !== 'Escape') return;
    if (infoPopover) {
      closeInfoPopover();
      return;
    }
    if (creating) {
      e.preventDefault();
      const cancel = els.root.querySelector('[data-action="cancelCreate"]');
      if (cancel) onCreateClick(cancel);
    }
  }

  // A form select changes what the rest of the form offers (the release decides
  // the extents), so it redraws. A caret cannot be lost in a select, so the
  // in-place trick that typing needs is unnecessary here.
  function onChange(e) {
    const field = e.target.closest('[data-create-field]');
    if (field) {
      readCreateField(field);
      if (lastState) render(lastState);
      return;
    }
    // Changing a database's extent select is destructive, so it opens the guarded
    // replace flow through the host rather than swapping the file silently.
    const el = e.target.closest('[data-select]');
    if (!el) return;
    // Send the option the user actually chose, so the guarded replace flow starts
    // on it rather than reopening on the current extent.
    post({ command: el.dataset.select, dirName: el.dataset.dir, extent: el.value });
  }

  function init(refs, api) {
    els = refs;
    vscode = api;
    // A fresh panel shows the lists, not a half-filled form — so a reopened
    // panel (and each test that inits a new one) starts clean.
    creating = false;
    openedForCreate = false;
    createForm.seeded = false;
    // VS Code offers a webview the browser's Cut/Copy/Paste menu on right-click.
    // On a panel of buttons and rows that menu is noise — it appears over a login
    // name and offers to paste into it, which does nothing. It is left alone on
    // the form's text boxes, where those verbs are real.
    els.root.addEventListener('contextmenu', onContextMenu);
    els.root.addEventListener('click', onClick);
    els.root.addEventListener('change', onChange);
    els.root.addEventListener('input', onInput);
    els.root.addEventListener('keydown', onKeydown);
    // A pinned ⓘ bubble lives on document.body, outside the panel root, so its
    // dismiss-on-click-away has to watch the document, not just the root.
    document.addEventListener('click', onAwayClick, true);
    els.root.innerHTML = '<div class="skeleton">Loading GemStone environment…</div>';
    window.addEventListener('message', onHostMessage);
  }

  // Messages arrive from the extension host, which VS Code relays in from the
  // frame around this one — so `ev.source` is never this window, and testing
  // for that drops every message the panel exists to receive. What guards this
  // listener is the webview boundary itself: nothing else can reach it. Declared
  // at module scope so it is a stable reference — re-registering it (init runs
  // once per document in production, once per test in jsdom) is then a no-op
  // rather than stacking another handler.
  function onHostMessage(ev) {
    const msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.command === 'loading') {
      els.root.setAttribute('aria-busy', 'true');
    } else if (msg.command === 'actionFailed') {
      // The host reports its own failures; the panel only has to stop looking
      // busy, because the state that follows will not have changed.
      els.root.setAttribute('aria-busy', 'false');
    } else if (msg.command === 'pingResult') {
      setPingNotice(
        Number(msg.sessionId),
        msg.tone === 'warn' ? 'warn' : 'ok',
        String(msg.message || ''),
      );
    } else if (msg.command === 'beginCreate') {
      // The sidebar's New Database button, arriving as a message because the
      // form is view state the host does not hold.
      creating = true;
      openedForCreate = true;
      createForm.seeded = false;
      if (lastState) render(lastState);
    } else if (msg.command === 'state') {
      if (!msg.state || typeof msg.state !== 'object') return;
      els.root.setAttribute('aria-busy', 'false');
      render(msg.state);
    }
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.GemstoneDatabases = {
    init,
    render,
    renderVersions,
    renderDatabases,
    renderCreate,
    orderedSections,
    renderHeader,
    versionState,
    versionActions,
    createProblems,
    formatBytes,
  };
})();
