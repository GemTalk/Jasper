/**
 * Webview-side behaviour for the per-method history viewer (methodHistoryPanel.ts).
 * Read at runtime and injected as a <script> tag (NOT bundled) so it can be
 * unit-tested in jsdom (see methodHistoryPanel.test.ts).
 *
 * Each version row expands to show its diff-against-current and source. On a
 * non-current version, "Restore this version" posts a `restore` message and
 * "Diff ⇄ current" posts a `diff` message; the host confirms/performs each and
 * posts `refresh` with a freshly-rendered list. Exposed as the global
 * `MethodHistoryPanel` so the webview and tests reach `wire`.
 */
(function () {
  function wire(doc, vscode) {
    const list = doc.querySelector('ul.versions');

    const toggle = function (li) {
      const detail = li.querySelector('.detail');
      const btn = li.querySelector('.toggle');
      if (!detail) return;
      const hidden = detail.classList.toggle('hidden');
      if (btn) {
        btn.textContent = hidden ? '▸' : '▾';
        btn.setAttribute('aria-expanded', String(!hidden));
      }
    };

    const wireRows = function () {
      Array.prototype.slice.call(doc.querySelectorAll('li.version')).forEach(function (li) {
        if (li.getAttribute('data-wired') === '1') return;
        li.setAttribute('data-wired', '1');
        const head = li.querySelector('.version-head');
        if (head) {
          head.addEventListener('click', function (event) {
            if (
              event.target &&
              event.target.classList &&
              (event.target.classList.contains('restore') ||
                event.target.classList.contains('diff'))
            )
              return;
            toggle(li);
          });
        }
        const indexOf = function () {
          return parseInt(li.getAttribute('data-index') || '0', 10);
        };
        const restoreBtn = li.querySelector('.restore');
        if (restoreBtn) {
          restoreBtn.addEventListener('click', function () {
            const index = indexOf();
            if (index > 0) vscode.postMessage({ command: 'restore', index: index });
          });
        }
        const diffBtn = li.querySelector('.diff');
        if (diffBtn) {
          diffBtn.addEventListener('click', function () {
            const index = indexOf();
            if (index > 0) vscode.postMessage({ command: 'diff', index: index });
          });
        }
      });
    };

    const handleMessage = function (msg) {
      if (!msg) return;
      if (msg.command === 'refresh' && list && typeof msg.html === 'string') {
        list.innerHTML = msg.html;
        wireRows();
      }
    };
    if (typeof doc.defaultView !== 'undefined' && doc.defaultView) {
      doc.defaultView.addEventListener('message', function (e) {
        handleMessage(e.data);
      });
    }

    wireRows();
    return { wireRows: wireRows, handleMessage: handleMessage };
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.MethodHistoryPanel = { wire: wire };

  if (typeof acquireVsCodeApi === 'function') {
    wire(document, acquireVsCodeApi());
  }
})();
