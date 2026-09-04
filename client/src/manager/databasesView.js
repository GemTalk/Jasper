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
  // redraw without the host having to post the state again. Null until the host
  // has sent one: every redraw is guarded on it, so a message that arrives
  // before the first state (the host posts `beginCreate` ahead of it, to get the
  // form on screen without waiting for the download catalogue) sets its flag and
  // leaves the loading line up, rather than drawing a form out of nothing.
  let lastState = null;

  // Whether the New Database form is showing instead of the lists, and the
  // answers held in it. They live here rather than in the host so a refresh
  // arriving mid-typing cannot discard them — the whole point of a form over the
  // old chain of popups.
  let creating = false;
  // Whether the form is the only reason this panel is on screen — set when the
  // host opens it straight into the form, cleared once the user has seen the
  // lists behind it.
  let openedForCreate = false;
  // The form was asked for on a machine with no release installed, so the lists
  // are showing instead and owe the reader an explanation. Cleared by installing
  // one.
  let needsVersionFirst = false;
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

  // Whether the Register Existing form is showing instead of the lists, and what
  // has been answered in it. Held here for the same reason `createForm` is: a
  // refresh arriving mid-typing must not discard the answers.
  //
  // `version` is never typed. It is filled in from the product directory's own
  // version.txt when the host answers `productPicked`, because the version has
  // to be the tree's, not the user's recollection of it. `confPath`, `globalDir`
  // and `netldiPort` are filled in the same way from a server already running
  // out of that tree — the only authority on where it registers.
  let registering = false;
  // What the host last told us went wrong. Kept until dismissed: the state post
  // that follows a failure is the unchanged state, so clearing it on the next
  // render would blank the message before it could be read.
  let lastFailure = '';
  const registerForm = {
    productPath: '',
    version: '',
    description: '',
    stoneName: '',
    ldiName: '',
    netldiPort: '',
    confPath: '',
    globalDir: '',
    /** Why the chosen folder cannot be used, from the host. */
    problem: '',
    /** Servers the host found running out of the chosen tree. */
    servers: [],
  };

  function resetRegisterForm() {
    Object.assign(registerForm, {
      productPath: '',
      version: '',
      description: '',
      stoneName: '',
      ldiName: '',
      netldiPort: '',
      confPath: '',
      globalDir: '',
      problem: '',
      servers: [],
    });
  }

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
    link: 'link',
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
    return `<i class="codicon codicon-${name} mark ${tone}"${tipAttr(title)} aria-hidden="true"></i>`;
  }

  // Every hover explanation in this panel is a `data-tip`, never a `title`: the
  // browser's own tooltip waits about a second and a half before it appears,
  // which on a row of unlabelled icons reads as "no tooltip at all". The panel
  // draws its own after a short beat instead (see showTip).
  function tipAttr(text) {
    const t = String(text == null ? '' : text);
    return t ? ` data-tip="${esc(t)}"` : '';
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
  // `extraClass` is for the few buttons that carry meaning in their colour — the
  // start/stop pair — and nothing else; it is not a way to invent new variants.
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
    const tip = tipAttr(a.title || label);
    const off = a.disabled ? ' disabled' : '';
    const extra = a.extraClass ? ` ${a.extraClass}` : '';

    if (a.iconOnly) {
      // An icon-only button has no visible words, so the tip is the only full
      // sentence about it — it is the accessible name too, rather than the
      // shorter label the tip expands on.
      const name = a.title || label;
      return `<button type="button" class="icon-btn${extra}" data-action="${action}"${data}${tip}${off} aria-label="${esc(name)}">${icon(iconKey)}</button>`;
    }
    const variant = cls === 'btn-primary' ? ' btn-primary' : '';
    const glyph = iconKey ? `${icon(iconKey)}` : '';
    return `<button type="button" class="btn${variant}${extra}" data-action="${action}"${data}${tip}${off}>${glyph}<span>${esc(label)}</span></button>`;
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
    // The way to get a release carries its words. It was icon-only, which read as
    // decoration: an unlabelled glyph in a header is not an answer to "how do I
    // get a new version?". The walkthrough stays a glyph — it is a pointer to
    // reading, not a thing you do to this machine — and it is the only home that
    // button has now that the Versions tree is gone.
    //
    // There is no Register Local… beside it. A tree built or unpacked elsewhere
    // is recognised by putting it in the versions folder, symlink or directory
    // alike, and a stone that already runs from such a tree is adopted by
    // Register Existing Database — which records where it really lives instead
    // of needing a link in Jasper's root at all.
    const getActions = btn('installNewVersion', 'Install Version…', 'plus', 'btn-secondary', {
      title: 'Choose a release from the download site, then download and unpack it',
    });
    const actions = getActions;

    if (!onDisk.length) {
      // Nothing installed is the one state where this section is the whole job,
      // so the button moves down beside the sentence that explains it rather
      // than sitting in the header, where a reader looking at the sentence has to
      // go hunting for it. Moved, not repeated: the header keeps none of it, or
      // the same button appears twice within one section.
      return section(
        { key: 'versions', title: 'Versions', count: `${installed} installed`, actions: '', open },
        `<div class="empty">
          <div>No GemStone release on this machine yet. Install one from the download site,
          or put a build you already have in ${esc((lastState && lastState.rootPath) || 'the versions folder')}.</div>
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
  //
  // A database with a server running outside Jasper's environment gets nothing:
  // Jasper cannot stop that server, and starting the other half beside it would
  // only collide with it. The per-server rows below offer the one action that
  // helps — restarting it under Jasper — and withhold their own toggles for the
  // same reason.
  function powerControl(db) {
    // A server of this name is running at another GemStone version: starting
    // would collide with it and stopping would drive the wrong binaries, so the
    // row offers neither and says so where the button would have been.
    if (db.versionMismatch) {
      return `<span class="db-state" data-tip="${esc(db.versionMismatch)}">${ICONS.warn}<span>version mismatch</span></span>`;
    }
    if ((db.external || []).length) return '';
    return db.stoneRunning
      ? `<button type="button" class="btn power power-stop" data-action="stopDatabase" data-dir="${esc(db.dirName)}"${tipAttr(`Stop ${db.stoneName}`)}>${ICONS.stop}<span>Stop</span></button>`
      : `<button type="button" class="btn power power-start" data-action="startDatabase" data-dir="${esc(db.dirName)}"${tipAttr(`Start ${db.stoneName}`)}>${ICONS.play}<span>Start</span></button>`;
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
        title: `Log out session ${session.id}`,
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
    return `<div class="db-line db-session${session.current ? ' db-session-current' : ''}"${tipAttr(tip)}>
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
                <span class="db-line-name"><span class="session-mark"></span><span class="db-login-user">${esc(l.label)}</span></span>
                <span class="db-line-actions">${btn('editLogin', 'Edit login', 'edit', null, {
                  login: l.label,
                  iconOnly: true,
                })}${btn('deleteLogin', 'Delete Login', 'trash', null, {
                  login: l.label,
                  iconOnly: true,
                  // The command's own title, so the row and the Logins &
                  // Sessions tree read the same for the same action.
                  title: 'Delete Login',
                })}${btn('connectLogin', 'Log in', null, 'btn-secondary', {
                  login: l.label,
                  title: `Log in to ${db.stoneName} as ${l.user}`,
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
    const add = `<button type="button" class="icon-btn" data-action="createLoginFromDb" data-dir="${esc(db.dirName)}" data-tip="New login" aria-label="New login">${ICONS.plus}</button>`;
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
            title: `Remove the stale lock file for ${proc.name}`,
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
            // Same red-stops / green-starts colouring as the database's own power
            // control above them: these two do the same thing to one server, and
            // an uncoloured pair of glyphs read as decoration beside a coloured one.
            extraClass: 'power-stop',
            title: `Stop ${label}`,
          })
        : btn(isStone ? 'startStone' : 'startNetldi', 'Start', 'play', 'btn-secondary', {
            dir: db.dirName,
            iconOnly: true,
            extraClass: 'power-start',
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
        ? `<button type="button" class="icon-btn" data-action="${rowAction.action}" data-path="${esc(f.path)}" data-dir="${esc(db.dirName)}"${tipAttr(`${rowAction.label} ${f.name}`)} aria-label="${esc(rowAction.label)} ${esc(f.name)}">${icon(rowAction.iconKey)}</button>`
        : '';
    const rows = files.length
      ? files
          .map(
            (f) =>
              `<li class="file-line"><button type="button" class="file-row" data-action="${action}" data-path="${esc(f.path)}" data-dir="${esc(db.dirName)}"${tipAttr(f.name)}><span class="file-name">${esc(f.name)}</span><span class="file-when">${esc(whenWritten(f.modifiedMs))}</span></button>${extra(f)}</li>`,
          )
          .join('')
      : `<li class="file-empty">${esc(emptyText)}</li>`;
    const reveal = `<button type="button" class="icon-btn" data-action="openDbSubfolder" data-dir="${esc(db.dirName)}" data-folder="${esc(folder)}" aria-label="Show ${esc(label)} folder in Finder"${tipAttr(`Open the ${label} folder`)}>${ICONS.folder}</button>`;
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
    const reveal = `<button type="button" class="icon-btn" data-action="openDbInFinder" data-dir="${esc(db.dirName)}"${tipAttr(`Open ${db.path}`)} aria-label="Open database folder">${ICONS.folder}</button>`;
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
    const backup =
      db.stoneRunning || db.registered
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
    // A registered database runs on an extent Jasper never copied and does not
    // know the name of — and replacing it would overwrite the user's own file.
    // The control is left out rather than shown dead: the row already says it is
    // registered, and its footer explains what that rules out.
    if (db.registered) return '';
    const extents = db.availableExtents || [];
    const current = String(db.baseExtent || '').replace(/\.dbf$/, '');
    const options = (extents.includes(current) ? extents : [current, ...extents])
      .map((e) => `<option value="${esc(e)}"${e === current ? ' selected' : ''}>${esc(e)}</option>`)
      .join('');
    const locked = !!db.stoneRunning;
    const title = locked
      ? 'Stop the stone to replace its base extent'
      : 'Base extent — choosing another replaces the database';
    return `<label class="extent"${tipAttr(title)}>
      <span class="extent-label">Extent</span>
      <select class="extent-select" data-select="replaceExtent" data-dir="${esc(db.dirName)}"${locked ? ' disabled' : ''}>${options}</select>
    </label>`;
  }

  /**
   * What a row's footer offers, which is where the two kinds of database differ
   * most: one Jasper created can be deleted, files and all; one it registered
   * cannot, because those files are the user's.
   *
   * Delete is still drawn for a registered database — greyed, with the reason on
   * hover — rather than left out. A missing button raises the question; a
   * disabled one that explains itself answers it. The reason has to hang on a
   * wrapper, because a disabled button receives no hover of its own.
   */
  function dbFooterActions(db) {
    if (!db.registered) {
      return btn('deleteDatabase', 'Delete Database', 'trash', 'btn-secondary', {
        dir: db.dirName,
      });
    }
    const reason = db.registeredReason || '';
    const disabledDelete = `<span class="db-disabled-wrap"${tipAttr(reason)}>${btn(
      'deleteDatabase',
      'Delete Database',
      'trash',
      'btn-secondary',
      { dir: db.dirName, disabled: true, title: reason },
    )}</span>`;
    const unregister = btn('unregisterDatabase', 'Unregister Database', 'close', 'btn-secondary', {
      dir: db.dirName,
      title:
        'Remove Jasper\u2019s record of this database. The installation is left untouched, ' +
        'and a running stone keeps running.',
    });
    const where = db.productPath
      ? `<span class="db-registered-note dim">Registered from <span class="mono">${esc(db.productPath)}</span>${
          db.netldiPort ? ` · NetLDI port ${esc(String(db.netldiPort))}` : ''
        }</span>`
      : '';
    return `${where}${disabledDelete}${unregister}`;
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
        ${db.registered ? badge('registered') : ''}
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
          ${dbFooterActions(db)}
        </div>
      </div>
    </details>`;
  }

  // `canCreate` is false when no release is installed: a form whose only choice is
  // empty cannot be completed, so New Database… is withheld. Making one is not the
  // only way to get a database, though — Register Existing… in the panel header
  // adopts an installation from anywhere and needs nothing installed here — so the
  // empty text names both ways rather than only Install.
  /**
   * The logins this machine has that no database row can show.
   *
   * A login is drawn under the database it targets, matched by stone name — so a
   * login to a stone Jasper has no database for (one on another host, or a stone
   * that was never registered here) matched no row and appeared nowhere at all.
   * It saved, it was in the settings, and the panel simply had no place to draw
   * it, which reads as the login not having been added. Each row says what makes
   * it different — its stone, its host and the NetLDI that reaches it — because
   * without a database above it, the user name alone identifies nothing.
   */
  function renderOtherLogins(logins, open) {
    const rows = logins
      .map((l) => {
        // The label names the user, stone and host, the way every login row does.
        // The NetLDI and release follow it dimmed: with no database row above to
        // supply them, they are all that separates two logins to the same stone.
        const extra = [l.netldi ? `via ${l.netldi}` : '', l.version]
          .filter((part) => part)
          .join(' · ');
        const open = l.sessions || [];
        const head = `<div class="db-line db-login">
            <span class="db-line-name"><span class="session-mark"></span><span class="db-login-user">${esc(l.label)}</span><span class="dim session-id">${esc(extra)}</span></span>
            <span class="db-line-actions">${btn('editLogin', 'Edit login', 'edit', null, {
              login: l.label,
              iconOnly: true,
            })}${btn('deleteLogin', 'Delete Login', 'trash', null, {
              login: l.label,
              iconOnly: true,
              title: 'Delete Login',
            })}${btn('connectLogin', 'Log in', null, 'btn-secondary', {
              login: l.label,
              title: `Log in to ${l.stone} as ${l.user}`,
            })}</span>
          </div>`;
        // Sessions belong under the login they were opened from, exactly as they do
        // on a database's rows. Without this a login here could be connected and
        // show nothing for it — the one place its sessions could appear is the row
        // itself, since there is no database above it carrying them.
        if (!open.length) return head;
        return (
          head +
          `<div class="session-block">
            <div class="session-caption">${open.length === 1 ? 'Session' : 'Sessions'}</div>
            ${open.map((sess) => sessionRow({ stoneName: l.stone }, l, sess)).join('')}
          </div>`
        );
      })
      .join('');
    // Its own +, because the per-database one prefills from the database it sits
    // under and there is none here — that is what puts a login in this section.
    const add = `<button type="button" class="icon-btn" data-action="addLogin" data-tip="New login" aria-label="New login">${ICONS.plus}</button>`;
    return section(
      {
        key: 'otherLogins',
        title: 'Other Logins',
        desc: 'not tied to a database on this machine',
        count: logins.length,
        actions: add,
        open,
      },
      rows,
    );
  }

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
        : `<div class="empty">No databases yet — install a GemStone release to make one, or
            use Register Existing… above to adopt one this machine already runs.</div>`;
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
    // A registered database runs from an installation outside Jasper's root, so
    // "nothing installed" is not "nothing here": the count leads whenever there
    // are databases, or the header denied the very rows beneath it.
    const lead = dbs
      ? installed
        ? `${dbs} database${dbs === 1 ? '' : 's'} · ${installed} version${installed === 1 ? '' : 's'} installed`
        : `${dbs} database${dbs === 1 ? '' : 's'} · no release installed here`
      : installed
        ? 'No databases yet — make one from a release you have installed.'
        : 'No GemStone release on this machine yet — install one to make a database, or register a database that already exists.';
    // Creating needs something to create from, so the button waits for a release.
    const create = installed ? btn('beginCreate', 'New Database\u2026', 'plus', 'btn-primary') : '';
    // Registering does not: the installation it adopts brings its own release,
    // which is the case a machine with nothing installed is most likely in.
    const register = btn('beginRegister', 'Register Existing\u2026', 'link', 'btn-secondary');
    return `<div class="gm-head">
      <div class="gm-head-text"><span class="gm-head-lead">${esc(lead)}</span></div>
      <div class="gm-head-acts">
        ${create}
        ${register}
        ${btn('refresh', 'Refresh', 'refresh', null, { iconOnly: true, title: 'Read this machine again, and ask the download catalogue for new releases' })}
      </div>
    </div>`;
  }

  function orderedSections(state) {
    const nothingInstalled = versionsInstalledCount(state.versions) === 0;
    const currentDir = (state.logins || []).find((l) => l.current)?.dirName;

    // Databases lead, always: they are what this panel is about, and versions sit
    // below, where you go back for a new release. Versions used to lead a machine
    // with nothing installed, on the reasoning that there was no database to make
    // yet — but Register Existing… adopts an installation from anywhere, so such a
    // machine can hold databases and no installed release at once, and burying
    // them under Versions read as the registration never having landed.
    // A login with no local database to sit under gets its own section rather
    // than being dropped: it is on this machine's list, so it belongs on screen.
    const unattached = (state.logins || []).filter((l) => !l.dirName);
    return [
      { html: renderDatabases(state.databases, true, currentDir, !nothingInstalled) },
      ...(unattached.length ? [{ html: renderOtherLogins(unattached, true) }] : []),
      { html: renderVersions(state.versions, true) },
    ];
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

  /**
   * Whether the New Database form has anything to work with. Its first question
   * is which installed release to copy; with none installed, every answer under
   * it is empty, Create can never be pressed, and Cancel is the only way out —
   * which is where the sidebar's + landed on a machine with no release yet.
   */
  function canCreateFrom(state) {
    return (((state || {}).create || {}).versions || []).length > 0;
  }

  // Said instead of that form: why the click did not open it. Deliberately just
  // the sentence — the Versions section is on screen below, leading with the
  // button that fixes it, so a copy up here only put two Install Version… on one
  // screen (three, with the one its section header used to carry).
  // What the host reported it could not do. Its `actionFailed` message used to be
  // dropped on arrival — the panel only stopped looking busy — so an action that
  // failed was indistinguishable from one that did nothing, which is how a
  // registration refused for an unwritable root read as "nothing happened".
  function renderFailure() {
    return `<div class="gm-blocked">
      <span class="note">${ICONS.warn}<span>${esc(lastFailure)}</span></span>
      ${btn('dismissFailure', 'Dismiss', 'close', 'btn-secondary')}
    </div>`;
  }

  function renderVersionFirst() {
    return `<div class="gm-blocked">
      <span class="note">${ICONS.warn}<span>New Database needs a GemStone release to copy from — install one below first.</span></span>
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

  // ── Registering an existing database ───────────────────────────────────────
  // The other half of "where does a database come from": one Jasper made, or one
  // that was already here. Register asks for the installation and the names its
  // servers run under, and writes only a record — see registeredDatabase.ts for
  // why it writes nothing else.

  /** Names of servers of one type the host found running out of the chosen tree. */
  function discoveredNames(type) {
    return (registerForm.servers || []).filter((sv) => sv.type === type).map((sv) => sv.name);
  }

  function registerProblems(c) {
    const names = c || {};
    const taken = (name, list, what) =>
      name && (list || []).includes(name)
        ? `A ${what} called "${name}" is already registered.`
        : '';
    return {
      productPath: registerForm.problem
        ? registerForm.problem
        : !registerForm.productPath
          ? 'Choose the GemStone product directory this database runs from.'
          : !registerForm.version
            ? 'That directory has no readable version.txt.'
            : '',
      stoneName: !registerForm.stoneName
        ? 'Enter the name of the stone as it was started.'
        : taken(registerForm.stoneName, names.stoneNames, 'stone'),
      ldiName: !registerForm.ldiName ? 'Enter the name of its NetLDI.' : '',
      netldiPort:
        registerForm.netldiPort && !/^\d{1,5}$/.test(String(registerForm.netldiPort))
          ? 'A port is a number, or leave it empty.'
          : '',
    };
  }

  /** A discovered server, said in one line: what it is, its PID, and its port. */
  function discoveredLine(sv) {
    const bits = [`${sv.type === 'stone' ? 'Stone' : 'NetLDI'} ${sv.name}`, `pid ${sv.pid}`];
    if (sv.port) bits.push(`port ${sv.port}`);
    if (sv.version) bits.push(sv.version);
    return bits.join(' · ');
  }

  function renderRegister(state) {
    const c = state.create || {};
    const problems = registerProblems(c);
    const blocked = Object.values(problems).some(Boolean);
    const chosen = registerForm.productPath
      ? `<div class="mono">${esc(registerForm.productPath)}</div>`
      : '<div class="dim">No directory chosen yet.</div>';
    const found = (registerForm.servers || []).length
      ? `<div class="cf-note dim">Running out of this installation now:<br>${(
          registerForm.servers || []
        )
          .map((sv) => esc(discoveredLine(sv)))
          .join('<br>')}</div>`
      : registerForm.productPath && registerForm.version
        ? `<div class="cf-note dim">Nothing of this installation is running. It can still be
            registered — Jasper will use GemStone's default configuration and
            registration directories, which only a running server can improve on.</div>`
        : '';

    // The version is shown, never chosen: it is read from the tree's version.txt.
    const versionLine = registerForm.version
      ? `<div class="mono">${esc(registerForm.version)}${
          registerForm.description
            ? ` <span class="dim">${esc(registerForm.description)}</span>`
            : ''
        }</div>`
      : '<div class="dim">Read from the directory you choose.</div>';

    const stoneHint = discoveredNames('stone').length
      ? `Running here: ${discoveredNames('stone').join(', ')}`
      : 'The stone name it was started with — Jasper does not rename it.';
    const ldiHint = discoveredNames('netldi').length
      ? `Running here: ${discoveredNames('netldi').join(', ')}`
      : 'The NetLDI a login talks to on its way to this stone.';

    const body = `<div class="create-form">
      ${field('productPath', 'Product directory', 'The GemStone installation whose binaries run this database. Jasper reads it and writes nothing inside it.', `${chosen}<div class="cf-actions">${btn('pickProduct', 'Choose Folder\u2026', 'folderOpen', 'btn-secondary')}</div>`, problems.productPath)}
      ${field('version', 'GemStone release', 'Read from the installation\u2019s own version.txt, so it always matches the tree that runs it.', versionLine, '')}
      ${field('stoneName', 'Stone name', stoneHint, `<input id="cf-stoneName" class="cf-input" type="text" data-register-field="stoneName" value="${esc(registerForm.stoneName)}" spellcheck="false" autocomplete="off">`, problems.stoneName)}
      ${field('ldiName', 'NetLDI name', ldiHint, `<input id="cf-ldiName" class="cf-input" type="text" data-register-field="ldiName" value="${esc(registerForm.ldiName)}" spellcheck="false" autocomplete="off">`, problems.ldiName)}
      ${field('netldiPort', 'NetLDI port (optional)', 'Given, logins address the NetLDI by port. Worth filling in: a NetLDI name only resolves through /etc/services, and an installation Jasper did not set up often uses a name that was never added there.', `<input id="cf-netldiPort" class="cf-input" type="text" inputmode="numeric" data-register-field="netldiPort" value="${esc(String(registerForm.netldiPort || ''))}" spellcheck="false" autocomplete="off">`, problems.netldiPort)}
      ${found}
      <div class="cf-actions">
        ${btn('submitRegister', 'Register Database', 'plus', 'btn-primary', blocked ? { disabled: true } : undefined)}
        ${btn('cancelRegister', 'Cancel', 'close', 'btn-secondary')}
      </div>
      <div class="cf-note dim">Jasper records where this installation lives so it can list, start,
        stop and log in to it. It never deletes, backs up or re-extents a database it did not create.</div>
    </div>`;

    return section({ key: 'register', title: 'Register Existing Database', open: true }, body);
  }

  function render(state) {
    windowsHost = !!state.windows;
    lastState = state;
    // The redraw replaces the element a tip is anchored to, so drop the tip.
    hideTip();

    // Asked for the form with nothing to make a database from. Show the lists —
    // Versions leads them in exactly this case — and say why, rather than a form
    // whose every answer is blank and whose Create can never be pressed.
    if (creating && !canCreateFrom(state)) {
      creating = false;
      openedForCreate = false;
      createForm.seeded = false;
      needsVersionFirst = true;
    } else if (canCreateFrom(state)) {
      needsVersionFirst = false;
    }

    // Opening the form seeds it from what this machine already has, so the common
    // case is press Create. Seeding happens once per opening, not per redraw, or
    // typing would be overwritten by the next refresh.
    if (creating && !createForm.seeded) seedCreateForm(state);

    // Which field held focus must be read BEFORE the DOM is replaced: rewriting
    // innerHTML removes the old input, so focus has already fallen back to the
    // body by the time the fresh one exists. Reading it afterwards always misses,
    // and the caret is lost on every redraw arriving mid-type.
    const active = document.activeElement;
    const focusAttr =
      active && active.hasAttribute && active.hasAttribute('data-register-field')
        ? 'data-register-field'
        : 'data-create-field';
    const focusField =
      active && active.hasAttribute && active.hasAttribute(focusAttr)
        ? active.getAttribute(focusAttr)
        : null;

    els.root.innerHTML =
      renderHeader(state) +
      (lastFailure ? renderFailure() : '') +
      (registering
        ? renderRegister(state)
        : creating
          ? renderCreate(state)
          : (needsVersionFirst ? renderVersionFirst() : '') +
            orderedSections(state)
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
      const box = els.root.querySelector(`[${focusAttr}="${focusField}"]`);
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

  /** Store what a Register Existing field now says. Returns false when it is
   *  not one. Answering clears the host's complaint about the chosen folder,
   *  which belongs to the folder and not to whatever is being typed now. */
  function readRegisterField(el) {
    const key = el.getAttribute && el.getAttribute('data-register-field');
    if (!key) return false;
    registerForm[key] = el.value;
    return true;
  }

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
  /** Swap each Register field's hint for its reason in place, the way
   *  `refreshCreateProblems` does — a full redraw mid-typing would take the
   *  caret with it. */
  function refreshRegisterProblems() {
    const problems = registerProblems((lastState && lastState.create) || {});
    els.root.querySelectorAll('[data-cf-field]').forEach((wrap) => {
      const problem = problems[wrap.dataset.cfField];
      if (problem === undefined) return;
      const hint = wrap.querySelector('.cf-hint');
      const bad = wrap.querySelector('.cf-problem');
      wrap.classList.toggle('cf-bad', !!problem);
      if (hint) hint.hidden = !!problem;
      if (bad) {
        bad.hidden = !problem;
        bad.textContent = problem;
      }
    });
    const submit = els.root.querySelector('[data-action="submitRegister"]');
    if (submit) submit.disabled = Object.values(problems).some(Boolean);
  }

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

  /** The Register Existing form's own buttons. Returns true when it consumed
   *  the click. Separate from onCreateClick so neither form's buttons can be
   *  mistaken for the other's. */
  function onRegisterClick(el) {
    const action = el.dataset.action;
    if (action === 'beginRegister') {
      registering = true;
      creating = false;
      resetRegisterForm();
      if (lastState) render(lastState);
      return true;
    }
    if (action === 'cancelRegister') {
      registering = false;
      resetRegisterForm();
      if (lastState) render(lastState);
      return true;
    }
    if (action === 'pickProduct') {
      // Only the host can open a folder dialog; it answers `productPicked`.
      post({ command: 'pickProductDirectory' });
      return true;
    }
    if (action === 'submitRegister') {
      // Re-checked here as well as in the button's disabled state, for the same
      // reason Create is: a refresh can land between the redraw and the click.
      if (Object.values(registerProblems((lastState && lastState.create) || {})).some(Boolean)) {
        if (lastState) render(lastState);
        return true;
      }
      const port = String(registerForm.netldiPort || '').trim();
      post({
        command: 'registerDatabase',
        productPath: registerForm.productPath,
        stoneName: registerForm.stoneName,
        ldiName: registerForm.ldiName,
        ...(port ? { netldiPort: Number(port) } : {}),
        ...(registerForm.confPath ? { confPath: registerForm.confPath } : {}),
        ...(registerForm.globalDir ? { globalDir: registerForm.globalDir } : {}),
      });
      registering = false;
      resetRegisterForm();
      if (lastState) render(lastState);
      return true;
    }
    return false;
  }

  function onCreateClick(el) {
    const action = el.dataset.action;
    if (action === 'beginCreate') {
      registering = false;
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
    // Whatever the click does, the tip belongs to the element under the pointer
    // a moment ago — and most clicks here redraw, which takes that element away.
    hideTip();
    const el = e.target.closest('[data-action]');
    if (!el) return;
    // Prevent an action button inside a <summary> from also toggling the section.
    e.preventDefault();
    if (el.dataset.action === 'dismissFailure') {
      lastFailure = '';
      if (lastState) render(lastState);
      return;
    }
    if (onNoticeClick(el)) return;
    if (onRegisterClick(el)) return;
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
    const registerField = e.target.closest('[data-register-field]');
    if (registerField) {
      readRegisterField(registerField);
      refreshRegisterProblems();
      return;
    }
    const el = e.target.closest('[data-create-field]');
    if (!el) return;
    readCreateField(el);
    refreshCreateProblems();
  }

  // ── Tooltips ────────────────────────────────────────────────────────────────
  // The panel draws its own rather than leaving the explanations in `title`.
  // A native tooltip waits roughly a second and a half, which on a toolbar of
  // unlabelled icons — the pair beside the Extent dropdown especially — reads as
  // no tooltip at all; and it cannot be styled to match the editor. This one
  // appears after a short beat, is a plain fixed-position div on document.body,
  // and so is not clipped by the `overflow: hidden` every section carries.
  const TIP_DELAY_MS = 150;
  let tipEl = null;
  let tipAnchor = null;
  let tipTimer = null;

  function hideTip() {
    if (tipTimer) clearTimeout(tipTimer);
    tipTimer = null;
    if (tipEl) tipEl.remove();
    tipEl = null;
    tipAnchor = null;
    window.removeEventListener('scroll', hideTip, true);
    window.removeEventListener('resize', hideTip);
  }

  function showTip(anchor) {
    const text = anchor.dataset.tip || '';
    if (!text) return;
    const tip = document.createElement('div');
    tip.className = 'gm-tip';
    tip.setAttribute('role', 'tooltip');
    // textContent (not innerHTML) — the tip is plain text, and some of it is a
    // file system path the user chose the name of.
    tip.textContent = text;
    document.body.appendChild(tip);
    const r = anchor.getBoundingClientRect();
    // Centred under the anchor, then pulled back inside the viewport; a tip near
    // the bottom flips above rather than hanging off the edge.
    const left = Math.max(
      6,
      Math.min(r.left + r.width / 2 - tip.offsetWidth / 2, window.innerWidth - tip.offsetWidth - 6),
    );
    const below = r.bottom + 6;
    const top =
      below + tip.offsetHeight > window.innerHeight - 6 ? r.top - tip.offsetHeight - 6 : below;
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(6, top)}px`;
    tipEl = tip;
    tipAnchor = anchor;
    // Fixed-positioned from where the anchor is right now, so a scroll or a
    // resize would strand it. Capture phase catches inner scrollers too.
    window.addEventListener('scroll', hideTip, true);
    window.addEventListener('resize', hideTip);
  }

  // Hover arms the beat; moving onto something else (or nothing) drops it. The
  // guard on the same anchor keeps a tip steady while the pointer travels across
  // the glyph inside the button it is already showing for.
  function onPointerOver(e) {
    const anchor = e.target.closest && e.target.closest('[data-tip]');
    if (anchor && anchor === tipAnchor) return;
    hideTip();
    if (!anchor) return;
    tipAnchor = anchor;
    tipTimer = setTimeout(() => {
      tipTimer = null;
      const target = tipAnchor;
      tipAnchor = null;
      if (target && target.isConnected) showTip(target);
    }, TIP_DELAY_MS);
  }

  // Keyboard focus shows the tip at once: a reader who tabbed here has already
  // waited, and there is no pointer drifting across rows to protect them from.
  function onFocusIn(e) {
    const anchor = e.target.closest && e.target.closest('[data-tip]');
    hideTip();
    if (anchor) showTip(anchor);
  }

  // Escape drops a tip that is up, then abandons the New Database form — the
  // keyboard equivalent of its Cancel button.
  function onKeydown(e) {
    if (e.key !== 'Escape') return;
    hideTip();
    if (registering) {
      e.preventDefault();
      const cancel = els.root.querySelector('[data-action="cancelRegister"]');
      if (cancel) onRegisterClick(cancel);
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
    registering = false;
    lastFailure = '';
    resetRegisterForm();
    openedForCreate = false;
    needsVersionFirst = false;
    createForm.seeded = false;
    // Nothing has been drawn yet, so nothing may be redrawn from memory.
    lastState = null;
    // VS Code offers a webview the browser's Cut/Copy/Paste menu on right-click.
    // On a panel of buttons and rows that menu is noise — it appears over a login
    // name and offers to paste into it, which does nothing. It is left alone on
    // the form's text boxes, where those verbs are real.
    els.root.addEventListener('contextmenu', onContextMenu);
    els.root.addEventListener('click', onClick);
    els.root.addEventListener('change', onChange);
    els.root.addEventListener('input', onInput);
    els.root.addEventListener('keydown', onKeydown);
    // The panel's own tooltips: armed on hover, shown at once on keyboard focus,
    // and dropped when the pointer leaves the panel altogether (no `pointerover`
    // fires for the space outside it).
    els.root.addEventListener('pointerover', onPointerOver);
    els.root.addEventListener('pointerleave', hideTip);
    els.root.addEventListener('focusin', onFocusIn);
    els.root.addEventListener('focusout', hideTip);
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
      // Shown, not merely absorbed. The state that follows is the unchanged one,
      // so without this the panel answered a failed action by redrawing exactly
      // what was already there — the action's own error never reaching the
      // screen the host had written it for.
      els.root.setAttribute('aria-busy', 'false');
      lastFailure = String(msg.message || '');
      if (lastState) render(lastState);
    } else if (msg.command === 'pingResult') {
      setPingNotice(
        Number(msg.sessionId),
        msg.tone === 'warn' ? 'warn' : 'ok',
        String(msg.message || ''),
      );
    } else if (msg.command === 'productPicked') {
      // The host has read the chosen directory. Everything it learned lands in
      // the form: the version (never typed), and — from a server already running
      // out of that tree — the names, port and directories that make the record
      // correct rather than merely plausible.
      registerForm.productPath = String(msg.productPath || '');
      registerForm.problem = String(msg.problem || '');
      registerForm.version = String(msg.version || '');
      registerForm.description = String(msg.description || '');
      registerForm.servers = Array.isArray(msg.servers) ? msg.servers : [];
      const stone = registerForm.servers.find((sv) => sv.type === 'stone');
      const netldi = registerForm.servers.find((sv) => sv.type === 'netldi');
      // Prefilled, not forced: a typed answer for a stone that is currently down
      // is exactly what this form is for, so anything already entered stays.
      if (stone && !registerForm.stoneName) registerForm.stoneName = stone.name;
      if (netldi && !registerForm.ldiName) registerForm.ldiName = netldi.name;
      if (netldi && netldi.port && !registerForm.netldiPort) {
        registerForm.netldiPort = String(netldi.port);
      }
      // Where the servers register and what configuration they run on are the
      // installation's facts, not the user's — so a running server's answer
      // always wins over anything held here.
      const source = stone || netldi;
      if (source && source.globalDir) registerForm.globalDir = source.globalDir;
      if (stone && stone.confPath) registerForm.confPath = stone.confPath;
      if (lastState) render(lastState);
    } else if (msg.command === 'beginCreate') {
      // The sidebar's New Database button, arriving as a message because the
      // form is view state the host does not hold.
      creating = true;
      registering = false;
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
    canCreateFrom,
    createProblems,
    formatBytes,
  };
})();
