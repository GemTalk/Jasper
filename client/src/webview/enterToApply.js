// Enter applies a preview panel -- but never from a held key. Shared by the refactoring preview
// panels and the undo plan panel; each host loads it ahead of its own panel script, and the
// panel calls GsEnterToApply.arm(doc, applyEl) every time it renders.
//
// Anything that owns its own Enter keeps it: a text field submits, a button or a disclosure
// activates itself, so Cancel with focus on it stays Cancel. A checkbox does not use Enter
// (Space toggles it), so Enter from a change row applies, which is the point.
//
// Every listener replaces the one a previous arm() installed rather than stacking another. The
// document outlives a re-render: a stale handler would fire first, act on a detached button,
// and its preventDefault would stop the live one.
(function () {
  function arm(doc, applyEl) {
    // Without a guard, a held Enter auto-repeats straight through: the rename editor takes one,
    // the shadowing-rename modal's default button the next, and Apply the third, applying a
    // preview nobody has looked at (#396).
    //
    // Two checks. A keyup or a 300ms idle arms Enter, so the first deliberate press counts even
    // though the Enter that opened the panel was released before the page could hear it. A
    // repeat-flagged keydown is always refused, so a key held past the idle can't reach Apply.
    // The repeat flag alone isn't enough: the first keydown after the webview takes focus can
    // arrive unflagged, but it lands within the idle, which blocks it.
    doc.__gsEnterArmed = false;
    doc.__gsArmAt = Date.now() + 300;
    if (doc.__gsArmEnter) doc.removeEventListener('keyup', doc.__gsArmEnter);
    doc.__gsArmEnter = function () {
      doc.__gsEnterArmed = true;
    };
    doc.addEventListener('keyup', doc.__gsArmEnter);
    const armed = function () {
      return doc.__gsEnterArmed || Date.now() >= doc.__gsArmAt;
    };

    // A capture listener on Apply is what stops the native activation; preventDefault on the
    // bubbling document listener below would be too late.
    if (applyEl && applyEl.addEventListener) {
      if (applyEl.__gsEnterGuard)
        applyEl.removeEventListener('keydown', applyEl.__gsEnterGuard, true);
      applyEl.__gsEnterGuard = function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (!e.repeat && armed()) return;
        e.preventDefault();
        e.stopPropagation();
      };
      applyEl.addEventListener('keydown', applyEl.__gsEnterGuard, true);
    }

    if (doc.__gsApplyOnEnter) doc.removeEventListener('keydown', doc.__gsApplyOnEnter);
    doc.__gsApplyOnEnter = function (e) {
      if (e.key !== 'Enter' || e.defaultPrevented || e.repeat || !armed()) return;
      const t = e.target;
      const tag = t && t.tagName ? String(t.tagName).toUpperCase() : '';
      if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'SUMMARY') return;
      if (tag === 'INPUT' && t.type !== 'checkbox' && t.type !== 'radio') return;
      if (!applyEl || applyEl.disabled) return;
      e.preventDefault();
      applyEl.click();
    };
    doc.addEventListener('keydown', doc.__gsApplyOnEnter);

    // Give the webview the keyboard. A panel opens with nothing focused, so the keystroke went to
    // the editor chrome and Enter looked dead. Focused, Apply is also the default button: Enter
    // and Space activate it natively, as the editor step's name field already gets.
    if (applyEl && applyEl.focus) {
      try {
        applyEl.focus();
      } catch (_e) {
        /* jsdom */
      }
    }
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.GsEnterToApply = { arm: arm };
})();
