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
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.UndoPlanPanel = { wire: wire };

  // Self-wire in the real webview. Without this the page renders and the buttons do nothing:
  // exporting `wire` is enough for a test that calls it, and nothing else ever would.
  if (typeof acquireVsCodeApi === 'function') {
    wire(document, acquireVsCodeApi());
  }
})();
