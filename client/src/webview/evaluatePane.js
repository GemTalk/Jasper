/**
 * The evaluate pane — its keys, its expression history, and the words it uses for both — shared by
 * the Inspector's evaluate tab and the debugger's evaluate pane.
 *
 * Like millerColumns.js, this is read at runtime via fs.readFileSync and injected into each webview
 * as a <script> tag; it is NOT compiled into the bundle. Exposed as the global `EvaluatePane` so
 * both webviews (classic <script>) and tests (new Function(source)()) can reach it.
 *
 * ## Why this is one module and not two copies
 *
 * It was two copies, and they drifted. https://github.com/GemTalk/Jasper/pull/642 gave the panes the
 * same modes, names and keys — and in that very change the debugger's copy recorded the TRIMMED
 * expression while leaving the box untrimmed, so the guard that stops the first Ctrl+Up reading as a
 * dead key compared two strings that no longer matched: a trailing space handed back the expression
 * you had just run. The Inspector's copy happened to record what the box held and was fine. Nothing
 * about the behaviour differs between the panels; only where each keeps its state, where each says
 * things, and how each reaches the host — so those three are what a panel supplies, and everything
 * else lives here once. See https://github.com/GemTalk/Jasper/issues/651.
 *
 * `evaluateMode.ts` carries the same split on the host side: the three modes a gesture can mean.
 *
 * ## What a panel supplies
 *
 * `create(hooks)` takes:
 *   • `input()`        — the live expression box, or null. Looked up on every use, never captured:
 *                        the Inspector redraws its whole tab when an answer lands, and the
 *                        debugger's pane can be collapsed out from under a keystroke.
 *   • `send(expr, mode)` — hand the (trimmed, non-empty) expression to the host. The Inspector posts
 *                        `evaluate` with a column and an oop, the debugger `evalInFrame` with a
 *                        stack level; neither shape belongs here.
 *   • `syncText(text)` — the box's value was just set from here. The Inspector mirrors it on the
 *                        column it redraws from; both use it to show the ✕ only when there is
 *                        something to clear.
 *   • `showStatus(text)` / `restStatus()` — say something that is NOT a result, then go back to
 *                        rest. Both panes BORROW a surface for this, because neither has a spare
 *                        line: the debugger's result row returns to the answer, the Inspector's
 *                        chord-hint line returns to the chord legend. The timing is here so the two
 *                        cannot differ on how long a message stays.
 *   • `setChordArmed(armed)` — show that a chord is half-typed (a class in one pane, the hint line
 *                        in the other). Called only when the state actually changes, so an idle
 *                        disarm cannot overwrite a message that is still being read.
 *   • `clearPane()`    — empty the box and whatever the last expression answered.
 *   • `escapeWhenEmpty()` — optional. Escape on an already-empty box: the debugger's pane closes,
 *                        the way the list filters do; the Inspector's is a tab with no closed state
 *                        and supplies nothing.
 */
