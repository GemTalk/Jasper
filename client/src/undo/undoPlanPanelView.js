// Runs inside the undo plan webview. Two buttons, nothing else: the rows are fixed, so there is
// no selection to track. Kept as its own file so the host can unit-test it against a DOM.
(function () {
  function wire(doc, vscode) {
    doc.getElementById('apply').addEventListener('click', function () {
      vscode.postMessage({ command: 'apply' });
    });
    doc.getElementById('cancel').addEventListener('click', function () {
      vscode.postMessage({ command: 'cancel' });
    });

    // Enter applies, so a refactoring can be driven Enter-to-Enter: the editor's Enter opens the
    // preview, and the preview's Enter applies it. Without this the flow stopped dead at the
    // panel, which offers no other keyboard route to its primary action.
    //
    // Anything that owns its own Enter keeps it: a text field submits, a button or a disclosure
    // activates itself, so Cancel with focus on it stays Cancel. A checkbox does not use Enter
    // (Space toggles it), so Enter from a change row applies, which is the point.
    doc.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.defaultPrevented) return;
      const t = e.target;
      const tag = t && t.tagName ? String(t.tagName).toUpperCase() : '';
      if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'SUMMARY') return;
      if (tag === 'INPUT' && t.type !== 'checkbox' && t.type !== 'radio') return;
      const btn = doc.getElementById('apply');
      if (!btn || btn.disabled) return;
      e.preventDefault();
      btn.click();
    });
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.UndoPlanPanel = { wire: wire };

  // Self-wire in the real webview. Without this the page renders and the buttons do nothing:
  // exporting `wire` is enough for a test that calls it, and nothing else ever would.
  if (typeof acquireVsCodeApi === 'function') {
    wire(document, acquireVsCodeApi());
  }
})();
