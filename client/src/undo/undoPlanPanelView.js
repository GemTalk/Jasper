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
    const applyEl = doc.getElementById('apply');
    // Replacing any handler a previous wire() installed, rather than stacking another. The
    // listener is on the DOCUMENT so Enter works from anywhere on the page, and a document
    // outlives a re-render: a stale handler would fire first, act on a detached button, and
    // its preventDefault would stop the live one.
    if (doc.__gsApplyOnEnter) doc.removeEventListener('keydown', doc.__gsApplyOnEnter);
    doc.__gsApplyOnEnter = function (e) {
      if (e.key !== 'Enter' || e.defaultPrevented) return;
      const t = e.target;
      const tag = t && t.tagName ? String(t.tagName).toUpperCase() : '';
      if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'SUMMARY') return;
      if (tag === 'INPUT' && t.type !== 'checkbox' && t.type !== 'radio') return;
      if (!applyEl || applyEl.disabled) return;
      e.preventDefault();
      applyEl.click();
    };
    doc.addEventListener('keydown', doc.__gsApplyOnEnter);

    // Give the webview the keyboard. A panel opens without a focused element, so the keydown
    // above never fires -- the keystroke goes to the editor chrome instead, and Enter looked
    // dead. Focusing Apply also makes it the DEFAULT button in the ordinary sense: Enter (and
    // Space) activate it natively, which is what the editor step already gets by focusing its
    // name field.
    if (applyEl && applyEl.focus) {
      try {
        applyEl.focus();
      } catch (_e) {
        /* jsdom */
      }
    }
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.UndoPlanPanel = { wire: wire };

  // Self-wire in the real webview. Without this the page renders and the buttons do nothing:
  // exporting `wire` is enough for a test that calls it, and nothing else ever would.
  if (typeof acquireVsCodeApi === 'function') {
    wire(document, acquireVsCodeApi());
  }
})();
