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
