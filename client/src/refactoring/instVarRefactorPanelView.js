/**
 * Webview-side behavior for the PAGINATED add / remove / move instance-variable
 * preview panel (instVarRefactorPanel.ts).
 *
 * Read at runtime and injected as a <script> tag (NOT bundled) so the diff toggle,
 * pagination, and apply dispatch can be unit-tested in jsdom
 * (see instVarRefactorPanel.test.ts).
 *
 * Every change is REQUIRED (the class-shape edit and its descendant reparents are
 * all-or-nothing), so rows are checked + disabled and the reported deselected set is
 * always empty. APPLY reports whether to migrate instances / delete history (both of
 * which commit the transaction) and sends `options: null` so the acted-on class keeps
 * its current compile options.
 *
 * Exposed as the global `InstVarRefactorPanel` so the webview and tests reach `wire`.
 */
(function () {
  function wire(doc, vscode) {
    const applyBtn = doc.getElementById('apply');
    const cancelBtn = doc.getElementById('cancel');
    const toggleAllBtn = doc.getElementById('toggleAll');
    const moreBtn = doc.getElementById('more');
    const loadAllBtn = doc.getElementById('loadAll');
    const pager = doc.getElementById('pager');
    const pagerStatus = doc.getElementById('pagerStatus');
    const list = doc.querySelector('ul.changes');
    const migrateBox = doc.getElementById('migrate');
    const deleteHistoryBox = doc.getElementById('deleteHistory');
    const total = parseInt((doc.body && doc.body.getAttribute('data-total')) || '0', 10);

    const cards = function () {
      return Array.prototype.slice.call(doc.querySelectorAll('li.change'));
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

    const wireCards = function () {
      cards().forEach(function (li) {
        if (li.getAttribute('data-wired') === '1') return;
        li.setAttribute('data-wired', '1');
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

    // Reflect the commit warning on the Apply button when either committing option is on.
    const syncCommitHint = function () {
      if (!applyBtn) return;
      const commits =
        (migrateBox && migrateBox.checked) || (deleteHistoryBox && deleteHistoryBox.checked);
      applyBtn.textContent = commits ? 'Apply & Commit' : 'Apply';
      applyBtn.classList.toggle('commits', !!commits);
    };
    if (migrateBox) migrateBox.addEventListener('change', syncCommitHint);
    if (deleteHistoryBox) deleteHistoryBox.addEventListener('change', syncCommitHint);

    if (applyBtn) {
      applyBtn.addEventListener('click', function () {
        vscode.postMessage({
          command: 'apply',
          deselected: [],
          options: null,
          migrate: !!(migrateBox && migrateBox.checked),
          deleteHistory: !!(deleteHistoryBox && deleteHistoryBox.checked),
        });
      });
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        vscode.postMessage({ command: 'cancel' });
      });
    }

    const appendChanges = function (html, done) {
      if (list && html) list.insertAdjacentHTML('beforeend', html);
      wireCards();
      updatePager(done);
      setBusy(false);
      syncToggleAll();
    };
    const handleMessage = function (msg) {
      if (!msg) return;
      if (msg.command === 'appendChanges') appendChanges(msg.html, msg.done === true);
      else if (msg.command === 'busyDone') setBusy(false);
    };
    if (typeof doc.defaultView !== 'undefined' && doc.defaultView) {
      doc.defaultView.addEventListener('message', function (e) {
        handleMessage(e.data);
      });
    }

    wireCards();
    syncToggleAll();
    syncCommitHint();
    return {
      appendChanges: appendChanges,
      handleMessage: handleMessage,
    };
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.InstVarRefactorPanel = { wire: wire };

  if (typeof acquireVsCodeApi === 'function') {
    wire(document, acquireVsCodeApi());
  }
})();
