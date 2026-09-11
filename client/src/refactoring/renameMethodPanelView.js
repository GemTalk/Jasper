/**
 * Webview-side behavior for the PAGINATED preview panels.
 *
 * Written for the rename-method panel (renameMethodPanel.ts) and SHARED verbatim by
 * the undo-a-refactoring panel (undoRefactoringPanel.ts, #434), whose DOM contract is
 * identical: same element ids, same `apply` / `loadMore` / `loadAll` / `cancel`
 * messages. Keep it panel-agnostic — anything specific to one panel belongs in that
 * panel's HTML, not here. (The global name below stays `RenameMethodPanel` for the
 * same reason it always was: renaming it would break every existing caller for no
 * behavioural gain.)
 *
 * Read at runtime and injected as a <script> tag (NOT bundled) so the checkbox
 * bookkeeping, diff toggle, pagination, and apply dispatch can be unit-tested in
 * jsdom (see renameMethodPanel.test.ts).
 *
 * The panel shows the first page of changes; "More" / "Load all" ask the host for
 * further pages, which arrive as an `appendChanges` message and are appended.
 * All changes start selected; APPLY reports only the DESELECTED (unchecked) ids —
 * so unloaded changes are applied by default (the server applies all-except).
 *
 * Exposed as the global `RenameMethodPanel` so the webview and tests reach `wire`.
 */