(function () {
  /**
   * The three things the pane can do with an expression, under the editor's own `ctrl+k d`/`e`/`i`.
   *
   * The contributed bindings cannot serve a webview: all three are `when: editorTextFocus`, which a
   * focused webview never satisfies, and the commands behind them read the active text editor for
   * their code. So the pane recognises the chord itself — and because those bindings do not resolve
   * here, doing so cannot collide with them.
   *
   * `ctrl+k r`, Debug It, is deliberately absent: it works by starting the expression with the
   * single-step flag set so the halt carries a process for a debugger to attach to, and neither pane
   * has one to hand over. See evaluateMode.ts.
   */
  var CHORD = { d: 'display', e: 'execute', i: 'inspect' };

  /** How long a borrowed status message holds the surface before handing it back. */
  var STATUS_MS = 1600;

  function isMac() {
    var platform = (typeof navigator !== 'undefined' && navigator.platform) || '';
    return platform.indexOf('Mac') === 0;
  }

  /** The plain modifier this platform WRITES — the pane accepts either, but a hint naming the one
   *  you do not have is worse than no hint. */
  function modifierLabel() {
    return isMac() ? 'Cmd' : 'Ctrl';
  }

  /** The chord prefix as this platform writes it. */
  function chordLabel() {
    return modifierLabel() + '+K';
  }

  /**
   * What the empty box says. A placeholder is the one piece of guidance that costs NO screen space —
   * it lives where the expression will go, and is gone the moment you type.
   *
   * ONE key, not the full legend. A placeholder wider than the field makes the box scroll sideways,
   * and in the debugger's one-line version the scrollbar ate most of the box — so a pane nobody had
   * touched yet looked broken. The rest rides on the box's own tooltip, which costs nothing and
   * cannot overflow.
   */
  function placeholderHint() {
    return 'Shift+Enter to run';
  }

  /** Everything the pane answers to, for the box's tooltip — again at no cost to the layout. */
  function keyLegend() {
    var mod = modifierLabel();
    return (
      'Shift+Enter or ' +
      mod +
      '+Enter — Display It' +
      '\n' +
      chordLabel() +
      ' then D / E / I — Display It, Execute It, Inspect It' +
      '\n' +
      mod +
      '+↑ / ' +
      mod +
      '+↓ — earlier / later expression' +
      '\nEscape — clear the box'
    );
  }

  /** The tooltip for one of the three buttons: the keys that do what the button does. */
  function buttonHint(mode) {
    if (mode === 'display') {
      return 'Shift+Enter, ' + chordLabel() + ' D, or ' + modifierLabel() + '+Enter';
    }
    if (mode === 'execute') return chordLabel() + ' E';
    if (mode === 'inspect') return chordLabel() + ' I';
    return '';
  }

  /**
   * Write that wording onto a pane that has already been drawn.
   *
   * The two panels build their markup in different places — the debugger's in TypeScript
   * (debuggerEvalPane.ts), the Inspector's in its own webview script — and only the webview knows
   * which platform it is on. Installing the text from here rather than baking it into each markup is
   * what leaves ONE copy of the wording: the panes cannot describe the same gesture differently, and
   * a Mac gets `Cmd` everywhere rather than in the half of the pane that happened to derive it.
   *
   * Controls the pane does not have are skipped, so each panel gets what it offers and no panel has
   * to carry a placeholder element for the other's sake.
   */
  function applyLabels(root) {
    if (!root) return;
    var box = root.querySelector('.eval-input');
    if (box) {
      box.placeholder = placeholderHint();
      box.title = keyLegend();
    }
    var hint = root.querySelector('.eval-hint');
    if (hint) hint.title = keyLegend();
    var buttons = root.querySelectorAll('[data-eval]');
    for (var i = 0; i < buttons.length; i += 1) {
      var title = buttonHint(buttons[i].getAttribute('data-eval'));
      if (title) buttons[i].title = title;
    }
  }

  /** One pane's behaviour: its chord, its keys, and its own expression history. */
  function create(hooks) {
    // Expressions already RUN here, newest last — what was merely typed is not in it. Ctrl+Up /
    // Ctrl+Down walk them the way a shell's history does: the box is a place you come back to, and
    // retyping a long doit to change one keyword is the thing that makes an evaluate pane tedious.
    var history = [];
    var at = -1; // -1 = not walking; otherwise an index into `history`
    var draft = ''; // what was in the box when the walk started, to come back to
    var chordArmed = false;
    var statusTimer = null;

    function box() {
      return hooks.input();
    }

    /** Say something that is not a result, and give the surface back. */
    function status(text) {
      cancelStatus();
      hooks.showStatus(text);
      statusTimer = setTimeout(function () {
        statusTimer = null;
        hooks.restStatus();
      }, STATUS_MS);
    }

    function cancelStatus() {
      if (statusTimer) clearTimeout(statusTimer);
      statusTimer = null;
    }

    function setChordArmed(on) {
      if (chordArmed === on) return;
      chordArmed = on;
      hooks.setChordArmed(on);
    }

    /** Put `text` in the box, caret at the end, focus in the box — a recall is an invitation to
     *  edit, so it leaves the pane ready to be typed in. */
    function setText(text) {
      var el = box();
      if (!el) return;
      el.value = text;
      hooks.syncText(text);
      el.focus();
      if (el.setSelectionRange) el.setSelectionRange(text.length, text.length);
    }

    /** Where the walk is, and how to get out of it. Naming the way out at the moment the walk
     *  replaces what you were typing is what makes it a detour rather than a commitment. */
    function walkLabel() {
      return (
        'Earlier ' +
        (history.length - at) +
        ' of ' +
        history.length +
        ' · ' +
        modifierLabel() +
        '+↓ for your draft'
      );
    }

    /**
     * Step BACK through the expressions run in this pane, stopping at the oldest.
     *
     * Running an expression LEAVES it in the box, so stepping to the newest entry would put back the
     * text already on screen and read as a dead key — the first press has to move.
     */
    function recallPrevious() {
      var el = box();
      if (!el) return;
      if (history.length === 0) {
        // Nothing has been RUN here yet. Silence is indistinguishable from the key not being wired
        // at all, which is how an empty history was read when the panel had only just opened.
        status('No earlier expression yet');
        return;
      }
      if (at < 0) {
        draft = el.value;
        var start = history.length - 1;
        // Trimmed on both sides: the history holds what was RUN, which is trimmed, while the box
        // still holds what was typed. Comparing them raw missed on a trailing space or newline —
        // easy to leave in a multi-line box — and the first press handed back the expression just
        // run instead of stepping past it.
        if (el.value.trim() === history[start]) start -= 1;
        if (start < 0) {
          status('Oldest expression');
          return;
        }
        at = start;
      } else {
        if (at === 0) {
          status('Oldest expression');
          return;
        }
        at -= 1;
      }
      setText(history[at]);
      status(walkLabel());
    }

    /** Step FORWARD toward what you were typing; past the newest entry, give the draft back. */
    function recallNext() {
      if (at < 0) return;
      if (at >= history.length - 1) {
        at = -1;
        setText(draft || '');
        status('Back to what you were typing');
        return;
      }
      at += 1;
      setText(history[at]);
      status(walkLabel());
    }

    /** Run what is in the box, in `mode`. A blank expression is not worth a round trip. */
    function run(mode) {
      var el = box();
      if (!el) return;
      var expr = el.value.trim();
      if (!expr) return;
      // Running is not leaving: a button click parks the focus on the button, and the next thing you
      // do is almost always type again — edit this expression, or write the next one.
      el.focus();
      // The history is of what reached the stone, so an expression typed and thought better of is
      // not in it, and a repeat of the last one does not get a second entry. Running also ENDS a
      // walk: the expression just run is the newest, so the next Ctrl+Up means the one before it.
      if (history[history.length - 1] !== expr) history.push(expr);
      at = -1;
      hooks.send(expr, mode);
    }

    /** Empty the expression AND its answer — an answer that outlives the expression it came from
     *  reads as the answer to whatever is typed next. */
    function clear() {
      at = -1; // clearing is a fresh start, not a step in the walk
      cancelStatus();
      hooks.clearPane();
    }

    /**
     * Half-typed chords are why this is a state machine rather than a modifier test: the closing key
     * of `Ctrl+K D` arrives on its own and would otherwise be a `d` typed into the expression.
     * Anything that is not a chord key disarms and is typed as usual, so a stray Ctrl+K costs one
     * keystroke and never a swallowed character.
     */
    function keydown(ev) {
      if (chordArmed) {
        setChordArmed(false);
        var chorded = CHORD[String(ev.key).toLowerCase()];
        if (!chorded) return; // not a chord key: disarm and let it be typed — Escape included
        ev.preventDefault();
        ev.stopPropagation();
        run(chorded);
        return;
      }
      var mod = ev.ctrlKey || ev.metaKey;
      if (mod && String(ev.key).toLowerCase() === 'k') {
        ev.preventDefault();
        ev.stopPropagation();
        setChordArmed(true);
        return;
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        var el = box();
        if (el && el.value) clear();
        else if (hooks.escapeWhenEmpty) hooks.escapeWhenEmpty();
        return;
      }
      // MODIFIED arrows, not bare ones. The box is multi-line, so bare Up/Down have to go on moving
      // the caret; a shell can take them only because its input is one line. Recalling at the box's
      // edges instead (Up on the first line, Down on the last) would work, but makes the same key
      // mean two things depending on where the caret happens to be — the kind of thing you have to
      // learn rather than guess. With the modifier held it means one thing everywhere in the box.
      if (mod && ev.key === 'ArrowUp') {
        ev.preventDefault();
        recallPrevious();
        return;
      }
      if (mod && ev.key === 'ArrowDown') {
        ev.preventDefault();
        recallNext();
        return;
      }
      if (ev.key !== 'Enter') return;
      // Shift+Enter, and Ctrl+Enter for anyone who reaches for that first. Plain Enter is a newline,
      // which is the whole point of the box being multi-line — Shift+Enter took the job over from
      // the debugger's bare Enter when it became one.
      if (ev.shiftKey || mod) {
        ev.preventDefault();
        run('display');
      }
    }

    return {
      keydown: keydown,
      run: run,
      recallPrevious: recallPrevious,
      recallNext: recallNext,
      clear: clear,
      /** Drop a half-typed chord — the focus left the box, or the pane was redrawn under it. */
      disarm: function () {
        setChordArmed(false);
      },
      /**
       * Take the status surface back: the panel is about to write what the surface says at rest
       * (an answer landing, a fresh stack), so a message still counting down would put the OLD rest
       * back on top of it a moment later.
       */
      settle: cancelStatus,
    };
  }

  var root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.EvaluatePane = {
    create: create,
    applyLabels: applyLabels,
    modifierLabel: modifierLabel,
    chordLabel: chordLabel,
    placeholderHint: placeholderHint,
    keyLegend: keyLegend,
    buttonHint: buttonHint,
    STATUS_MS: STATUS_MS,
  };
})();
