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
    var previewToggleEl = doc.getElementById('previewToggle');
    var scopeFilterEl = doc.getElementById('scopeFilter');
    var scopeFilterMenuEl = doc.getElementById('scopeFilterMenu');

    // The currently-rendered row elements, in display order — the target of Up/Down navigation.
    // `activeIndex` points into it; -1 = nothing active.
    var rows = [];
    var activeIndex = -1;
    var inPivot = false;
    var previewTimer = null;
    // When true, the references/senders gesture fills the preview pane with a sticky list (instead of
    // pivoting the left list). Pushed from the host config; false = the classic pivot.
    var referencesInPreview = false;
    // Plain-text label for the references gesture, per platform (Alt+Enter, or ⌥↩ on macOS). Pushed
    // from the host config message; the non-mac default covers the brief window before it arrives.
    var referencesKeyHint = 'Alt+Enter';
    // What the preview pane is currently showing: 'source' (of the active left row) or 'refs' (the
    // sticky references list). A new search or a new left-row selection returns it to 'source'.
    var previewMode = 'source';
    // The symbol the current references list is OF (selector / class name), highlighted in a sender's
    // source when a row is expanded inline.
    var refHighlightTerm = '';
    // Mirrors the host's case-sensitivity so the preview-pane highlight matches how the search did.
    var caseSensitive = false;
    // Set when the NEXT results render should scroll the list back to the top — true for a fresh
    // search/clear/scope/case change, false for Load-more (which should keep your place).
    var scrollResetPending = true;
    // Whether the source-preview pane is shown. The pane costs the result list ~45% of its width,
    // which the bottom-docked panel (wide but short) can least afford. Seeded from the host config,
    // then owned here for the session — the host is never told, because hiding a pane has no effect
    // on the search. Turning it OFF also stops the per-row preview round-trips.
    var previewEnabled = true;
    // Categories the user is holding back from the "All" fan-out (ids). Mirrors the engine's own set;
    // the engine remains the authority — every results message refreshes this from it.
    var excludedFromAll = [];
    // The category descriptors last pushed by the host, for rebuilding the scope-filter menu.
    var tabCategories = [];

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
      // A new left-row selection dismisses a sticky references list — the pane goes back to source.
      previewMode = 'source';
      requestPreview();
    }

    function activeRowId() {
      if (activeIndex < 0 || !rows[activeIndex]) return null;
      var raw = rows[activeIndex].getAttribute('data-id');
      return raw === null ? null : Number(raw);
    }

    function requestPreview() {
      if (previewTimer) clearTimeout(previewTimer);
      // Pane off: don't ask the host for source nobody will see. This is the "lighter mode" half of
      // the toggle — arrowing down a long list stops costing a preview round-trip per row.
      if (!previewEnabled) return;
      var id = activeRowId();
      if (id === null) return;
      previewTimer = setTimeout(function () {
        post('preview', { id: id });
      }, PREVIEW_DEBOUNCE_MS);
    }

    // References/senders of a row. In referencesInPreview mode the host replies with a `refPreview`
    // that fills the preview pane (leaving the left list alone); otherwise it's the classic list pivot.
    function requestReferences(id) {
      if (referencesInPreview) {
        post('referencesInline', { id: id });
      } else {
        scrollResetPending = true;
        post('references', { id: id });
      }
    }

    function renderResults(view) {
      resultsEl.textContent = '';
      rows = [];
      inPivot = !!view.pivot;
      if (typeof view.referencesInPreview === 'boolean')
        referencesInPreview = view.referencesInPreview;
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
        var refLabel = (row.referenceTitle || 'Find references') + ' (' + referencesKeyHint + ')';
        ref.title = refLabel;
        ref.setAttribute('aria-label', refLabel);
        (function (id) {
          ref.addEventListener('click', function (ev) {
            ev.stopPropagation();
            requestReferences(id);
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
      previewMode = 'source';
      previewEl.textContent = '';
      previewEl.classList.remove('has-content');
    }

    // ── Preview-pane toggle (#40) ───────────────────────────────────
    // Purely a chrome concern — the host is never told. Off hides the pane (so the result list gets
    // the whole width) AND stops the per-row source requests; on re-fills it for the active row.
    function setPreviewEnabled(on) {
      previewEnabled = !!on;
      if (previewEnabled) doc.body.classList.remove('no-preview');
      else doc.body.classList.add('no-preview');
      if (previewToggleEl) {
        if (previewEnabled) previewToggleEl.classList.add('active');
        else previewToggleEl.classList.remove('active');
        previewToggleEl.setAttribute('aria-pressed', previewEnabled ? 'true' : 'false');
        previewToggleEl.title = previewEnabled
          ? 'Source preview: ON — click to give the width back to the results'
          : 'Source preview: OFF — click to show the preview pane';
      }
      if (!previewEnabled) {
        // Drop any in-flight request so a late reply can't repopulate a hidden pane.
        if (previewTimer) {
          clearTimeout(previewTimer);
          previewTimer = null;
        }
        clearPreview();
      } else {
        requestPreview();
      }
    }

    // ── Scope filter: which scopes "All" runs (#41) ─────────────────
    // Only the ordinary categories are offered: the explicit-only ones (Source/Literals/Categories)
    // are already outside "All" permanently, so listing them would suggest a choice that isn't one.
    function excludableCategories() {
      var out = [];
      for (var i = 0; i < tabCategories.length; i++) {
        if (!tabCategories[i].explicitOnly) out.push(tabCategories[i]);
      }
      return out;
    }

    function isExcluded(id) {
      return excludedFromAll.indexOf(id) >= 0;
    }

    function renderScopeFilter() {
      if (!scopeFilterMenuEl) return;
      scopeFilterMenuEl.textContent = '';
      var cats = excludableCategories();
      var title = doc.createElement('div');
      title.className = 'scope-opt-title';
      title.textContent = 'Scopes included in All';
      scopeFilterMenuEl.appendChild(title);
      for (var i = 0; i < cats.length; i++) {
        scopeFilterMenuEl.appendChild(makeScopeOption(cats[i]));
      }
      // The button reads "active" whenever something is held back, so a narrowed All is visible
      // without opening the menu — otherwise a missing category looks like a search bug.
      if (scopeFilterEl) {
        var narrowed = excludedFromAll.length > 0;
        if (narrowed) scopeFilterEl.classList.add('active');
        else scopeFilterEl.classList.remove('active');
        scopeFilterEl.title = narrowed
          ? 'All is narrowed — ' + excludedFromAll.length + ' scope(s) left out. Click to change.'
          : 'Choose which scopes the All search runs';
      }
    }

    function makeScopeOption(cat) {
      var included = !isExcluded(cat.id);
      var b = doc.createElement('button');
      b.className = 'scope-opt' + (included ? '' : ' off');
      b.setAttribute('role', 'menuitemcheckbox');
      b.setAttribute('aria-checked', included ? 'true' : 'false');
      b.setAttribute('data-scope-id', cat.id);

      var box = doc.createElement('span');
      box.className = 'box';
      box.textContent = included ? '✓' : ' ';
      b.appendChild(box);

      var label = doc.createElement('span');
      label.textContent = cat.label;
      b.appendChild(label);

      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        toggleScopeExclusion(cat.id);
      });
      return b;
    }

    function toggleScopeExclusion(id) {
      var next = [];
      var found = false;
      for (var i = 0; i < excludedFromAll.length; i++) {
        if (excludedFromAll[i] === id) found = true;
        else next.push(excludedFromAll[i]);
      }
      if (!found) next.push(id);
      excludedFromAll = next;
      renderScopeFilter(); // repaint immediately; the host's reply confirms it
      scrollResetPending = true;
      post('setExcludedFromAll', { excludedFromAll: excludedFromAll });
    }

    function setScopeMenuOpen(open) {
      if (!scopeFilterMenuEl || !scopeFilterEl) return;
      if (open) {
        renderScopeFilter();
        scopeFilterMenuEl.removeAttribute('hidden');
      } else {
        scopeFilterMenuEl.setAttribute('hidden', '');
      }
      scopeFilterEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function scopeMenuOpen() {
      return !!scopeFilterMenuEl && !scopeFilterMenuEl.hasAttribute('hidden');
    }

    // ── Inbound host messages ───────────────────────────────────────
    function onMessage(event) {
      var msg = event.data || {};
      switch (msg.command) {
        case 'config':
          if (typeof msg.referencesInPreview === 'boolean')
            referencesInPreview = msg.referencesInPreview;
          if (typeof msg.keyHint === 'string') referencesKeyHint = msg.keyHint;
          // Starting values for the two Round-6 controls. `previewPane` arrives ONLY here: after
          // this the toggle is the webview's own, so results messages must not carry (and undo) it.
          if (typeof msg.previewPane === 'boolean') setPreviewEnabled(msg.previewPane);
          if (Array.isArray(msg.excludedFromAll)) excludedFromAll = msg.excludedFromAll.slice();
          tabCategories = msg.categories || [];
          renderTabs(msg.categories, msg.scopeId);
          renderScopeFilter();
          setCase(msg.caseSensitive);
          setPin(msg.pinned);
          updateClearVisibility();
          if (typeof msg.placeholder === 'string') inputEl.placeholder = msg.placeholder;
          break;
        case 'results':
          setError('');
          if (Array.isArray(msg.excludedFromAll)) excludedFromAll = msg.excludedFromAll.slice();
          tabCategories = msg.categories || [];
          renderTabs(msg.categories, msg.scopeId);
          renderScopeFilter();
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
          // Ignore a stale preview for a row that's no longer active, or one that arrives while the
          // pane is showing a sticky references list (referencesInPreview mode).
          if (previewMode === 'source' && msg.id === activeRowId())
            showPreview(msg.source, msg.title);
          break;
        case 'refPreview':
          // Fill the preview pane with the row's references/senders — but only if that row is still
          // the active one (a fast re-selection could have superseded the request).
          if (msg.forId === activeRowId()) showRefPreview(msg.title, msg.rows, msg.highlightTerm);
          break;
        case 'referenceSource':
          // Inline source for an expanded reference row.
          fillReferenceSource(msg.refId, msg.source);
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

    // Render the sticky references/senders list into the preview pane (referencesInPreview mode). The
    // left search list is untouched; a row expands inline to show its source (Ctrl+Enter / double-
    // click opens it in a real editor).
    function showRefPreview(title, refRows, highlightTerm) {
      if (previewTimer) {
        clearTimeout(previewTimer);
        previewTimer = null;
      }
      // The references list lives in this pane, so asking for references while the pane is hidden
      // would be a gesture with no visible result. Treat the request as intent to see the pane and
      // switch it back on (the toggle updates, so it doesn't look like a glitch).
      if (!previewEnabled) setPreviewEnabled(true);
      previewMode = 'refs';
      refHighlightTerm = highlightTerm || '';
      previewEl.textContent = '';
      if (title) {
        var h = doc.createElement('div');
        h.className = 'preview-title';
        h.textContent = title;
        previewEl.appendChild(h);
      }
      var list = refRows || [];
      if (list.length === 0) {
        var empty = doc.createElement('div');
        empty.className = 'preview-empty';
        empty.textContent = 'No references';
        previewEl.appendChild(empty);
      } else {
        var ul = doc.createElement('ul');
        ul.className = 'preview-list';
        for (var i = 0; i < list.length; i++) ul.appendChild(makeRefRow(list[i]));
        previewEl.appendChild(ul);
      }
      previewEl.classList.add('has-content');
      previewEl.scrollTop = 0;
    }

    function makeRefRow(row) {
      var item = doc.createElement('li');
      item.className = 'preview-ref-item';

      var header = doc.createElement('div');
      header.className = 'preview-ref';
      header.setAttribute('data-ref-id', String(row.id));
      header.setAttribute('tabindex', '0'); // focusable so Tab from the field can dive into the list

      var twisty = doc.createElement('span');
      twisty.className = 'twisty';
      twisty.textContent = '▶'; // ▶ collapsed
      header.appendChild(twisty);

      var label = doc.createElement('span');
      label.className = 'label';
      renderLabel(label, row.label, row.ranges);
      header.appendChild(label);

      if (row.description) {
        var desc = doc.createElement('span');
        desc.className = 'desc';
        desc.textContent = row.description;
        header.appendChild(desc);
      }

      var src = doc.createElement('pre');
      src.className = 'preview-ref-src';
      src.style.display = 'none';

      item.appendChild(header);
      item.appendChild(src);

      (function (refId) {
        // Click toggles the inline source (EI Meta-tab feel); double-click opens a real editor.
        header.addEventListener('click', function () {
          toggleExpand(refId);
        });
        header.addEventListener('dblclick', function () {
          post('openReference', { refId: refId });
        });
      })(row.id);
      return item;
    }

    function refItems() {
      return previewEl.querySelectorAll('.preview-ref');
    }

    function refHeaderFor(refId) {
      return previewEl.querySelector('.preview-ref[data-ref-id="' + refId + '"]');
    }

    // Expand/collapse a reference row's inline source, lazily asking the host for it the first time.
    function toggleExpand(refId) {
      var header = refHeaderFor(refId);
      if (!header) return;
      var src = header.parentNode.querySelector('.preview-ref-src');
      var twisty = header.querySelector('.twisty');
      if (src.style.display === 'none') {
        src.style.display = '';
        if (twisty) twisty.textContent = '▼'; // ▼ expanded
        if (!src.getAttribute('data-loaded')) {
          src.textContent = '…';
          post('previewReference', { refId: refId });
        }
      } else {
        src.style.display = 'none';
        if (twisty) twisty.textContent = '▶';
      }
    }

    // Fill an expanded row's source (host reply), highlighting the symbol the list is references OF.
    function fillReferenceSource(refId, source) {
      var header = refHeaderFor(refId);
      if (!header) return;
      var src = header.parentNode.querySelector('.preview-ref-src');
      src.textContent = '';
      highlightOccurrences(src, source || '', refHighlightTerm, caseSensitive);
      src.setAttribute('data-loaded', '1');
    }

    // Keyboard handling while a reference row has focus: arrow through the list, open the focused one,
    // and hand focus back to the search field at the top / on Escape / on Shift+Tab.
    function handleRefKey(ev) {
      var items = refItems();
      if (!items.length) return;
      var cur = -1;
      for (var i = 0; i < items.length; i++) {
        if (items[i] === ev.target) {
          cur = i;
          break;
        }
      }
      switch (ev.key) {
        case 'ArrowDown':
          ev.preventDefault();
          items[Math.min(items.length - 1, cur + 1)].focus();
          break;
        case 'ArrowUp':
          ev.preventDefault();
          if (cur <= 0) inputEl.focus();
          else items[cur - 1].focus();
          break;
        case 'ArrowLeft':
          // Left is "back to the results": return to the search field, where Up/Down drive the left
          // list. The refs list stays visible until a new selection/typing dismisses it.
          ev.preventDefault();
          inputEl.focus();
          break;
        case 'Enter':
        case ' ':
        case 'Spacebar': {
          // Enter/Space toggles the inline source; Ctrl/Cmd+Enter opens it in a real editor instead.
          ev.preventDefault();
          var rid = Number(ev.target.getAttribute('data-ref-id'));
          if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))
            post('openReference', { refId: rid });
          else toggleExpand(rid);
          break;
        }
        case 'Escape':
          ev.preventDefault();
          inputEl.focus(); // back to the field, list left open
          break;
        case 'Tab':
          if (ev.shiftKey) {
            ev.preventDefault();
            inputEl.focus();
          }
          break;
      }
    }

    function showPreview(source, title) {
      previewMode = 'source';
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
      previewMode = 'source'; // typing dismisses a sticky references list
      updateClearVisibility();
      post('query', { value: inputEl.value });
    });

    // Bound to the whole document, NOT just the search field: in a WebviewView the field's focus is
    // easily lost (clicking Load More, the case chip, a row, or opening a result), and a handler tied
    // to the input would then go silent while the mouse-driven buttons kept working. At the document
    // level the shortcuts fire whenever the panel has focus, wherever it sits.
    doc.addEventListener('keydown', function (ev) {
      // An open scope menu takes Escape first: closing the menu must not also close the panel (or,
      // in the docked host, throw focus back to the editor) — one Escape, one dismissal.
      if (ev.key === 'Escape' && scopeMenuOpen()) {
        ev.preventDefault();
        setScopeMenuOpen(false);
        inputEl.focus();
        return;
      }
      // While the references list is open: keys land on it, and Tab from the field dives into it
      // (rather than tabbing to the clear/case buttons).
      if (previewMode === 'refs' && previewEl.contains(ev.target)) {
        handleRefKey(ev);
        return;
      }
      if (ev.key === 'Tab' && !ev.shiftKey && previewMode === 'refs' && ev.target === inputEl) {
        var firstRef = refItems()[0];
        if (firstRef) {
          ev.preventDefault();
          firstRef.focus();
        }
        return;
      }
      var onButton = ev.target && ev.target.tagName === 'BUTTON';
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
          // A plain Enter on a focused button is its own click (Load More, case, pin…) — leave it be.
          if (onButton && !ev.altKey && !ev.ctrlKey && !ev.metaKey) break;
          var id = activeRowId();
          if (id === null) break;
          ev.preventDefault();
          // Ctrl/Cmd+Enter opens beside (keeps the Spotter visible); Alt+Enter shows references (in
          // the preview pane, or — flag off — as the classic list pivot).
          if (ev.altKey) requestReferences(id);
          else post('activate', { id: id, side: ev.ctrlKey || ev.metaKey });
          break;
        }
        case 'ArrowLeft':
          // Only steal Left as "back" when pivoted AND the caret is at the field start, so normal
          // cursor movement inside the query is undisturbed (field-focused only).
          if (
            inPivot &&
            doc.activeElement === inputEl &&
            inputEl.selectionStart === 0 &&
            inputEl.selectionEnd === 0
          ) {
            ev.preventDefault();
            scrollResetPending = true;
            post('back');
          }
          break;
        case 'ArrowRight':
          // Right dives into an open references list (mirror of Left, which comes back). Only when the
          // caret is at the END of the field, so normal in-field cursor movement is undisturbed.
          if (
            previewMode === 'refs' &&
            ev.target === inputEl &&
            inputEl.selectionStart === inputEl.value.length &&
            inputEl.selectionEnd === inputEl.value.length
          ) {
            var firstOnRight = refItems()[0];
            if (firstOnRight) {
              ev.preventDefault();
              firstOnRight.focus();
            }
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

    if (previewToggleEl) {
      previewToggleEl.addEventListener('click', function () {
        setPreviewEnabled(!previewEnabled);
        inputEl.focus();
      });
    }

    if (scopeFilterEl) {
      scopeFilterEl.addEventListener('click', function (ev) {
        ev.stopPropagation(); // else the document handler below closes it in the same click
        setScopeMenuOpen(!scopeMenuOpen());
      });
    }

    // Click anywhere else dismisses the scope menu (standard menu behaviour; the menu's own clicks
    // stop propagation so toggling several scopes in a row keeps it open).
    doc.addEventListener('click', function (ev) {
      if (!scopeMenuOpen()) return;
      if (scopeFilterMenuEl && scopeFilterMenuEl.contains(ev.target)) return;
      setScopeMenuOpen(false);
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
      // Round-6 controls (#40 preview toggle / #41 All-scope filter).
      setPreviewEnabled: setPreviewEnabled,
      previewEnabled: function () {
        return previewEnabled;
      },
      setScopeMenuOpen: setScopeMenuOpen,
      scopeMenuOpen: scopeMenuOpen,
      excludedFromAll: function () {
        return excludedFromAll.slice();
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