(function () {
  function wire(doc, vscode) {
    const applyBtn = doc.getElementById('apply');
    const cancelBtn = doc.getElementById('cancel');
    const countEl = doc.getElementById('count');
    const selCountEl = doc.getElementById('selcount');
    const toggleAllBtn = doc.getElementById('toggleAll');
    const moreBtn = doc.getElementById('more');
    const loadAllBtn = doc.getElementById('loadAll');
    const pager = doc.getElementById('pager');
    const pagerStatus = doc.getElementById('pagerStatus');
    const list = doc.querySelector('ul.changes');
    const total = parseInt((doc.body && doc.body.getAttribute('data-total')) || '0', 10);

    // Applying is one-shot: a second dispatch would apply the whole change set again. The
    // host guards this too; disabling Apply keeps the UI honest about the in-flight apply.
    // `refresh` folds this in so a later checkbox change can't re-enable the button.
    let applying = false;

    const cards = function () {
      return Array.prototype.slice.call(doc.querySelectorAll('li.change'));
    };
    const deselectedIds = function () {
      return cards()
        .filter(function (li) {
          const cb = li.querySelector('.sel');
          return cb && !cb.checked;
        })
        .map(function (li) {
          return li.getAttribute('data-id');
        })
        .filter(function (id) {
          return id !== null;
        });
    };

    const setExpanded = function (li, expanded) {
      const pre = li.querySelector('pre.diff');
      const btn = li.querySelector('.toggle');
      if (pre) pre.classList.toggle('hidden', !expanded);
      if (btn) {
        btn.textContent = expanded ? '▾' : '▸';
        btn.setAttribute('aria-expanded', String(expanded));
      }
    };
    const isExpanded = function (li) {
      const pre = li.querySelector('pre.diff');
      return !!pre && !pre.classList.contains('hidden');
    };

    const refresh = function () {
      const selected = total - deselectedIds().length;
      if (countEl) countEl.textContent = String(selected);
      if (selCountEl) selCountEl.textContent = String(selected);
      if (applyBtn) applyBtn.disabled = applying || selected <= 0;
      cards().forEach(function (li) {
        const cb = li.querySelector('.sel');
        if (cb) li.classList.toggle('deselected', !cb.checked);
      });
    };
    const setApplying = function (busy) {
      applying = busy;
      refresh();
    };

    // Wire cards that haven't been wired yet (idempotent — safe after appends).
    const wireCards = function () {
      cards().forEach(function (li) {
        if (li.getAttribute('data-wired') === '1') return;
        li.setAttribute('data-wired', '1');
        const cb = li.querySelector('.sel');
        if (cb) cb.addEventListener('change', refresh);
        const head = li.querySelector('.change-head');
        if (head) {
          head.addEventListener('click', function (event) {
            if (event.target && event.target.classList && event.target.classList.contains('sel'))
              return;
            setExpanded(li, !isExpanded(li));
            syncToggleAll();
          });
        }
      });
    };

    const syncToggleAll = function () {
      if (!toggleAllBtn) return;
      const all = cards();
      const allExpanded = all.length > 0 && all.every(isExpanded);
      toggleAllBtn.textContent = allExpanded ? 'Collapse all' : 'Expand all';
      toggleAllBtn.setAttribute('aria-expanded', String(allExpanded));
    };
    if (toggleAllBtn) {
      toggleAllBtn.addEventListener('click', function () {
        const expand = !cards().every(isExpanded);
        cards().forEach(function (li) {
          setExpanded(li, expand);
        });
        syncToggleAll();
      });
    }

    const updatePager = function (done) {
      if (pagerStatus) pagerStatus.textContent = cards().length + ' of ' + total + ' loaded';
      if (pager && done) pager.classList.add('hidden');
    };
    const setBusy = function (busy) {
      if (moreBtn) moreBtn.disabled = busy;
      if (loadAllBtn) loadAllBtn.disabled = busy;
    };

    if (moreBtn) {
      moreBtn.addEventListener('click', function () {
        setBusy(true);
        vscode.postMessage({ command: 'loadMore' });
      });
    }
    if (loadAllBtn) {
      loadAllBtn.addEventListener('click', function () {
        setBusy(true);
        vscode.postMessage({ command: 'loadAll' });
      });
    }

    // Optional skipped-methods "Show/Hide" toggle.
    const showSkippedBtn = doc.getElementById('showSkipped');
    const skippedList = doc.getElementById('skippedList');
    if (showSkippedBtn && skippedList) {
      showSkippedBtn.addEventListener('click', function () {
        const hidden = skippedList.classList.toggle('hidden');
        showSkippedBtn.textContent = hidden ? 'Show' : 'Hide';
        showSkippedBtn.setAttribute('aria-expanded', String(!hidden));
      });
    }

    if (applyBtn) {
      applyBtn.addEventListener('click', function () {
        if (applying) return;
        setApplying(true);
        var msg = { command: 'apply', deselected: deselectedIds() };
        // Panels may add apply-time option checkboxes (class "apply-option", a data-opt
        // key). Collect them only when present, so panels without options send the exact
        // same message shape as before.
        var optEls = doc.querySelectorAll('input.apply-option[data-opt]');
        if (optEls.length) {
          var options = {};
          Array.prototype.slice.call(optEls).forEach(function (cb) {
            options[cb.getAttribute('data-opt')] = cb.checked;
          });
          msg.options = options;
        }
        vscode.postMessage(msg);
      });
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        vscode.postMessage({ command: 'cancel' });
      });
    }

    // Host → webview: append a freshly-fetched page.
    const appendChanges = function (html, done) {
      if (list && html) list.insertAdjacentHTML('beforeend', html);
      wireCards();
      updatePager(done);
      setBusy(false);
      refresh();
      syncToggleAll();
    };
    const handleMessage = function (msg) {
      if (!msg) return;
      if (msg.command === 'appendChanges') appendChanges(msg.html, msg.done === true);
      else if (msg.command === 'busyDone') {
        setBusy(false);
        // The host aborted/failed the apply and the panel is staying open (or a page load
        // settled) — let Apply be pressed again.
        setApplying(false);
      }
    };
    if (typeof doc.defaultView !== 'undefined' && doc.defaultView) {
      doc.defaultView.addEventListener('message', function (e) {
        handleMessage(e.data);
      });
    }

    wireCards();
    refresh();
    syncToggleAll();
    return {
      refresh: refresh,
      deselectedIds: deselectedIds,
      appendChanges: appendChanges,
      handleMessage: handleMessage,
    };
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.RenameMethodPanel = { wire: wire };

  if (typeof acquireVsCodeApi === 'function') {
    wire(document, acquireVsCodeApi());
  }
})();
