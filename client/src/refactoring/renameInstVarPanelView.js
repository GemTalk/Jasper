/**
 * Webview-side behavior for the rename-instance-variable preview panel
 * (renameInstVarPanel.ts).
 *
 * Like listFilter.js / methodListView.js / debuggerView.js, this is read at
 * runtime via fs.readFileSync and injected into the webview as a <script> tag —
 * it is NOT compiled into the bundle. It lives in its own file so the checkbox
 * bookkeeping, diff toggle, and Apply/Cancel dispatch can be unit-tested in
 * jsdom (see renameInstVarPanel.test.ts) instead of being trapped inside an
 * inline webview <script> string.
 *
 * The host renders each change as <li.change data-id> with a .sel checkbox
 * (checked by default), a .change-head over a collapsed <pre.diff.hidden>, and a
 * header count. All changes start selected so Apply-with-one-click applies
 * everything; diffs start collapsed so the list is scannable — click a row (or
 * its chevron) to expand, or use the Expand/Collapse-all toggle.
 *
 * Exposed as the global `RenameInstVarPanel` so both the webview (classic
 * <script>) and tests (new Function(source)()) can reach `wire`.
 */
(function () {
  // Wire a rendered panel document to a vscode-api-like object ({postMessage}).
  // Returns a small handle so tests can inspect derived state.
  function wire(doc, vscode) {
    const applyBtn = doc.getElementById('apply');
    const cancelBtn = doc.getElementById('cancel');
    const countEl = doc.getElementById('count');
    const selCountEl = doc.getElementById('selcount');
    const toggleAllBtn = doc.getElementById('toggleAll');

    // Applying is one-shot. The host already ignores a second `apply` (its `finish` is
    // latched), but disabling Apply stops the panel from looking live while it closes, and
    // `refresh` folds this in so a checkbox change can't re-enable the button.
    let applying = false;

    const cards = function () {
      return Array.prototype.slice.call(doc.querySelectorAll('li.change'));
    };

    const checkboxes = function () {
      return Array.prototype.slice.call(doc.querySelectorAll('li.change .sel'));
    };

    // Expand or collapse one change's diff, keeping its chevron in sync.
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

    const selectedIds = function () {
      return checkboxes()
        .filter(function (cb) {
          return cb.checked;
        })
        .map(function (cb) {
          const li = cb.closest('li.change');
          return li ? li.getAttribute('data-id') : null;
        })
        .filter(function (id) {
          return id !== null;
        });
    };

    const refresh = function () {
      const n = selectedIds().length;
      if (countEl) countEl.textContent = String(n);
      if (selCountEl) selCountEl.textContent = String(n);
      if (applyBtn) applyBtn.disabled = applying || n === 0;
      checkboxes().forEach(function (cb) {
        const li = cb.closest('li.change');
        if (li) li.classList.toggle('deselected', !cb.checked);
      });
    };

    checkboxes().forEach(function (cb) {
      cb.addEventListener('change', refresh);
    });

    // Clicking anywhere on a change header expands/collapses its diff — except
    // the checkbox itself, which just toggles selection.
    cards().forEach(function (li) {
      const head = li.querySelector('.change-head');
      if (!head) return;
      head.addEventListener('click', function (event) {
        if (event.target && event.target.classList && event.target.classList.contains('sel'))
          return;
        setExpanded(li, !isExpanded(li));
        syncToggleAll();
      });
    });

    // Expand-all / collapse-all: flips based on whether anything is collapsed.
    const syncToggleAll = function () {
      if (!toggleAllBtn) return;
      const allExpanded = cards().length > 0 && cards().every(isExpanded);
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

    // Optional (rename-method panel only): a "Show/Hide" link that expands the
    // list of methods that could not be rewritten. Guarded so the shared
    // rename-instance-variable panel, which never renders it, is unaffected.
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
        const ids = selectedIds();
        applying = true;
        refresh();
        vscode.postMessage({ command: 'apply', ids: ids });
      });
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        vscode.postMessage({ command: 'cancel' });
      });
    }

    refresh();
    syncToggleAll();
    return { refresh: refresh, selectedIds: selectedIds };
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.RenameInstVarPanel = { wire: wire };

  // In the live webview, bootstrap against the real vscode API. In tests,
  // acquireVsCodeApi is undefined, so the module just exposes `wire`.
  if (typeof acquireVsCodeApi === 'function') {
    wire(document, acquireVsCodeApi());
  }
})();
