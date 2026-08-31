// Webview-side script for the standalone Session Configuration panel (configurationPanel.ts).
// Plain JS that runs in the webview DOM (not bundled). Renders the configuration
// the host reads from the session, and dispatches every action back to the host
// as a postMessage. Exposes a single global `GemstoneConfig` so it can be
// unit-tested in jsdom.
//
// Convention (see debuggerView.js): the host injects this, then calls
// GemstoneConfig.init(refs, vscode, meta) from a nonce'd bootstrap <script>. The
// whole panel is built from plain HTML styled with --vscode-* theme variables.
// Glyphs are inlined SVGs (the exact VS Code codicon paths), not a webfont — so
// the panel needs no font load or extra localResourceRoots and stays within the
// strict webview CSP, exactly as debuggerPanel.ts does.
(function () {
  let vscode;
  let els;
  // Header facts for the panel, injected at init so it can label itself before
  // the first read returns (the configuration payload carries them too).
  let meta = { label: '', version: '' };

  // The configuration is fetched from the session on demand, so it lives here
  // between the request and the reply, and across the redraws that follow.
  let lastConfig = null;
  let configError = '';
  let configLoading = false;
  const configEditing = new Set();
  let configFilter = '';
  // The result of a Ping (shown in the header, beside the button) and of a Set
  // (shown inline, right under the row that was changed, so it is visible without
  // scrolling back to the top). Each is { tone: 'ok' | 'warn', message }, and a
  // set result also carries { scope, key } so it can be placed by its row.
  // Success is transient — it clears itself after a few seconds; a warning or a
  // failure stays until dismissed, with Copy so the stone's words can be kept.
  let pingNotice = null;
  let setNotice = null;
  let pingTimer;
  let setTimer;
  // How long a positive result stays before clearing itself.
  const OK_NOTICE_MS = 5000;
  // Which config groups (scope -> open?) the user has collapsed, kept across the
  // panel's redraws so a collapsed Stone group does not spring back open.
  const configGroupsOpen = new Map();

  // The exact VS Code codicon SVG paths for the glyphs this panel draws, inlined
  // so no webfont is fetched. `fill="currentColor"` lets the surrounding text
  // colour drive each glyph.
  const SVG = {
    chevron:
      '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6.14601 3.14579C5.95101 3.34079 5.95101 3.65779 6.14601 3.85279L10.292 7.99879L6.14601 12.1448C5.95101 12.3398 5.95101 12.6568 6.14601 12.8518C6.34101 13.0468 6.65801 13.0468 6.85301 12.8518L11.353 8.35179C11.548 8.15679 11.548 7.83979 11.353 7.64478L6.85301 3.14479C6.65801 2.94979 6.34101 2.95079 6.14601 3.14579Z"/></svg>',
    info: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8.49902 7.49998C8.49902 7.22384 8.27517 6.99998 7.99902 6.99998C7.72288 6.99998 7.49902 7.22384 7.49902 7.49998V10.5C7.49902 10.7761 7.72288 11 7.99902 11C8.27517 11 8.49902 10.7761 8.49902 10.5V7.49998ZM8.74807 5.50001C8.74807 5.91369 8.41271 6.24905 7.99903 6.24905C7.58535 6.24905 7.25 5.91369 7.25 5.50001C7.25 5.08633 7.58535 4.75098 7.99903 4.75098C8.41271 4.75098 8.74807 5.08633 8.74807 5.50001ZM8 1C4.13401 1 1 4.13401 1 8C1 11.866 4.13401 15 8 15C11.866 15 15 11.866 15 8C15 4.13401 11.866 1 8 1ZM2 8C2 4.68629 4.68629 2 8 2C11.3137 2 14 4.68629 14 8C14 11.3137 11.3137 14 8 14C4.68629 14 2 11.3137 2 8Z"/></svg>',
    edit: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M14.236 1.76386C13.2123 0.740172 11.5525 0.740171 10.5289 1.76386L2.65722 9.63549C2.28304 10.0097 2.01623 10.4775 1.88467 10.99L1.01571 14.3755C0.971767 14.5467 1.02148 14.7284 1.14646 14.8534C1.27144 14.9783 1.45312 15.028 1.62432 14.9841L5.00978 14.1151C5.52234 13.9836 5.99015 13.7168 6.36433 13.3426L14.236 5.47097C15.2596 4.44728 15.2596 2.78755 14.236 1.76386ZM11.236 2.47097C11.8691 1.8378 12.8957 1.8378 13.5288 2.47097C14.162 3.10413 14.162 4.1307 13.5288 4.76386L12.75 5.54269L10.4571 3.24979L11.236 2.47097ZM9.75002 3.9569L12.0429 6.24979L5.65722 12.6355C5.40969 12.883 5.10023 13.0595 4.76117 13.1465L2.19447 13.8053L2.85327 11.2386C2.9403 10.8996 3.1168 10.5901 3.36433 10.3426L9.75002 3.9569Z"/></svg>',
    check:
      '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.6572 3.13573C13.8583 2.9465 14.175 2.95614 14.3643 3.15722C14.5535 3.35831 14.5438 3.675 14.3428 3.86425L5.84277 11.8642C5.64597 12.0494 5.33756 12.0446 5.14648 11.8535L1.64648 8.35351C1.45121 8.15824 1.45121 7.84174 1.64648 7.64647C1.84174 7.45121 2.15825 7.45121 2.35351 7.64647L5.50976 10.8027L13.6572 3.13573Z"/></svg>',
    discard:
      '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3.00098 2.5C3.00098 2.22386 3.22483 2 3.50098 2C3.77712 2 4.00098 2.22386 4.00098 2.5V6.34262L7.17202 3.17157C8.73412 1.60948 11.2668 1.60948 12.8289 3.17157C14.391 4.73367 14.391 7.26633 12.8289 8.82843L7.80375 13.8536C7.60849 14.0488 7.2919 14.0488 7.09664 13.8536C6.90138 13.6583 6.90138 13.3417 7.09664 13.1464L12.1218 8.12132C13.2933 6.94975 13.2933 5.05025 12.1218 3.87868C10.9502 2.70711 9.0507 2.70711 7.87913 3.87868L4.75781 7H8.50098C8.77712 7 9.00098 7.22386 9.00098 7.5C9.00098 7.77614 8.77712 8 8.50098 8H3.60098C3.26961 8 3.00098 7.73137 3.00098 7.4V2.5Z"/></svg>',
    close:
      '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8.70701 8.00001L12.353 4.35401C12.548 4.15901 12.548 3.84201 12.353 3.64701C12.158 3.45201 11.841 3.45201 11.646 3.64701L8.00001 7.29301L4.35401 3.64701C4.15901 3.45201 3.84201 3.45201 3.64701 3.64701C3.45201 3.84201 3.45201 4.15901 3.64701 4.35401L7.29301 8.00001L3.64701 11.646C3.45201 11.841 3.45201 12.158 3.64701 12.353C3.74501 12.451 3.87301 12.499 4.00101 12.499C4.12901 12.499 4.25701 12.45 4.35501 12.353L8.00101 8.70701L11.647 12.353C11.745 12.451 11.873 12.499 12.001 12.499C12.129 12.499 12.257 12.45 12.355 12.353C12.55 12.158 12.55 11.841 12.355 11.646L8.70901 8.00001H8.70701Z"/></svg>',
    refresh:
      '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 8C3 5.23858 5.23858 3 8 3C9.63527 3 11.0878 3.78495 12.0005 5H10C9.72386 5 9.5 5.22386 9.5 5.5C9.5 5.77614 9.72386 6 10 6H12.8904C12.8973 6.00014 12.9041 6.00014 12.911 6H13C13.2761 6 13.5 5.77614 13.5 5.5V2.5C13.5 2.22386 13.2761 2 13 2C12.7239 2 12.5 2.22386 12.5 2.5V4.03138C11.4009 2.78613 9.79253 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14C11.1301 14 13.6999 11.6035 13.9756 8.54488C14.0003 8.26985 13.7975 8.0268 13.5225 8.00202C13.2474 7.97723 13.0044 8.1801 12.9796 8.45512C12.75 11.003 10.6079 13 8 13C5.23858 13 3 10.7614 3 8Z"/></svg>',
    pulse:
      '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5.76002 2.49999C5.98102 2.50399 6.17302 2.65399 6.23202 2.86699L8.52102 11.19L10.271 5.35599C10.332 5.15399 10.513 5.01099 10.724 4.99999C10.935 4.98899 11.13 5.11199 11.211 5.30699L12.333 7.99899H14C14.276 7.99899 14.5 8.22299 14.5 8.49899C14.5 8.77499 14.276 8.99899 14 8.99899H12C11.798 8.99899 11.616 8.87799 11.538 8.69099L10.826 6.98299L8.97802 13.142C8.91402 13.356 8.71602 13.501 8.49302 13.498C8.27002 13.495 8.07602 13.346 8.01702 13.131L5.71402 4.75699L4.47502 8.64999C4.40902 8.85799 4.21602 8.99799 3.99902 8.99799H1.99902C1.72302 8.99799 1.49902 8.77399 1.49902 8.49799C1.49902 8.22199 1.72302 7.99799 1.99902 7.99799H3.63302L5.27202 2.84599C5.33902 2.63499 5.53702 2.49299 5.75802 2.49799L5.76002 2.49999Z"/></svg>',
    pass: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M10.6484 5.64648C10.8434 5.45148 11.1605 5.45148 11.3555 5.64648C11.5498 5.84137 11.5499 6.15766 11.3555 6.35254L7.35547 10.3525C7.25747 10.4495 7.12898 10.499 7.00098 10.499C6.87299 10.499 6.74545 10.4505 6.64746 10.3525L4.64746 8.35254C4.45247 8.15754 4.45248 7.84148 4.64746 7.64648C4.84246 7.45148 5.15949 7.45148 5.35449 7.64648L7 9.29199L10.6465 5.64648H10.6484Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M8 1C11.86 1 15 4.14 15 8C15 11.86 11.86 15 8 15C4.14 15 1 11.86 1 8C1 4.14 4.14 1 8 1ZM8 2C4.691 2 2 4.691 2 8C2 11.309 4.691 14 8 14C11.309 14 14 11.309 14 8C14 4.691 11.309 2 8 2Z"/></svg>',
    warning:
      '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M14.831 11.965L9.206 1.714C8.965 1.274 8.503 1 8 1C7.497 1 7.035 1.274 6.794 1.714L1.169 11.965C1.059 12.167 1 12.395 1 12.625C1 13.383 1.617 14 2.375 14H13.625C14.383 14 15 13.383 15 12.625C15 12.395 14.941 12.167 14.831 11.965ZM8.75 11.25C8.75 11.664 8.414 12 8 12C7.586 12 7.25 11.664 7.25 11.25C7.25 10.836 7.586 10.5 8 10.5C8.414 10.5 8.75 10.836 8.75 11.25ZM7.5 9V5.5C7.5 5.224 7.724 5 8 5C8.276 5 8.5 5.224 8.5 5.5V9C8.5 9.276 8.276 9.5 8 9.5C7.724 9.5 7.5 9.276 7.5 9Z"/></svg>',
  };

  /** An inline glyph, sized by the surrounding text. */
  function icon(name, extraClass) {
    return `<span class="ico${extraClass ? ` ${extraClass}` : ''}" aria-hidden="true">${SVG[name] || ''}</span>`;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  }

  /** A pill label, styled off --vscode-badge-*. */
  function badge(text, kind) {
    return `<span class="badge${kind ? ` badge-${kind}` : ''}">${esc(text)}</span>`;
  }

  // The body of a result banner: an icon, the message, and — for anything that is
  // not a plain success — Copy (keeps the stone's exact words) and Dismiss. A
  // success carries no buttons; it clears itself (see setPingNotice/setSetNotice).
  function noticeInner(notice, dismissAction) {
    const glyph = notice.tone === 'ok' ? icon('pass') : icon('warning');
    const actions =
      notice.tone === 'ok'
        ? ''
        : `<span class="notice-actions">
             <button type="button" class="notice-btn" data-action="copyNotice" data-copy="${esc(notice.message)}">Copy</button>
             <button type="button" class="notice-btn" data-action="${dismissAction}">Dismiss</button>
           </span>`;
    return `${glyph}<span class="notice-msg">${esc(notice.message)}</span>${actions}`;
  }

  // The inline editor for one editable value: a true/false select for a Boolean,
  // a plain input otherwise, with Set and Cancel beside it. The current value is
  // the starting point, so Set with no change is a no-op the stone simply accepts.
  function configEditor(param, scope) {
    const control =
      param.type === 'boolean'
        ? `<select class="config-input" data-config-input>
             <option value="true"${param.value === 'true' ? ' selected' : ''}>true</option>
             <option value="false"${param.value === 'false' ? ' selected' : ''}>false</option>
           </select>`
        : `<input type="text" class="config-input" data-config-input value="${esc(param.value)}"${
            param.type === 'integer' ? ' inputmode="numeric"' : ''
          } />`;
    return `<span class="config-edit">
      ${control}
      <button type="button" class="icon-btn" data-action="saveConfig" data-scope="${esc(scope)}" data-key="${esc(param.key)}" data-vtype="${esc(param.type)}" title="Set ${esc(param.key)}" aria-label="Set value">${icon('check')}</button>
      <button type="button" class="icon-btn" data-action="cancelConfig" data-scope="${esc(scope)}" data-key="${esc(param.key)}" title="Cancel" aria-label="Cancel">${icon('discard')}</button>
    </span>`;
  }

  // How a value's type reads in a tooltip.
  function typeLabel(type) {
    return (
      { boolean: 'Boolean', integer: 'Integer', string: 'String', other: 'Value' }[type] || 'Value'
    );
  }

  // Why a value cannot be changed here, when it can't — so the badge never just
  // says "read-only" without saying why.
  function readonlyReason(param) {
    if (!param.settable) {
      return 'Read-only — set in the config file before the stone started; it cannot be changed while the stone is running.';
    }
    if (param.type === 'other') {
      return 'Read-only here — this kind of value cannot be edited in place.';
    }
    return 'Read-only in this session — this is a stone setting; changing it requires logging in as SystemUser.';
  }

  // One parameter row. The badge and tooltip describe what you can actually do
  // with the value *in this session*: Editable rows carry a pencil and can be
  // changed now; everything else is Read-only, with the tooltip saying why. Every
  // row also carries an ⓘ whose text (type, what you can do, and the purpose from
  // system.conf) shows in a styled bubble on hover and pins on click — the same
  // bubble in both cases, so hover and click look identical (the click one just
  // stays until dismissed). The bubble text lives in data-tip, not a native
  // title, so it renders with the panel's own styling rather than the browser's.
  function configRow(param, scope) {
    const id = `${scope}:${param.key}`;
    const editing = configEditing.has(id);
    const help = param.description
      ? param.description
      : lastConfig && lastConfig.descriptionsAvailable
        ? 'No description: this parameter has no matching entry in system.conf — a runtime setting whose config-file name differs from its runtime name.'
        : 'No descriptions: system.conf was not found for this version (for example, a remote stone whose product tree is not on this machine).';
    const stateLine = param.editable
      ? 'Editable — you can change it in this session.'
      : readonlyReason(param);
    const tip = `${typeLabel(param.type)} · ${stateLine}\n\n${help}`;
    const tag = param.editable ? badge('Editable', 'editable') : badge('Read-only', 'readonly');
    const shownValue = esc(param.value === '' ? "''" : param.value);
    const valueCell = editing
      ? configEditor(param, scope)
      : param.editable
        ? `<button type="button" class="config-value-btn" data-action="editConfig" data-scope="${esc(scope)}" data-key="${esc(param.key)}" title="Click to edit ${esc(param.key)}">
             <span class="config-value">${shownValue}</span>
             ${icon('edit', 'config-pencil')}
           </button>`
        : `<span class="config-value">${shownValue}</span>`;
    return `<tr class="config-item" data-config-key="${esc(param.key.toLowerCase())}" data-config-scope="${esc(scope)}">
      <td class="config-key"><span class="config-name">${esc(param.key)}</span>
        <button type="button" class="config-info" data-config-info data-tip="${esc(tip)}" aria-label="${esc(param.key + ': ' + tip)}">${icon('info')}</button></td>
      <td class="config-val">${valueCell}</td>
      <td class="config-tag">${tag}</td>
    </tr>`;
  }

  // The set result, shown as a full-width banner directly under the row it belongs
  // to, so the outcome of a change is visible right where the change was made —
  // not only at the top of a long, scrolled list.
  function setNoticeRow() {
    return `<tr class="config-notice-row"><td colspan="3">
      <div class="config-notice ${setNotice.tone === 'warn' ? 'warn' : 'ok'}" role="status">${noticeInner(setNotice, 'dismissSet')}</div>
    </td></tr>`;
  }

  // Each family is its own disclosure, so a reader can collapse Stone (161 rows)
  // to get straight to the gem settings, and back. The chevron rotates to show
  // open/closed; open state is remembered across the panel's redraws (see render).
  function configTable(title, scope, params) {
    if (!params || !params.length) return '';
    const editable = params.filter((p) => p.editable).length;
    const rows = params
      .map((p) => {
        const rowHtml = configRow(p, scope);
        // A set result rides directly beneath its own row.
        return setNotice && setNotice.scope === scope && setNotice.key === p.key
          ? rowHtml + setNoticeRow()
          : rowHtml;
      })
      .join('');
    return `<details class="config-group" data-config-group="${esc(scope)}" open>
      <summary class="config-group-head">
        ${icon('chevron', 'section-twist')}
        <span class="config-group-title">${esc(title)}</span>
        <span class="section-count">${params.length}</span>${
          editable ? `<span class="config-note">${editable} editable</span>` : ''
        }
      </summary>
      <table class="config-table"><tbody>${rows}</tbody></table>
    </details>`;
  }

  // The panel body: the stone and gem configuration of the session. Values load
  // on demand — the header carries a Ping result, Ping, and Refresh, and opening
  // the panel asks the host to read them (init posts `ready`).
  function renderBody() {
    const label = (lastConfig && lastConfig.label) || meta.label || 'this session';
    const version = (lastConfig && lastConfig.version) || meta.version || '';
    // The ping result sits to the LEFT of the Ping button.
    const pingHtml = pingNotice
      ? `<span class="ping-result ${pingNotice.tone === 'warn' ? 'warn' : 'ok'}" role="status">${noticeInner(pingNotice, 'dismissPing')}</span>`
      : '';
    const actions = `<span class="config-panel-actions">
      ${pingHtml}
      <button type="button" class="btn" data-action="ping" title="Check that the session is alive and responsive">${icon('pulse')}<span>Ping</span></button>
      <button type="button" class="icon-btn" data-action="loadConfiguration" title="Reload settings from the session" aria-label="Refresh">${icon('refresh')}</button>
    </span>`;
    const head = `<header class="config-panel-head">
      <span class="config-panel-title">Session Configuration</span>
      <span class="config-panel-sub dim">${esc(label)}${version ? ` · ${esc(version)}` : ''}</span>
      ${actions}
    </header>`;

    let body;
    if (configError && !lastConfig) {
      body = `<div class="config-error">${esc(configError)}</div>
        <div><button type="button" class="btn" data-action="loadConfiguration">${icon('refresh')}<span>Try again</span></button></div>`;
    } else if (!lastConfig) {
      body = configLoading
        ? `<div class="config-loading">Reading configuration…</div>`
        : `<div class="empty">Configuration for ${esc(label)}.
             <div><button type="button" class="btn" data-action="loadConfiguration">${icon('refresh')}<span>Load configuration</span></button></div></div>`;
    } else {
      const errLine = configError ? `<div class="config-error">${esc(configError)}</div>` : '';
      body = `<div class="config-toolbar">
          <div class="config-filter-wrap">
            <input type="text" class="config-filter" data-config-filter placeholder="Filter parameters…" value="${esc(configFilter)}" aria-label="Filter configuration parameters" />
            <button type="button" class="config-filter-clear" data-config-filter-clear title="Clear filter" aria-label="Clear filter"${configFilter ? '' : ' hidden'}>${icon('close')}</button>
          </div>
          <span class="config-legend">${badge('Editable', 'editable')} click a value with ${icon('edit')} to change it in this session · ${badge('Read-only', 'readonly')} can't be changed here (set in the config file, or needs SystemUser)</span>
        </div>
        ${errLine}
        ${configTable('Stone', 'stone', lastConfig.stoneParams)}
        ${configTable('Gem', 'gem', lastConfig.gemParams)}`;
    }
    return head + body;
  }

  function render() {
    // The redraw replaces the row the pinned ⓘ was anchored to, so drop the bubble.
    closeInfoPopover();
    const hadFilterFocus =
      document.activeElement && document.activeElement.hasAttribute('data-config-filter');
    els.root.innerHTML = renderBody();
    els.root.querySelectorAll('details.config-group[data-config-group]').forEach((d) => {
      const key = d.dataset.configGroup;
      if (configGroupsOpen.has(key)) d.open = configGroupsOpen.get(key);
      d.addEventListener('toggle', () => configGroupsOpen.set(key, d.open));
    });
    applyConfigFilter();
    updateFilterClear();
    if (hadFilterFocus) {
      const box = els.root.querySelector('[data-config-filter]');
      if (box) {
        box.focus();
        const end = box.value.length;
        box.setSelectionRange(end, end);
      }
    }
  }

  function post(msg) {
    vscode.postMessage(msg);
  }

  // Ask the host to read the session's settings. `force` is a manual Refresh
  // (always re-reads); the unforced call is the auto-load when the panel opens,
  // which does nothing if values are already in hand or a read is already out.
  function requestConfiguration(force) {
    if (!force && (lastConfig || configLoading)) return;
    configLoading = true;
    configError = '';
    post({ command: 'loadConfiguration' });
    render();
  }

  // A positive result clears itself after a few seconds; a warning stays until
  // dismissed. Both start by cancelling any timer already running for that slot.
  function setPingNotice(tone, message) {
    clearTimeout(pingTimer);
    pingNotice = { tone, message };
    if (tone === 'ok') {
      pingTimer = setTimeout(() => {
        pingNotice = null;
        render();
      }, OK_NOTICE_MS);
    }
    render();
  }
  function setSetNotice(tone, message, scope, key) {
    clearTimeout(setTimer);
    setNotice = { tone, message, scope, key };
    if (tone === 'ok') {
      setTimer = setTimeout(() => {
        setNotice = null;
        render();
      }, OK_NOTICE_MS);
    }
    render();
  }
  function clearNotices() {
    clearTimeout(pingTimer);
    clearTimeout(setTimer);
    pingNotice = null;
    setNotice = null;
  }

  // A case-insensitive substring match on the parameter name. The report runs to
  // ~160 stone parameters, and the word someone reaches for to narrow it is
  // usually in the middle of the name — "cache", "sessions", "timeout" — none of
  // which a prefix match would find (StnGemTimeout does not start with "timeout",
  // SHR_PAGE_CACHE_SIZE_KB does not start with "cache"). Matching anywhere in the
  // key means the obvious word works, at the cost of "Gem" also keeping
  // StnGemTimeout on screen. Done in place so typing never triggers a full
  // re-render (which would drop focus).
  function applyConfigFilter() {
    const needle = configFilter.trim().toLowerCase();
    els.root.querySelectorAll('tr.config-item').forEach((row) => {
      const match = !needle || row.dataset.configKey.includes(needle);
      row.style.display = match ? '' : 'none';
    });
  }

  // Save the value in a row's inline editor. Reads it at click time (not render
  // time) so what the user just typed is what is sent.
  function saveConfig(el) {
    const box = el.closest('.config-edit');
    const input = box && box.querySelector('[data-config-input]');
    if (!input) return;
    configEditing.delete(`${el.dataset.scope}:${el.dataset.key}`);
    configError = '';
    setNotice = null;
    clearTimeout(setTimer);
    post({
      command: 'setConfiguration',
      scope: el.dataset.scope,
      key: el.dataset.key,
      valueType: el.dataset.vtype,
      value: input.value,
    });
    render();
  }

  // Config actions are handled here rather than through a generic post: some are
  // pure view state (open/close an editor, dismiss a result), and Set reads a
  // live input value. Returns true when it consumed the click.
  function onConfigClick(el) {
    const id = `${el.dataset.scope}:${el.dataset.key}`;
    switch (el.dataset.action) {
      case 'editConfig': {
        configEditing.add(id);
        render();
        const input = els.root.querySelector(
          `tr[data-config-scope="${el.dataset.scope}"][data-config-key="${el.dataset.key.toLowerCase()}"] [data-config-input]`,
        );
        if (input) input.focus();
        return true;
      }
      case 'cancelConfig':
        configEditing.delete(id);
        render();
        return true;
      case 'saveConfig':
        saveConfig(el);
        return true;
      case 'loadConfiguration':
        requestConfiguration(true);
        return true;
      case 'ping':
        post({ command: 'ping' });
        return true;
      case 'dismissPing':
        clearTimeout(pingTimer);
        pingNotice = null;
        render();
        return true;
      case 'dismissSet':
        clearTimeout(setTimer);
        setNotice = null;
        render();
        return true;
      case 'copyNotice':
        // Copy through the host — the webview clipboard is not reliably available
        // under the panel's CSP, but vscode.env.clipboard always is.
        post({ command: 'copyText', text: el.dataset.copy || '' });
        return true;
      default:
        return false;
    }
  }

  function onClick(e) {
    // Clicking an ⓘ pins its bubble on screen; a second click closes it. A click
    // anywhere else that is not inside the bubble dismisses a pinned one.
    const info = e.target.closest('[data-config-info]');
    if (info) {
      e.preventDefault();
      toggleInfoPopover(info);
      return;
    }
    if (!e.target.closest('.config-info-pop')) closeInfoPopover();
    const clearFilter = e.target.closest('[data-config-filter-clear]');
    if (clearFilter) {
      e.preventDefault();
      clearConfigFilter();
      return;
    }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    // Prevent an action button inside a <summary> from also toggling the group.
    e.preventDefault();
    onConfigClick(el);
  }

  // Hovering an ⓘ shows the same bubble a click pins — so the two look identical.
  // Hover is suppressed while a bubble is pinned, so moving the pointer does not
  // fight the pinned one.
  function onMouseOver(e) {
    if (infoPinned) return;
    const info = e.target.closest('[data-config-info]');
    if (info && infoAnchor !== info) showInfoPopover(info, false);
  }
  function onMouseOut(e) {
    if (infoPinned) return;
    const info = e.target.closest('[data-config-info]');
    if (!info) return;
    // Ignore movement that stays within the same ⓘ.
    if (e.relatedTarget && info.contains(e.relatedTarget)) return;
    closeInfoPopover();
  }

  // The filter box types into configFilter and re-filters in place — no post,
  // no re-render.
  function onInput(e) {
    const box = e.target.closest('[data-config-filter]');
    if (!box) return;
    configFilter = box.value;
    applyConfigFilter();
    updateFilterClear();
  }

  // Empty the filter in place — same in-place filtering as typing, no post, no
  // re-render — and return focus to the box so typing can continue.
  function clearConfigFilter() {
    configFilter = '';
    const box = els.root.querySelector('[data-config-filter]');
    if (box) {
      box.value = '';
      box.focus();
    }
    applyConfigFilter();
    updateFilterClear();
  }

  // The × shows only when there is text to clear.
  function updateFilterClear() {
    const x = els.root.querySelector('[data-config-filter-clear]');
    if (x) x.hidden = configFilter.trim() === '';
  }

  // The ⓘ bubble: the parameter's type, what you can do with it, and the purpose
  // text from system.conf. The same element serves hover (transient) and click
  // (pinned until dismissed), so both look the same. A redraw, Escape, a click
  // away, a second click on a pinned ⓘ, or a scroll/resize all close it.
  let infoPopover = null;
  let infoAnchor = null;
  let infoPinned = false;
  function closeInfoPopover() {
    if (infoPopover) infoPopover.remove();
    infoPopover = null;
    infoAnchor = null;
    infoPinned = false;
    window.removeEventListener('scroll', closeInfoPopover, true);
    window.removeEventListener('resize', closeInfoPopover);
  }
  function showInfoPopover(anchor, pinned) {
    if (infoPopover) infoPopover.remove();
    const pop = document.createElement('div');
    pop.className = 'config-info-pop';
    pop.setAttribute('role', 'tooltip');
    // textContent (not innerHTML) — the tip is plain text with newlines that
    // `white-space: pre-line` renders as line breaks; nothing here is markup.
    pop.textContent = anchor.dataset.tip || '';
    document.body.appendChild(pop);
    // Anchor under the ⓘ, pulled back inside the viewport if it would overflow.
    const r = anchor.getBoundingClientRect();
    const left = Math.max(6, Math.min(r.left, window.innerWidth - pop.offsetWidth - 6));
    pop.style.left = `${left}px`;
    pop.style.top = `${r.bottom + 4}px`;
    infoPopover = pop;
    infoAnchor = anchor;
    infoPinned = pinned;
    // The bubble is fixed-positioned from the ⓘ's current viewport spot, so a
    // scroll or resize would leave it stranded — close it. Capture phase catches
    // scrolls on any inner scroller too.
    window.addEventListener('scroll', closeInfoPopover, true);
    window.addEventListener('resize', closeInfoPopover);
  }
  function toggleInfoPopover(anchor) {
    if (infoAnchor === anchor && infoPinned) {
      closeInfoPopover();
      return;
    }
    showInfoPopover(anchor, true);
  }
  // A click anywhere outside the ⓘ and its bubble dismisses a pinned bubble.
  function onAwayClick(e) {
    if (!infoPopover || !infoPinned) return;
    if (e.target.closest('[data-config-info]') || e.target.closest('.config-info-pop')) return;
    closeInfoPopover();
  }

  // Enter commits an inline edit, Escape abandons it — the keyboard equivalents
  // of the Set and Cancel buttons beside the input.
  function onKeydown(e) {
    if (e.key === 'Escape' && infoPopover) {
      closeInfoPopover();
      return;
    }
    const input = e.target.closest('[data-config-input]');
    if (!input) return;
    const box = input.closest('.config-edit');
    if (e.key === 'Enter') {
      e.preventDefault();
      const save = box && box.querySelector('[data-action="saveConfig"]');
      if (save) saveConfig(save);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      const cancel = box && box.querySelector('[data-action="cancelConfig"]');
      if (cancel) onConfigClick(cancel);
    }
  }

  function init(refs, api, panelMeta) {
    els = refs;
    vscode = api;
    if (panelMeta) meta = panelMeta;
    // A fresh panel carries no settings — reset the on-demand state so a reopened
    // panel (and each test that inits a new one) starts clean.
    lastConfig = null;
    configError = '';
    configLoading = true;
    configEditing.clear();
    configFilter = '';
    clearNotices();
    configGroupsOpen.clear();
    els.root.addEventListener('click', onClick);
    els.root.addEventListener('input', onInput);
    els.root.addEventListener('keydown', onKeydown);
    els.root.addEventListener('mouseover', onMouseOver);
    els.root.addEventListener('mouseout', onMouseOut);
    // A pinned ⓘ bubble lives on document.body, outside the panel root, so its
    // dismiss-on-click-away has to watch the document, not just the root.
    document.addEventListener('click', onAwayClick, true);
    window.addEventListener('message', onHostMessage);
    // The panel opens straight into a read, so show the working state until the
    // host answers (it reads the settings in reply to the bootstrap's `ready`).
    render();
  }

  // Messages arrive from the extension host, which VS Code relays in from the
  // frame around this one — so `ev.source` is never this window, and testing
  // for that drops every message the panel exists to receive. Declared at module
  // scope so it is a stable reference — re-registering it (init runs once per
  // document in production, once per test in jsdom) is then a no-op.
  function onHostMessage(ev) {
    const msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.command === 'configuration') {
      if (!msg.config || typeof msg.config !== 'object') return;
      lastConfig = msg.config;
      configLoading = false;
      configError = '';
      // A fresh read clears any lingering result; a set that just took sends its
      // setResult right after this message.
      clearNotices();
      configEditing.clear();
      render();
    } else if (msg.command === 'pingResult') {
      setPingNotice(msg.tone === 'warn' ? 'warn' : 'ok', String(msg.message || ''));
    } else if (msg.command === 'setResult') {
      setSetNotice(
        msg.tone === 'warn' ? 'warn' : 'ok',
        String(msg.message || ''),
        msg.scope,
        msg.key,
      );
    } else if (msg.command === 'configurationError') {
      configLoading = false;
      clearNotices();
      configError = String(msg.message || 'The settings could not be read.');
      render();
    }
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.GemstoneConfig = {
    init,
    render,
  };
})();
