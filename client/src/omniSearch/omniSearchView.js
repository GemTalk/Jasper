/**
 * Webview-side behavior for the Omni Search Phase-2 "Spotter" panel (omniSearchPanel.ts).
 *
 * Like listFilter.js / methodListView.js / debuggerView.js, this is read at runtime via
 * fs.readFileSync and injected into the webview as a <script> tag — it is NOT compiled into the
 * bundle. It lives in its own file so the rendering (a flat, relevance-ranked row list with per-row
 * category tags + own-highlighting), keyboard navigation, scope tabs, case indicator, the always-on
 * source-preview pane, and the footer count/load-more can be unit-tested in jsdom (see
 * omniSearchView.test.ts) instead of being trapped inside an inline webview <script> string.
 *
 * The host owns SEARCH (the engine); this script owns the CHROME. It sends the host user intent
 * (`query`, `setScope`, `toggleCase`, `togglePin`, `activate`, `references`, `back`, `loadMore`,
 * `loadAll`, `preview`, `close`) and renders the `config` / `results` / `busy` / `preview` /
 * `pinned` / `error` messages the host pushes back. Rows are addressed by the engine's stable
 * numeric id, echoed verbatim.
 *
 * Exposed as the global `OmniSearchView` so both the webview (classic <script>) and tests
 * (new Function(source)()) can reach `wire`.
 */
