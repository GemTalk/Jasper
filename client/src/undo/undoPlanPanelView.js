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

    // Enter applies, so the panel has a keyboard route to its primary action -- the same one
    // the refactoring preview panels offer. An undo has no editor step before it, so this is
    // one deliberate Enter rather than a chain of them.
    //
    // Anything that owns its own Enter keeps it: a text field submits, a button or a disclosure
    // activates itself, so Cancel with focus on it stays Cancel. A checkbox does not use Enter
    // (Space toggles it), so Enter from a change row applies, which is the point.
    const applyEl = doc.getElementById('apply');
    // Replacing any handler a previous wire() installed, rather than stacking another. The
    // listener is on the DOCUMENT so Enter works from anywhere on the page, and a document
    // outlives a re-render: a stale handler would fire first, act on a detached button, and
    // its preventDefault would stop the live one.
    // Enter is ARMED only once this page has seen the key released.
    //
    // Apply is focused on open, which makes Enter activate it NATIVELY -- the document handler
    // below never sees that, because it returns early for a BUTTON target. So a held Enter
    // auto-repeats straight through: the rename editor takes one, the shadowing-rename modal's
    // default button takes the next, and Apply takes the third, applying a preview nobody has
    // looked at. Every one of those comes from a single unreleased keypress, so a keyup is
    // exactly the signal that a NEW, deliberate Enter is on its way (#396).
    //
    // The keydown capture on Apply is what stops the native activation; preventDefault on a
    // bubbling document listener would be too late.
    // ...or once the panel has simply been open a moment. A keyup is the ideal signal and the
    // page often never hears one: this panel is built after a round trip to the stone, so the
    // Enter that opened it was released while there was no page to listen, and opening it with
    // the mouse leaves nothing to hear either. The keyup alone therefore ate the first
    // DELIBERATE Enter and the Enter-to-Enter flow needed two presses.
    //
    // A short idle closes that, because the two cases are separated by orders of magnitude: an
    // auto-repeat cascade lands within tens of milliseconds of the panel appearing, and a person
    // who has read a preview takes far longer.
    //
    // The idle ALONE is not enough either. It opens on a clock, so a key still held when the
    // window elapses auto-repeats straight into Apply. So a repeat-flagged keydown is refused
    // outright, whatever the arming says -- nothing good ever comes of auto-repeat activating
    // the primary action.
    //
    // The two together is what makes this hold. Testing e.repeat alone was the other candidate
    // and is not safe on its own: the flag is the browser's record of the key already being
    // down, kept per document, so the first keydown delivered to a webview that only just took
    // focus can arrive unflagged. That unflagged one lands in the first few milliseconds, which
    // is exactly where the idle is still shut -- each covers the other's gap.
    doc.__gsEnterArmed = false;
    doc.__gsArmAt = Date.now() + 300;
    if (doc.__gsArmEnter) doc.removeEventListener('keyup', doc.__gsArmEnter);
    doc.__gsArmEnter = function () {
      doc.__gsEnterArmed = true;
    };
    doc.addEventListener('keyup', doc.__gsArmEnter);
    if (applyEl && applyEl.addEventListener) {
      if (applyEl.__gsEnterGuard)
        applyEl.removeEventListener('keydown', applyEl.__gsEnterGuard, true);
      applyEl.__gsEnterGuard = function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (e.repeat) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (doc.__gsEnterArmed || Date.now() >= doc.__gsArmAt) return;
        e.preventDefault();
        e.stopPropagation();
      };
      applyEl.addEventListener('keydown', applyEl.__gsEnterGuard, true);
    }

    if (doc.__gsApplyOnEnter) doc.removeEventListener('keydown', doc.__gsApplyOnEnter);
    doc.__gsApplyOnEnter = function (e) {
      if (e.key !== 'Enter' || e.defaultPrevented) return;
      // a held Enter from an earlier step, not a new one
      if (e.repeat) return;
      if (!(doc.__gsEnterArmed || Date.now() >= doc.__gsArmAt)) return;
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
