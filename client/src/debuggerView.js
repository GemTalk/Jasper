/**
 * Webview-side behavior for the GemStone Debugger panel (debuggerPanel.ts).
 *
 * Like listFilter.js / methodListView.js, this is read at runtime via
 * fs.readFileSync and injected into the webview as a <script> tag — it is NOT
 * compiled into the bundle. It lives in its own file so the stack rendering,
 * frame selection, and the custom right-click ("Copy Frame") popup can be
 * unit-tested in jsdom (see debuggerView.test.ts) instead of being trapped
 * inside the inline webview <script> string.
 *
 * Stage 1 extraction: the host (debuggerPanel.ts) keeps owning the data layer
 * and clipboard writes; this module owns everything that happens in the DOM.
 *
 * Exposed as the global `DebuggerView` so both the webview (classic <script>)
 * and tests (new Function(source)()) can reach it.
 */
(function () {
  // Render the stack frames into listEl. Each frame becomes
  //   <li class="frame" data-level="N"> <span.level> <span.label> [<span.pos>]
  // The data-level attribute is how selection and the copy popup refer back to
  // a frame, so the host never needs to send DOM node identities.
  function renderStack(listEl, stack) {
    listEl.innerHTML = '';
    if (!stack || stack.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No stack frames available.';
      listEl.appendChild(li);
      return;
    }
    for (const frame of stack) {
      const li = document.createElement('li');
      li.className = 'frame';
      li.dataset.level = String(frame.level);
      li.title = 'Click to select; right-click to copy this frame';
      const lvl = document.createElement('span');
      lvl.className = 'level';
      lvl.textContent = frame.level;
      const lbl = document.createElement('span');
      lbl.className = 'label';
      lbl.textContent = frame.label;
      li.appendChild(lvl);
      li.appendChild(lbl);
      if (frame.position) {
        const pos = document.createElement('span');
        pos.className = 'pos';
        pos.textContent = frame.position;
        li.appendChild(pos);
      }
      listEl.appendChild(li);
    }
  }

  // Render the selected frame's variables into varsEl, grouped (Receiver /
  // Instance variables / Arguments & Temps / stack temps). Each group is
  // { title, kind, collapsed?, vars:[{name, value, oop}] }; value is the
  // host-computed printString. onInspect(oop, name) is called when a row is
  // clicked (opens an enhanced inspector); it's optional so tests can omit it.
  // Render the grouped variables. `handlers` (all optional) wires the T1
  // variable evaluator + Inspect:
  //   contextMenu(e, oop, name) — right-click a row (Inspect lives here now).
  //   commit(edit, expr)        — Enter in an editable row's inline editor;
  //                               posts the new expression to the host.
  //   setActiveEditor(ctrl|null)— register the open inline editor so the host's
  //                               setVariableResult can flag an error on it (and
  //                               so opening another editor closes the prior one).
  // A row carries `edit` ({kind,index}) when it's editable (instVars + named/
  // stack temps); `self` has none and stays read-only.
  function renderVariables(varsEl, groups, handlers) {
    handlers = handlers || {};
    varsEl.innerHTML = '';
    if (!groups || groups.length === 0) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = 'No variables.';
      varsEl.appendChild(d);
      return;
    }
    for (const g of groups) {
      const group = document.createElement('div');
      group.className = 'var-group' + (g.collapsed ? ' collapsed' : '');
      group.dataset.kind = g.kind;

      const title = document.createElement('div');
      title.className = 'var-group-title';
      title.textContent = g.title;
      // Clicking a group title collapses/expands its body.
      title.addEventListener('click', function () {
        group.classList.toggle('collapsed');
      });
      group.appendChild(title);

      const body = document.createElement('div');
      body.className = 'var-group-body';
      for (const v of g.vars || []) {
        const row = document.createElement('div');
        row.className = 'var' + (v.edit ? ' editable' : '');
        row.dataset.oop = v.oop;
        row.title = v.edit ? 'Click to edit • right-click to Inspect' : 'Right-click to Inspect';

        const name = document.createElement('span');
        name.className = 'var-name' + (v.name === 'self' ? ' self' : '');
        name.textContent = v.name;
        const val = document.createElement('span');
        val.className = 'var-value';
        val.textContent = v.value;
        const oop = document.createElement('span');
        oop.className = 'var-oop';
        oop.textContent = v.oop;

        row.appendChild(name);
        row.appendChild(val);
        // Revert (↺) icon — only on slots edited away from their original this
        // halt. Clicking restores the original; it must not open the editor.
        if (v.revertible && v.edit) {
          const rev = document.createElement('span');
          rev.className = 'var-revert';
          rev.textContent = '↺';
          rev.title = 'Revert to original value';
          rev.addEventListener('click', function (e) {
            e.stopPropagation();
            if (handlers.revert) handlers.revert(v.edit);
          });
          row.appendChild(rev);
        }
        row.appendChild(oop);

        // Right-click → Inspect (moved off left-click).
        row.addEventListener('contextmenu', function (e) {
          if (handlers.contextMenu) handlers.contextMenu(e, v.oop, v.name);
        });
        // Left-click → open the variable evaluator (editable rows only). The
        // guard stops a click on the row padding from stacking a 2nd editor.
        if (v.edit) {
          row.addEventListener('click', function () {
            if (!row.querySelector('.var-edit')) openVarEditor(row, val, v, handlers);
          });
        }
        body.appendChild(row);
      }
      group.appendChild(body);
      varsEl.appendChild(group);
    }
  }

  // Open the inline "variable evaluator" on a row: an input prefilled with the
  // value's printString (selected). Enter commits the typed expression (the host
  // evaluates it in the frame and assigns the result); Esc cancels and restores
  // the displayed value; blur cancels too (unless a commit is in flight). On a
  // compile/runtime error the host calls ctrl.showError and the editor STAYS so
  // the expression can be fixed.
  function openVarEditor(row, valEl, v, handlers) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'var-edit';
    input.value = v.value;
    valEl.style.display = 'none';
    row.classList.add('editing'); // wraps the error message onto its own line
    row.insertBefore(input, valEl);
    input.focus();
    input.select();

    let pending = false;
    let closed = false;
    let errored = false; // an error is on screen → don't auto-close on blur
    let errEl = null; // the visible error message line (created lazily)
    function clearError() {
      errored = false;
      input.classList.remove('error');
      input.removeAttribute('title');
      if (errEl) {
        if (errEl.parentNode) errEl.parentNode.removeChild(errEl);
        errEl = null;
      }
    }
    function close() {
      if (closed) return;
      closed = true;
      clearError();
      if (input.parentNode) input.parentNode.removeChild(input);
      row.classList.remove('editing');
      valEl.style.display = '';
      if (handlers.setActiveEditor) handlers.setActiveEditor(null);
    }
    const ctrl = {
      // Surface a rejected expression unmistakably: red border on the input AND a
      // visible message line (a hover-only tooltip is too easy to miss). The
      // editor STAYS open so the expression can be fixed.
      showError: function (m) {
        pending = false;
        errored = true;
        const text = m || 'Error';
        input.classList.add('error');
        input.title = text;
        if (!errEl) {
          errEl = document.createElement('div');
          errEl.className = 'var-edit-error';
          row.appendChild(errEl);
        }
        errEl.textContent = text;
        input.focus();
        input.select();
      },
      close: close,
    };
    if (handlers.setActiveEditor) handlers.setActiveEditor(ctrl);

    input.addEventListener('click', function (e) {
      e.stopPropagation();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const expr = input.value.trim();
        if (!expr) {
          close();
          return;
        }
        clearError();
        pending = true;
        if (handlers.commit) handlers.commit(v.edit, expr);
        // Stays open: success → the host re-renders variables (removing this
        // editor); error → ctrl.showError flags it and keeps it open.
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    });
    input.addEventListener('blur', function () {
      // Defer so a click that moved focus to (e.g.) the context menu still runs.
      // While an error is showing, DON'T auto-close — the user may be clicking the
      // message to select/copy it (blurring the input). Esc still dismisses it.
      setTimeout(function () {
        if (!pending && !errored) close();
      }, 0);
    });
  }

  // Render (or clear) the "Create #selector in Class" action shown when the
  // process is parked on a doesNotUnderstand:. `dnu` is { selector, className,
  // isMeta } or null/undefined (nothing to create). onCreate is called when the
  // button is clicked (posts createDnuMethod); optional so tests can omit it.
  function renderDnu(dnuBarEl, dnu, onCreate) {
    if (!dnuBarEl) return;
    dnuBarEl.innerHTML = '';
    if (!dnu) return;
    const btn = document.createElement('button');
    btn.className = 'dnu-btn';
    btn.textContent =
      'Create #' + dnu.selector + ' in ' + dnu.className + (dnu.isMeta ? ' class' : '');
    btn.title = 'Create the missing method, then re-run the send into it';
    if (onCreate) btn.addEventListener('click', onCreate);
    dnuBarEl.appendChild(btn);
  }

  // Render (or clear) the "Implement #selector" action shown when the process is
  // parked on a subclassResponsibility (T4) — an abstract method invoked on a
  // concrete subclass that didn't override it. The target class is chosen via a
  // picker (like the override flow), so only the selector is shown on the button.
  // `sr` is { selector } or null/undefined (nothing to implement). Shares the
  // dnuBar; DNU and subclassResponsibility are mutually-exclusive parked states.
  function renderSubclassResp(dnuBarEl, sr, onImplement) {
    if (!dnuBarEl) return;
    dnuBarEl.innerHTML = '';
    if (!sr) return;
    const btn = document.createElement('button');
    btn.className = 'dnu-btn';
    btn.textContent = 'Implement #' + sr.selector;
    btn.title = 'Implement this abstract (subclassResponsibility) method in a concrete class';
    if (onImplement) btn.addEventListener('click', onImplement);
    dnuBarEl.appendChild(btn);
  }

  // Mark the frame with the given level selected, clearing any prior selection.
  // Returns the selected <li>, or null when no frame carries that level.
  function selectFrame(listEl, level) {
    const prev = listEl.querySelector('.frame.selected');
    if (prev) prev.classList.remove('selected');
    const li = listEl.querySelector('.frame[data-level="' + level + '"]');
    if (li) li.classList.add('selected');
    return li;
  }

  // Show the custom context menu at the cursor; hide it.
  function showMenu(menuEl, x, y) {
    menuEl.style.left = x + 'px';
    menuEl.style.top = y + 'px';
    menuEl.classList.add('show');
  }
  function hideMenu(menuEl) {
    menuEl.classList.remove('show');
  }

  // Find the 1-based level of the frame containing an event target, or null.
  function frameLevelOf(target) {
    const li = target && target.closest ? target.closest('.frame') : null;
    return li ? Number(li.dataset.level) : null;
  }

  /**
   * Wire all webview interactions given the DOM refs + the vscode api object.
   * Returns a tiny controller (mainly for tests):
   *   selectedLevel() — the currently selected frame's level (or null)
   *   select(level)   — programmatically select a frame
   *
   * Selecting a frame (left-click, right-click, or the default top-frame select)
   * marks it `.selected`, tracks it so "Copy Frame" knows its target, and posts
   * `selectFrame` to the host so it can open that frame's source in the companion
   * editor and highlight the current line.
   */
  function init(refs, vscode) {
    const {
      list,
      menu,
      copyFrameItem,
      browseFrameItem,
      homeFrameItem,
      frameImplItem,
      copyBtn,
      dumpBtn,
      maximizeBtn,
      saveNotice,
      savePath,
      copyPathBtn,
      error,
      flash,
      dnuBar,
      toolbar,
      runToCursorBtn,
      variables,
      evalInput,
      evalResult,
      evalToggle,
      evalClear,
      evalbar,
      frameEvalItem,
      main,
      splitter,
      varMenu,
      varInspectItem,
      busyOverlay,
      busyCancel,
    } = refs;
    // Progress indicator (#9). A blocking GCI call FREEZES the extension host, and
    // postMessage delivery needs that event loop — so the host cannot tell us "I'm
    // busy" while it's busy (the on/off pair would arrive together, after the work).
    // Instead the WEBVIEW drives it: when we send a server-bound request we start a
    // reveal timer HERE (this is a separate process, so the timer fires and the CSS
    // spinner animates even while the host is frozen). We hide it when the host's
    // response lands. The timer's delay means fast round-trips never flash.
    const BUSY_DELAY_MS = 500;
    // Outbound commands that make the host do a server round-trip and then post a
    // reply back. Local-only commands (copyText/saveLayout/dump/terminate/etc.) and
    // ops with no webview reply (inspectVariable) are intentionally excluded.
    const SERVER_BOUND = {
      ready: 1,
      selectFrame: 1,
      evalInFrame: 1,
      stepOver: 1,
      stepInto: 1,
      stepThrough: 1,
      restartFrame: 1,
      setVariable: 1,
      revertVariable: 1,
      runToCursor: 1,
      resume: 1,
      createDnuMethod: 1,
    };
    let busyTimer = null; // reveal-delay timer; non-null ⇒ a span is pending/shown
    let busyActive = false; // a server request is in flight (timer pending or shown)
    let busyCancellable = false; // the running op can be cancelled (host said so)
    let busyShown = false; // the spinner is currently revealed
    function showBusyOverlay(on) {
      busyShown = on;
      if (document.body) document.body.classList.toggle('busy', on);
      if (busyOverlay) busyOverlay.style.display = on ? '' : 'none';
      // The Cancel button rides the spinner, but only for cancellable ops — so it
      // never shows for a blocking op the host couldn't actually interrupt.
      if (busyCancel) busyCancel.style.display = on && busyCancellable ? '' : 'none';
    }
    function beginBusy() {
      if (busyActive) return; // already in a span; keep the existing reveal timer
      busyActive = true;
      busyTimer = setTimeout(function () {
        busyTimer = null;
        showBusyOverlay(true);
      }, BUSY_DELAY_MS);
    }
    function endBusy() {
      busyActive = false;
      busyCancellable = false;
      if (busyTimer != null) {
        clearTimeout(busyTimer);
        busyTimer = null;
      }
      showBusyOverlay(false);
      if (busyCancel) busyCancel.textContent = 'Cancel'; // reset for the next op
    }
    function applyBusy(on) {
      if (on) beginBusy();
      else endBusy();
    }
    // Host tells us the in-flight op can be cancelled → reveal Cancel if the
    // spinner is already up (else showBusyOverlay picks it up when it reveals).
    function setCancellable(on) {
      busyCancellable = on;
      if (busyShown && busyCancel) busyCancel.style.display = on ? '' : 'none';
    }
    if (busyCancel) {
      busyCancel.addEventListener('click', function () {
        // Each click escalates host-side: first = soft break, second = hard break.
        vscode.postMessage({ command: 'cancelOp' });
        busyCancel.textContent = 'Cancelling… (click again to force)';
      });
    }
    // Single send path: starts the busy span for server-bound requests, then posts.
    /**
     * Tell the host how tall this panel needs its editor group to be, so it can
     * push the companion source pane down far enough that nothing here is cut
     * off — the message saying why execution stopped above all.
     *
     * Measured, not estimated: the host can't know how many rows the toolbar
     * wrapped to, whether a "Create #selector" bar is showing, or how many lines
     * the error ran to. `scrollHeight` is the height at which nothing overflows,
     * with the panes already at their CSS floor; `innerHeight` lets the host work
     * out how much of the group its tab bar takes. Sent after each init render
     * (the banner and the action bar can change with it), and the host acts on it
     * only while the panel is opening.
     */
    function reportFit() {
      // Next frame: the layout has to settle before the heights mean anything.
      requestAnimationFrame(function () {
        post({
          command: 'fit',
          needed: document.body.scrollHeight,
          viewport: window.innerHeight,
        });
      });
    }

    function post(msg) {
      if (msg && SERVER_BOUND[msg.command]) beginBusy();
      vscode.postMessage(msg);
    }
    let dumpedPath = null; // the last-dumped file path, for the Copy-path button
    let saveNoticeTimer = null;
    const COPY_GLYPH = copyPathBtn ? copyPathBtn.textContent : '';
    function hideSaveNotice() {
      if (saveNoticeTimer) {
        clearTimeout(saveNoticeTimer);
        saveNoticeTimer = null;
      }
      if (saveNotice) saveNotice.style.display = 'none';
      if (savePath) {
        savePath.textContent = '';
        savePath.title = '';
      }
      dumpedPath = null;
    }
    let selectedLevel = null;
    // The last-rendered stack (frame summaries), so the right-click menu can read
    // a frame's `overridable` / `receiverClass` to decide whether to offer the
    // "Implement in <receiverClass>" override action.
    let currentStack = [];
    // The currently-open variable evaluator (so setVariableResult can flag an
    // error on it, and opening another closes it) + the row a right-click menu
    // targets.
    let activeVarEditor = null;
    let varMenuTarget = null;
    function setActiveVarEditor(ctrl) {
      if (ctrl == null) {
        activeVarEditor = null;
        return;
      }
      if (activeVarEditor && activeVarEditor !== ctrl) activeVarEditor.close();
      activeVarEditor = ctrl;
    }
    // Handlers handed to renderVariables on every refresh.
    const varHandlers = {
      contextMenu: function (e, oop, name) {
        if (!varMenu) return;
        e.preventDefault();
        e.stopPropagation();
        varMenuTarget = { oop: oop, name: name };
        showMenu(varMenu, e.clientX, e.clientY);
      },
      commit: function (edit, expr) {
        post({
          command: 'setVariable',
          level: selectedLevel,
          kind: edit.kind,
          index: edit.index,
          expr: expr,
        });
      },
      revert: function (edit) {
        post({
          command: 'revertVariable',
          level: selectedLevel,
          kind: edit.kind,
          index: edit.index,
        });
      },
      setActiveEditor: setActiveVarEditor,
    };

    // Enable "Run to Cursor" only when the selected frame is breakable (an editable
    // method we can set a step-point break in). A doit / "Executed Code" frame has
    // no such method, so the button is disabled there (host also guards).
    function updateRunToCursor(level) {
      if (!runToCursorBtn) return;
      const frame = currentStack.find(function (f) {
        return f.level === level;
      });
      const breakable = !!(frame && frame.breakable);
      runToCursorBtn.disabled = !breakable;
      runToCursorBtn.title = breakable
        ? 'Run to Cursor'
        : 'Run to Cursor — not available on this frame';
    }

    function select(level) {
      if (level == null) return;
      selectFrame(list, level);
      selectedLevel = level;
      updateRunToCursor(level);
      post({ command: 'selectFrame', level });
    }

    // Left-click selects a frame (will drive the source pane in later Stage 1 work).
    list.addEventListener('click', (e) => {
      const level = frameLevelOf(e.target);
      if (level != null) select(level);
    });

    // Right-click selects the frame AND opens the custom popup. The "Implement in
    // <receiverClass>" item is shown only for an overridable frame (an inherited
    // method — see buildFrame), labelled with the receiver's class.
    list.addEventListener('contextmenu', (e) => {
      const level = frameLevelOf(e.target);
      if (level == null) return;
      e.preventDefault();
      e.stopPropagation();
      select(level);
      const frame = currentStack.find((f) => f.level === level);
      // "Browse" — only for a frame that runs a real Class>>#selector (the host
      // sets `browsable`); hidden for Executed-Code (doit) and unresolvable frames.
      if (browseFrameItem) {
        browseFrameItem.style.display = frame && frame.browsable ? '' : 'none';
      }
      // "Go to home method" — only for a block frame whose home method is also on
      // the visible stack (host sets homeDisplayLevel to that frame's level).
      if (homeFrameItem) {
        homeFrameItem.style.display = frame && frame.homeDisplayLevel != null ? '' : 'none';
      }
      if (frameImplItem) {
        if (frame && frame.overridable) {
          // Ellipsis signals that clicking opens a class picker (an overridable
          // frame always has several candidates: the receiver's class up through
          // the class that defines the method). The frame label already names the
          // receiver, so the menu item doesn't repeat it.
          frameImplItem.textContent = 'Implement in…';
          frameImplItem.style.display = '';
        } else {
          frameImplItem.style.display = 'none';
        }
      }
      showMenu(menu, e.clientX, e.clientY);
    });

    copyFrameItem.addEventListener('click', (e) => {
      e.stopPropagation();
      if (selectedLevel != null) post({ command: 'copyFrame', level: selectedLevel });
      hideMenu(menu);
    });

    if (browseFrameItem) {
      browseFrameItem.addEventListener('click', (e) => {
        e.stopPropagation();
        if (selectedLevel != null) post({ command: 'browseFrame', level: selectedLevel });
        hideMenu(menu);
      });
    }

    if (homeFrameItem) {
      homeFrameItem.addEventListener('click', (e) => {
        e.stopPropagation();
        const frame = currentStack.find((f) => f.level === selectedLevel);
        // Selecting the home frame drives the source + variables panes for it,
        // exactly like clicking it in the stack list.
        if (frame && frame.homeDisplayLevel != null) select(frame.homeDisplayLevel);
        hideMenu(menu);
      });
    }

    if (frameImplItem) {
      frameImplItem.addEventListener('click', (e) => {
        e.stopPropagation();
        if (selectedLevel != null) post({ command: 'implementInReceiver', level: selectedLevel });
        hideMenu(menu);
      });
    }

    // Variable context menu: Inspect the right-clicked variable.
    if (varInspectItem) {
      varInspectItem.addEventListener('click', (e) => {
        e.stopPropagation();
        if (varMenuTarget)
          post({ command: 'inspectVariable', oop: varMenuTarget.oop, name: varMenuTarget.name });
        if (varMenu) hideMenu(varMenu);
      });
    }

    // Show a transient status line (e.g. Run to Cursor falling back to a plain
    // Resume), then fade it out after a few seconds. Independent of the error
    // banner — a later init/refresh won't clobber it, and it won't clobber the
    // error text. A new flash resets the timer.
    let flashTimer = null;
    function showFlash(text) {
      if (!flash) return;
      if (flashTimer) {
        clearTimeout(flashTimer);
        flashTimer = null;
      }
      if (!text) {
        flash.classList.remove('show');
        flash.style.display = 'none';
        flash.textContent = '';
        return;
      }
      flash.textContent = text;
      flash.style.display = '';
      // Force a reflow so the opacity transition runs from 0 even on a re-show.
      void flash.offsetWidth;
      flash.classList.add('show');
      flashTimer = setTimeout(function () {
        flash.classList.remove('show');
        flashTimer = setTimeout(function () {
          flash.style.display = 'none';
          flash.textContent = '';
          flashTimer = null;
        }, 200);
      }, 3500);
    }

    // Briefly swap an icon button's glyph to a check to confirm the action fired
    // (the host does the actual clipboard write / file save), then restore the SVG.
    function flashIcon(btn) {
      const prev = btn.innerHTML;
      btn.textContent = '✓';
      setTimeout(() => {
        btn.innerHTML = prev;
      }, 1200);
    }

    // #10 Copy Stack: the full stack (short stack + each frame's variable values).
    copyBtn.addEventListener('click', () => {
      post({ command: 'copyStack' });
      flashIcon(copyBtn);
    });

    // #11 Dump Stack: write the full stack to ~/.jasper/stacks (no tab opened).
    if (dumpBtn) {
      dumpBtn.addEventListener('click', () => {
        post({ command: 'dumpStackToFile' });
        flashIcon(dumpBtn);
      });
    }

    // Maximize / restore the debugger's editor group. VS Code clips a webview
    // that doesn't fit rather than adapting it, so when the column is genuinely
    // too small this hands the debugger the whole editor area; clicking again
    // puts the grid back exactly as it was.
    if (maximizeBtn) {
      maximizeBtn.addEventListener('click', () => {
        post({ command: 'maximizePanel' });
        flashIcon(maximizeBtn);
      });
    }

    // Clicking the dumped path opens that file in an editor — on demand, so a tab
    // appears only when the user asks for it.
    if (savePath) {
      savePath.addEventListener('click', () => {
        if (dumpedPath != null) post({ command: 'openDumpFile', path: dumpedPath });
      });
    }

    // The small copy glyph beside the saved-path notice copies the full path so
    // you don't have to select the (ellipsized) text by hand. Flash a check to
    // confirm, then dismiss the notice (once copied, you're done with it).
    if (copyPathBtn) {
      copyPathBtn.addEventListener('click', () => {
        if (dumpedPath == null) return;
        post({ command: 'copyText', text: dumpedPath });
        if (saveNoticeTimer) {
          clearTimeout(saveNoticeTimer);
          saveNoticeTimer = null;
        }
        copyPathBtn.textContent = '✓';
        setTimeout(() => {
          copyPathBtn.textContent = COPY_GLYPH;
          hideSaveNotice();
        }, 1200);
      });
    }

    // Toolbar: each button posts its data-cmd. Step/restart act on the selected
    // frame (level included); resume/terminate don't need a level.
    if (toolbar) {
      toolbar.addEventListener('click', (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('button[data-cmd]') : null;
        if (!btn) return;
        const command = btn.dataset.cmd;
        post(selectedLevel != null ? { command, level: selectedLevel } : { command });
      });
    }

    // Eval-in-frame: Enter evaluates the expression in the selected frame.
    // Escape clears what you typed, or closes the bar when it's already empty —
    // the same two-stage Escape the list filters use.
    if (evalInput) {
      evalInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (evalInput.value) clearEval();
          else setEvalCollapsed(true);
          return;
        }
        if (e.key !== 'Enter') return;
        const expr = evalInput.value.trim();
        if (expr) post({ command: 'evalInFrame', level: selectedLevel, expr });
      });
      // The ✕ shows only when there's something to clear.
      evalInput.addEventListener('input', showClearWhenTyped);
    }

    /** Show the clear button once the expression box has anything in it. */
    function showClearWhenTyped() {
      if (evalbar && evalInput) evalbar.classList.toggle('has-text', evalInput.value.length > 0);
    }

    /** Empty the expression AND its answer — a result outlives the expression it
     *  came from otherwise, which reads as the answer to whatever you type next. */
    function clearEval() {
      if (evalInput) {
        evalInput.value = '';
        evalInput.focus();
      }
      if (evalResult) {
        evalResult.textContent = '';
        evalResult.title = '';
        evalResult.classList.remove('error');
      }
      showClearWhenTyped();
    }

    if (evalClear) {
      evalClear.addEventListener('click', (e) => {
        e.preventDefault();
        clearEval();
      });
    }

    // Collapsed, the eval bar is a single line saying what it is; open, it is the
    // input plus its result. Evaluating is occasional and the panel is usually
    // short of height, so it starts closed and remembers how you left it — like
    // the two splitter positions.
    function setEvalCollapsed(collapsed, focusInput) {
      document.body.classList.toggle('eval-collapsed', collapsed);
      if (!collapsed && focusInput && evalInput) evalInput.focus();
      if (vscode.setState) {
        const state = (vscode.getState ? vscode.getState() : null) || {};
        state.evalCollapsed = collapsed;
        vscode.setState(state);
      }
      post({ command: 'saveLayout', evalCollapsed: collapsed });
    }

    if (evalToggle) {
      const toggle = () =>
        setEvalCollapsed(!document.body.classList.contains('eval-collapsed'), true);
      evalToggle.addEventListener('click', toggle);
      evalToggle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
    }

    // "Evaluate in this frame…" on a frame's context menu: select that frame and
    // open the bar ready to type, so the menu is a way IN rather than a separate
    // place the feature lives.
    if (frameEvalItem) {
      frameEvalItem.addEventListener('click', (e) => {
        e.stopPropagation();
        hideMenu(menu);
        setEvalCollapsed(false, true);
      });
    }

    // Draggable splitter: dragging re-apportions the Call Stack vs Variables
    // panes by rewriting `--stack-basis` (the stack pane's width) on `.main`.
    // The ratio is persisted via webview state (survives a reload) and posted to
    // the host as `saveLayout` (so the next debugger panel opens the same way).
    if (splitter && main) {
      // Restore a previously saved ratio when reopening a reloaded webview.
      const saved = vscode.getState ? vscode.getState() : null;
      if (saved && saved.stackBasis) main.style.setProperty('--stack-basis', saved.stackBasis);
      if (saved && saved.evalCollapsed != null)
        document.body.classList.toggle('eval-collapsed', saved.evalCollapsed);

      // The basis at mousedown, so endDrag can tell a real drag from a bare click.
      let startBasis = null;
      function onMove(e) {
        const rect = main.getBoundingClientRect();
        if (rect.width <= 0) return;
        let pct = ((e.clientX - rect.left) / rect.width) * 100;
        pct = Math.max(20, Math.min(80, pct));
        main.style.setProperty('--stack-basis', pct.toFixed(1) + '%');
      }
      function endDrag() {
        // The global listeners exist only for the duration of the drag (attached
        // on mousedown), so idle mouse movement never runs onMove.
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', endDrag);
        splitter.classList.remove('dragging');
        const basis = main.style.getPropertyValue('--stack-basis').trim();
        // Persist only when the divider actually moved — a bare click leaves the
        // basis unchanged and must not trigger a state write / host round-trip.
        if (!basis || basis === startBasis) return;
        if (vscode.setState) {
          const state = (vscode.getState ? vscode.getState() : null) || {};
          state.stackBasis = basis;
          vscode.setState(state);
        }
        post({ command: 'saveLayout', stackBasis: basis });
      }
      splitter.addEventListener('mousedown', (e) => {
        startBasis = main.style.getPropertyValue('--stack-basis').trim();
        splitter.classList.add('dragging');
        e.preventDefault();
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', endDrag);
      });
    }

    // Suppress the native Cut/Copy/Paste menu everywhere; close our popup on any
    // dismiss gesture (outside click, scroll, focus loss, Escape).
    function hideMenus() {
      hideMenu(menu);
      if (varMenu) hideMenu(varMenu);
    }
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
    document.addEventListener('click', hideMenus);
    window.addEventListener('scroll', hideMenus, true);
    window.addEventListener('blur', hideMenus);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideMenus();
    });

    // Inbound messages from the host.
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'busy') {
        // The host can still nudge busy explicitly; the webview-driven send path
        // (post → beginBusy) is the primary trigger that survives a host freeze.
        applyBusy(!!msg.on);
        return;
      }
      if (msg.command === 'cancellable') {
        // Control signal during an in-flight op (not a reply) — don't end the span.
        setCancellable(!!msg.on);
        return;
      }
      // `flash`/`banner` are transient status the host posts DURING an op (e.g. the
      // "Break sent…" acknowledgement on Cancel) — they must NOT end the busy span,
      // or the spinner + Cancel would vanish mid-op and the second Cancel click
      // (hard break) would be unreachable. Every other message is a genuine reply,
      // so it ends the span the send path started.
      if (msg.command !== 'flash' && msg.command !== 'banner') endBusy();
      if (msg.command === 'init') {
        if (error) error.textContent = msg.errorMessage || '';
        // Show the create-method action when parked on a doesNotUnderstand:, or the
        // implement action when parked on a subclassResponsibility (T4). Mutually
        // exclusive; renderDnu(undefined) clears the bar before the SR button renders.
        renderDnu(dnuBar, msg.dnu, function () {
          post({ command: 'createDnuMethod' });
        });
        if (!msg.dnu) {
          renderSubclassResp(dnuBar, msg.subclassResp, function () {
            post({ command: 'implementSubclassResponsibility' });
          });
        }
        // Clear stale variables / eval output; the default-select below re-fetches.
        if (variables) variables.innerHTML = '';
        if (evalResult) {
          evalResult.textContent = '';
          evalResult.classList.remove('error');
        }
        currentStack = msg.stack || [];
        renderStack(list, msg.stack);
        // Default-select the top frame so the debugger opens focused on a frame.
        if (msg.stack && msg.stack.length > 0) select(msg.stack[0].level);
        reportFit();
      } else if (msg.command === 'variables') {
        if (variables) renderVariables(variables, msg.groups, varHandlers);
      } else if (msg.command === 'setVariableResult') {
        // Failure → keep the editor open and flag the error so it can be fixed.
        // Success → the host also posts 'variables', which re-renders (and so
        // removes the editor) with fresh printStrings + OOPs.
        if (!msg.ok && activeVarEditor) activeVarEditor.showError(msg.error);
      } else if (msg.command === 'flash') {
        // Transient status (Run to Cursor fallback, etc.) — shown briefly, then fades.
        showFlash(msg.text);
      } else if (msg.command === 'banner') {
        // Lightweight banner-only update (no stack re-render / frame re-select, so
        // it won't steal focus): set the error/guidance text and clear the DNU
        // Create button. Used while a created method is being edited.
        if (error) error.textContent = msg.text || '';
        if (dnuBar) dnuBar.innerHTML = '';
      } else if (msg.command === 'evalResult') {
        if (evalResult) {
          const value = msg.value != null ? msg.value : '';
          evalResult.textContent = value;
          // The answer shares one row with the expression, so a long printString
          // scrolls sideways — the tooltip is how you read the whole of it.
          evalResult.title = value;
          evalResult.classList.toggle('error', !!msg.isError);
        }
      } else if (msg.command === 'savedNotice') {
        // #11: show the dumped file's path beside the buttons with a Copy-path
        // glyph, then auto-dismiss after 5s (forever was annoying once you're
        // done). Pressing Copy dismisses it early (see the handler above).
        dumpedPath = msg.path || null;
        if (!dumpedPath) {
          hideSaveNotice();
          return;
        }
        if (copyPathBtn) copyPathBtn.textContent = COPY_GLYPH; // reset a stale ✓
        if (savePath) {
          savePath.textContent = 'Dumped to ' + dumpedPath;
          savePath.title = dumpedPath;
        }
        if (saveNotice) saveNotice.style.display = '';
        if (saveNoticeTimer) clearTimeout(saveNoticeTimer);
        saveNoticeTimer = setTimeout(hideSaveNotice, 5000);
      }
    });

    return { selectedLevel: () => selectedLevel, select };
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.DebuggerView = {
    renderStack,
    renderVariables,
    renderDnu,
    renderSubclassResp,
    selectFrame,
    showMenu,
    hideMenu,
    frameLevelOf,
    init,
  };
})();