(function () {
  // Debounce for the source-preview request as the active row moves (~250ms so arrowing through rows
  // isn't chatty).
  var PREVIEW_DEBOUNCE_MS = 250;

  function wire(doc, vscode) {
    var tabsEl = doc.getElementById('tabs');
    var inputEl = doc.getElementById('query');
    var clearEl = doc.getElementById('clear');
    var caseEl = doc.getElementById('case');
    var pinEl = doc.getElementById('pin');
    var resultsEl = doc.getElementById('results');
    var previewEl = doc.getElementById('preview');
    var countEl = doc.getElementById('count');
    var loadMoreEl = doc.getElementById('loadMore');
    var loadAllEl = doc.getElementById('loadAll');
    var breadcrumbEl = doc.getElementById('breadcrumb');
    var errorEl = doc.getElementById('error');

    // The currently-rendered row elements, in display order — the target of Up/Down navigation.
    // `activeIndex` points into it; -1 = nothing active.
    var rows = [];
    var activeIndex = -1;
    var inPivot = false;
    var previewTimer = null;
    // Mirrors the host's case-sensitivity so the preview-pane highlight matches how the search did.
    var caseSensitive = false;
    // Set when the NEXT results render should scroll the list back to the top — true for a fresh
    // search/clear/scope/case change, false for Load-more (which should keep your place).
    var scrollResetPending = true;

    function post(command, extra) {
      var msg = { command: command };
      if (extra) {
        for (var k in extra) {
          if (Object.prototype.hasOwnProperty.call(extra, k)) msg[k] = extra[k];
        }
      }
      vscode.postMessage(msg);
    }

    // ── Highlighting ────────────────────────────────────────────────
    // Render `label` into `container` with the matched [start,end) ranges wrapped in <mark>. Built
    // from text nodes (never innerHTML) so a class/selector name can't inject markup, and so OUR
    // case-correct ranges are the only highlight (fixing the QuickPick's misleading built-in one).
    function renderLabel(container, label, ranges) {
      var safeRanges = (ranges || [])
        .filter(function (r) {
          return r && r.length === 2 && r[0] < r[1];
        })
        .slice()
        .sort(function (a, b) {
          return a[0] - b[0];
        });
      var pos = 0;
      for (var i = 0; i < safeRanges.length; i++) {
        var s = Math.max(pos, safeRanges[i][0]);
        var e = Math.min(label.length, safeRanges[i][1]);
        if (e <= s) continue;
        if (s > pos) container.appendChild(doc.createTextNode(label.slice(pos, s)));
        var mark = doc.createElement('mark');
        mark.textContent = label.slice(s, e);
        container.appendChild(mark);
        pos = e;
      }
      if (pos < label.length) container.appendChild(doc.createTextNode(label.slice(pos)));
    }

    // ── Tabs (labeled scope buttons — the Phase-2 upgrade over the icon-only title bar) ──
    // Two visually-separated groups: FILTERS (All + the always-on categories, which narrow the live
    // results) and SEARCHES (the explicit-only categories — Source/Literals/Categories — which START
    // a distinct heavyweight search). They behave differently, so a divider + a "Search:" label keeps
    // them from reading as one uniform row of filters (Eric's ask I).
    function makeTab(d, scopeId) {
      var b = doc.createElement('button');
      b.className = 'tab';
      b.textContent = d.label;
      b.setAttribute('role', 'tab');
      if (d.explicitOnly) {
        b.classList.add('explicit');
        // The category's own search hint is the most useful tooltip ("Type text to find inside method
        // source", etc.); fall back to a generic line if none was provided.
        b.title = d.searchHint || 'Search ' + d.label.toLowerCase() + ' — type, then it runs';
      } else if (d.id === null) {
        b.title = 'Search everything';
      } else {
        b.title = 'Filter results to ' + d.label.toLowerCase();
      }
      if ((scopeId || null) === (d.id || null)) {
        b.classList.add('active');
        b.setAttribute('aria-selected', 'true');
      }
      (function (id) {
        b.addEventListener('click', function () {
          scrollResetPending = true;
          post('setScope', { scopeId: id });
          inputEl.focus();
        });
      })(d.id);
      return b;
    }

    function renderTabs(categories, scopeId) {
      tabsEl.textContent = '';
      var cats = categories || [];
      var filters = [{ id: null, label: 'All' }];
      var searches = [];
      for (var i = 0; i < cats.length; i++) {
        (cats[i].explicitOnly ? searches : filters).push(cats[i]);
      }
      for (var f = 0; f < filters.length; f++) tabsEl.appendChild(makeTab(filters[f], scopeId));
      if (searches.length) {
        var sep = doc.createElement('span');
        sep.className = 'tabsep';
        sep.textContent = 'Search:';
        sep.setAttribute('aria-hidden', 'true');
        tabsEl.appendChild(sep);
        for (var s = 0; s < searches.length; s++) tabsEl.appendChild(makeTab(searches[s], scopeId));
      }
    }

    // ── Results ─────────────────────────────────────────────────────
    function clearActive() {
      if (activeIndex >= 0 && rows[activeIndex]) rows[activeIndex].classList.remove('active');
    }

    function setActive(index, scroll) {
      if (rows.length === 0) {
        activeIndex = -1;
        return;
      }
      clearActive();
      activeIndex = Math.max(0, Math.min(rows.length - 1, index));
      var el = rows[activeIndex];
      el.classList.add('active');
      if (scroll !== false && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
      requestPreview();
    }

    function activeRowId() {
      if (activeIndex < 0 || !rows[activeIndex]) return null;
      var raw = rows[activeIndex].getAttribute('data-id');
      return raw === null ? null : Number(raw);
    }

    function requestPreview() {
      if (previewTimer) clearTimeout(previewTimer);
      var id = activeRowId();
      if (id === null) return;
      previewTimer = setTimeout(function () {
        post('preview', { id: id });
      }, PREVIEW_DEBOUNCE_MS);
    }

    function renderResults(view) {
      resultsEl.textContent = '';
      rows = [];
      inPivot = !!view.pivot;
      // Flat, globally relevance-ranked list — no category grouping/dividers; each row wears a small
      // category tag instead so you still see what it is.
      var viewRows = view.rows || [];
      for (var r = 0; r < viewRows.length; r++) {
        resultsEl.appendChild(makeRow(viewRows[r]));
      }
      // A fresh search/clear/scope change scrolls back to the top; Load-more keeps your place.
      if (scrollResetPending) resultsEl.scrollTop = 0;
      scrollResetPending = false;
      // Restore a sensible active row (first result) whenever the list changes.
      if (rows.length > 0) setActive(0, false);
      else {
        activeIndex = -1;
        clearPreview();
      }
      updateFooter(view);
    }

    function makeRow(row) {
      var li = doc.createElement('li');
      li.className = 'row';
      li.setAttribute('data-id', String(row.id));

      var label = doc.createElement('span');
      label.className = 'label';
      renderLabel(label, row.label, row.ranges);
      li.appendChild(label);

      if (row.categoryLabel) {
        var cat = doc.createElement('span');
        cat.className = 'cat';
        cat.textContent = row.categoryLabel;
        li.appendChild(cat);
      }

      if (row.description) {
        var desc = doc.createElement('span');
        desc.className = 'desc';
        desc.textContent = row.description;
        li.appendChild(desc);
      }

      if (row.referenceable) {
        var ref = doc.createElement('button');
        ref.className = 'refbtn';
        ref.textContent = '↗';
        ref.title = row.referenceTitle || 'Find references';
        ref.setAttribute('aria-label', row.referenceTitle || 'Find references');
        (function (id) {
          ref.addEventListener('click', function (ev) {
            ev.stopPropagation();
            scrollResetPending = true;
            post('references', { id: id });
          });
        })(row.id);
        li.appendChild(ref);
      }

      var idx = rows.length;
      li.addEventListener('click', function () {
        setActive(idx);
      });
      li.addEventListener('dblclick', function () {
        post('activate', { id: row.id, side: false });
      });
      rows.push(li);
      return li;
    }

    // ── Footer (count + elegant load controls — replaces the two synthetic list rows) ──
    function updateFooter(view) {
      var n = view.shownCount || 0;
      var text;
      if (n === 0) text = inPivot ? 'No references' : '';
      else if (view.exact) text = n + (n === 1 ? ' result' : ' results');
      else if (view.hasMore) text = n + '+ shown';
      else text = n + (n === 1 ? ' result' : ' results');
      countEl.textContent = text;
      var showLoad = !!view.hasMore && !view.exact;
      loadMoreEl.style.display = showLoad ? '' : 'none';
      loadAllEl.style.display = showLoad ? '' : 'none';
    }

    function clearPreview() {
      previewEl.textContent = '';
      previewEl.classList.remove('has-content');
    }

    // ── Inbound host messages ───────────────────────────────────────
    function onMessage(event) {
      var msg = event.data || {};
      switch (msg.command) {
        case 'config':
          renderTabs(msg.categories, msg.scopeId);
          setCase(msg.caseSensitive);
          setPin(msg.pinned);
          updateClearVisibility();
          if (typeof msg.placeholder === 'string') inputEl.placeholder = msg.placeholder;
          break;
        case 'results':
          setError('');
          renderTabs(msg.categories, msg.scopeId);
          setCase(msg.caseSensitive);
          setPin(msg.pinned);
          updateClearVisibility();
          if (typeof msg.placeholder === 'string') inputEl.placeholder = msg.placeholder;
          setBreadcrumb(msg.pivot ? msg.pivotTitle : '');
          renderResults(msg);
          setBusy(false);
          break;
        case 'pinned':
          setPin(msg.pinned);
          break;
        case 'busy':
          setBusy(!!msg.on);
          break;
        case 'preview':
          // Ignore a stale preview for a row that is no longer active.
          if (msg.id === activeRowId()) showPreview(msg.source, msg.title);
          break;
        case 'error':
          setError(msg.message || '');
          setBusy(false);
          break;
        case 'focusInput':
          inputEl.focus();
          inputEl.select();
          break;
      }
    }

    // Fill `container` with `text`, wrapping every occurrence of `term` in <mark> (built from text
    // nodes, never innerHTML). Returns the first mark element (for scroll-into-view) or null — so the
    // preview SHOWS WHERE the query matched (e.g. a Source search for "foo").
    function highlightOccurrences(container, text, term, caseSens) {
      if (!term) {
        container.appendChild(doc.createTextNode(text));
        return null;
      }
      var hay = caseSens ? text : text.toLowerCase();
      var needle = caseSens ? term : term.toLowerCase();
      var first = null;
      var pos = 0;
      var at = hay.indexOf(needle, pos);
      if (at < 0) {
        container.appendChild(doc.createTextNode(text));
        return null;
      }
      while (at >= 0) {
        if (at > pos) container.appendChild(doc.createTextNode(text.slice(pos, at)));
        var mark = doc.createElement('mark');
        mark.textContent = text.slice(at, at + needle.length);
        container.appendChild(mark);
        if (!first) first = mark;
        pos = at + needle.length;
        at = hay.indexOf(needle, pos);
      }
      if (pos < text.length) container.appendChild(doc.createTextNode(text.slice(pos)));
      return first;
    }

    function showPreview(source, title) {
      previewEl.textContent = '';
      if (!source) {
        clearPreview();
        return;
      }
      if (title) {
        var h = doc.createElement('div');
        h.className = 'preview-title';
        h.textContent = title;
        previewEl.appendChild(h);
      }
      var pre = doc.createElement('pre');
      pre.className = 'preview-src';
      var firstHit = highlightOccurrences(pre, source, inputEl.value.trim(), caseSensitive);
      previewEl.appendChild(pre);
      previewEl.classList.add('has-content');
      // Bring the first match into view so a Source hit deep in a long method is visible without
      // hunting; fall back to the top when there's no match.
      if (firstHit && firstHit.scrollIntoView) firstHit.scrollIntoView({ block: 'center' });
      else previewEl.scrollTop = 0;
    }

    function setBusy(on) {
      if (on) doc.body.classList.add('busy');
      else doc.body.classList.remove('busy');
    }

    function setError(message) {
      if (!errorEl) return;
      errorEl.textContent = message || '';
      errorEl.style.display = message ? '' : 'none';
    }

    function setBreadcrumb(title) {
      if (!breadcrumbEl) return;
      breadcrumbEl.textContent = title || '';
      breadcrumbEl.style.display = title ? '' : 'none';
    }

    function setCase(on) {
      caseSensitive = !!on;
      if (on) caseEl.classList.add('active');
      else caseEl.classList.remove('active');
      caseEl.setAttribute('aria-pressed', on ? 'true' : 'false');
      caseEl.title = on ? 'Case-sensitive matching: ON' : 'Case-sensitive matching: OFF';
    }

    function setPin(on) {
      if (!pinEl) return;
      if (on) pinEl.classList.add('active');
      else pinEl.classList.remove('active');
      pinEl.setAttribute('aria-pressed', on ? 'true' : 'false');
      pinEl.title = on
        ? 'Pinned open — click to let it close on focus-out'
        : 'Keep Omni Search open (pin to a tab)';
    }

    function updateClearVisibility() {
      if (clearEl) clearEl.style.display = inputEl.value.length ? '' : 'none';
    }

    // ── Input + keyboard ────────────────────────────────────────────
    inputEl.addEventListener('input', function () {
      setBusy(true);
      scrollResetPending = true; // a new query starts the list at the top
      updateClearVisibility();
      post('query', { value: inputEl.value });
    });

    inputEl.addEventListener('keydown', function (ev) {
      switch (ev.key) {
        case 'ArrowDown':
          ev.preventDefault();
          setActive(activeIndex + 1);
          break;
        case 'ArrowUp':
          ev.preventDefault();
          setActive(activeIndex - 1);
          break;
        case 'Enter': {
          var id = activeRowId();
          if (id === null) break;
          ev.preventDefault();
          // Ctrl/Cmd+Enter opens beside (keeps the Spotter visible); Alt+Enter pivots to references.
          if (ev.altKey) post('references', { id: id });
          else post('activate', { id: id, side: ev.ctrlKey || ev.metaKey });
          break;
        }
        case 'ArrowLeft':
          // Only steal Left as "back" when pivoted AND the caret is at the field start, so normal
          // cursor movement inside the query is undisturbed.
          if (inPivot && inputEl.selectionStart === 0 && inputEl.selectionEnd === 0) {
            ev.preventDefault();
            scrollResetPending = true;
            post('back');
          }
          break;
        case 'Escape':
          ev.preventDefault();
          if (inPivot) {
            scrollResetPending = true;
            post('back');
          } else post('close');
          break;
      }
    });

    if (clearEl) {
      clearEl.addEventListener('click', function () {
        inputEl.value = '';
        scrollResetPending = true;
        updateClearVisibility();
        post('query', { value: '' });
        inputEl.focus();
      });
    }

    caseEl.addEventListener('click', function () {
      scrollResetPending = true;
      post('toggleCase');
      inputEl.focus();
    });

    if (pinEl) {
      pinEl.addEventListener('click', function () {
        post('togglePin');
        inputEl.focus();
      });
    }

    if (loadMoreEl) {
      loadMoreEl.addEventListener('click', function () {
        post('loadMore');
        inputEl.focus();
      });
    }
    if (loadAllEl) {
      loadAllEl.addEventListener('click', function () {
        post('loadAll');
        inputEl.focus();
      });
    }

    doc.defaultView.addEventListener('message', onMessage);

    post('ready');
    inputEl.focus();

    return {
      // Exposed for tests.
      renderResults: renderResults,
      renderTabs: renderTabs,
      onMessage: onMessage,
      setActive: setActive,
      activeRowId: activeRowId,
      rowCount: function () {
        return rows.length;
      },
    };
  }

  var root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.OmniSearchView = { wire: wire };

  // In the live webview, bootstrap against the real vscode API. In tests, acquireVsCodeApi is
  // undefined, so the module just exposes `wire`.
  if (typeof acquireVsCodeApi === 'function') {
    wire(document, acquireVsCodeApi());
  }
})();
