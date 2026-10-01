/**
 * Webview-side behavior for the PAGINATED add / remove instance-variable
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
    const failBanner = doc.getElementById('failBanner');
    const failHead = failBanner ? failBanner.querySelector('.fail-head') : null;
    const failMsg = doc.getElementById('failMsg');
    const abortBtn = doc.getElementById('abort');
    const failCloseBtn = doc.getElementById('failClose');
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

    // Applying is one-shot: a second dispatch would stage a second round of class
    // versions (and a second commit if a committing option is ticked). The host guards
    // this too; disabling the button keeps the UI honest about the in-flight apply.
    let applying = false;
    // Once a failure banner is up the apply is terminally done: the host has latched its own
    // `applying` and will drop any further apply message. `busyDone` (which the host still posts
    // for an already-done loadMore) must NOT re-enable Apply in that state, or the button would
    // look live under the ✖ banner while clicking it does nothing.
    let terminated = false;
    const setApplying = function (busy) {
      applying = busy;
      if (applyBtn) applyBtn.disabled = busy || terminated;
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
        if (applying) return;
        setApplying(true);
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
    // The Abort button aborts the transaction directly — no second confirmation dialog. Its cost
    // is spelled out in the banner message the host sent. Disable it while the abort is in flight.
    if (abortBtn) {
      abortBtn.addEventListener('click', function () {
        abortBtn.disabled = true;
        vscode.postMessage({ command: 'abort' });
      });
    }
    if (failCloseBtn) {
      failCloseBtn.addEventListener('click', function () {
        vscode.postMessage({ command: 'cancel' });
      });
    }

    // The apply failed: leave the preview up and raise a prominent, hard-to-miss banner (not a
    // toast). Show the Abort button only when a partial change is stranded and can be discarded.
    const showApplyFailed = function (message, canAbort) {
      if (failMsg) failMsg.textContent = message || 'Apply failed.';
      if (abortBtn) abortBtn.classList.toggle('hidden', !canAbort);
      if (failBanner) {
        failBanner.classList.remove('hidden');
        if (typeof failBanner.scrollIntoView === 'function') failBanner.scrollIntoView();
      }
      // The apply already ran and this is terminal; keep Apply dead even if a later busyDone arrives.
      terminated = true;
      setApplying(true);
    };
    const showAborted = function () {
      if (failHead) failHead.textContent = '✔ Transaction aborted';
      if (failMsg)
        failMsg.textContent = 'Transaction aborted; nothing from this refactoring remains.';
      if (abortBtn) abortBtn.classList.add('hidden');
    };
    const showAbortFailed = function (message) {
      if (failMsg) {
        var prefix = failMsg.textContent ? failMsg.textContent + '\n\n' : '';
        failMsg.textContent =
          prefix +
          'Abort failed: ' +
          (message || 'unknown error') +
          '. Abort from the session menu.';
      }
      if (abortBtn) abortBtn.disabled = false;
    };

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
      else if (msg.command === 'busyDone') {
        setBusy(false);
        // The host declined/aborted the apply (or a page load settled) and the panel is
        // staying open — let Apply be pressed again.
        setApplying(false);
      } else if (msg.command === 'applyFailed') showApplyFailed(msg.message, msg.canAbort === true);
      else if (msg.command === 'aborted') showAborted();
      else if (msg.command === 'abortFailed') showAbortFailed(msg.message);
    };
    if (typeof doc.defaultView !== 'undefined' && doc.defaultView) {
      doc.defaultView.addEventListener('message', function (e) {
        handleMessage(e.data);
      });
    }

    wireCards();
    syncToggleAll();
    syncCommitHint();
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
