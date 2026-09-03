/**
 * Webview-side behavior for the object-graph panel (objectGraphPanel.ts).
 *
 * Like the other panels' view scripts, this is read at runtime via readWebviewScript and
 * injected as a <script> tag under a nonce — it is NOT compiled into the bundle, and it
 * needs a `!` line in `.vscodeignore` or it vanishes from the packaged .vsix.
 *
 * It sends user intent and nothing else. The host owns the walk (which object is centred,
 * which class is expanded, the breadcrumb) and re-renders the whole document on every
 * action, so there is no second copy of that state here to drift out of step, and nothing
 * is posted back down. The routing rules live host-side too: this script does not know
 * that a `Foo class` row can open the Explorer, only that a button said so.
 *
 * Messages, each keyed off a data attribute the renderer put on the control:
 *
 *   data-expand             -> { command: 'expand', classOop, className, ownerOop } (toggles)
 *   data-dive               -> { command: 'dive', oop }
 *   data-inspect-oop        -> { command: 'inspectObject', oop }
 *   data-inspect-collection -> { command: 'inspectCollection', classOop, className }
 *   data-reveal-class       -> { command: 'revealClass', className }
 *   data-reveal-oop         -> { command: 'revealClassByOop', oop }
 *   data-goto               -> { command: 'goTo', index }
 *   data-inspect-target     -> { command: 'inspectTarget' }
 *   data-add-oop            -> { command: 'addToCanvas', oop }
 *   data-remove-oop         -> { command: 'removeFromCanvas', oop }
 *   data-clear-canvas       -> { command: 'clearCanvas' }
 *   data-focus-oop          -> { command: 'focusNode', oop }
 *
 * Exposed as the global `ObjectGraphView` so both the webview (classic <script>) and tests
 * (new Function(source)()) can reach `wire`.
 */
(function () {
  // Ordered INNERMOST-CONTROL FIRST, and the order is load-bearing: dispatch walks this
  // list and the first `closest` hit wins, so a control nested inside a larger click
  // target has to appear above it. data-remove-oop is the × inside an object box that
  // also carries data-focus-oop — listing focus first matched the box, turned every
  // remove into a re-centre, and re-centring auto-promotes that object's single-object
  // groups, so "take this off the graph" visibly ADDED to it.
  var ROUTES = [
    {
      attr: 'data-add-oop',
      build: function (el) {
        return { command: 'addToCanvas', oop: el.getAttribute('data-add-oop') };
      },
    },
    {
      attr: 'data-remove-oop',
      build: function (el) {
        return { command: 'removeFromCanvas', oop: el.getAttribute('data-remove-oop') };
      },
    },
    {
      attr: 'data-focus-oop',
      build: function (el) {
        return { command: 'focusNode', oop: el.getAttribute('data-focus-oop') };
      },
    },
    {
      attr: 'data-clear-canvas',
      build: function () {
        return { command: 'clearCanvas' };
      },
    },
    {
      attr: 'data-dive',
      build: function (el) {
        return { command: 'dive', oop: el.getAttribute('data-dive') };
      },
    },
    {
      attr: 'data-inspect-oop',
      build: function (el) {
        return { command: 'inspectObject', oop: el.getAttribute('data-inspect-oop') };
      },
    },
    {
      attr: 'data-inspect-collection',
      build: function (el) {
        return {
          command: 'inspectCollection',
          classOop: el.getAttribute('data-inspect-collection'),
          className: el.getAttribute('data-class-name'),
        };
      },
    },
    {
      attr: 'data-reveal-class',
      build: function (el) {
        return { command: 'revealClass', className: el.getAttribute('data-reveal-class') };
      },
    },
    {
      attr: 'data-reveal-oop',
      build: function (el) {
        return { command: 'revealClassByOop', oop: el.getAttribute('data-reveal-oop') };
      },
    },
    {
      attr: 'data-goto',
      build: function (el) {
        return { command: 'goTo', index: Number(el.getAttribute('data-goto')) };
      },
    },
    {
      attr: 'data-expand',
      build: function (el) {
        return {
          command: 'expand',
          classOop: el.getAttribute('data-expand'),
          className: el.getAttribute('data-class-name'),
          // Which object's referrers this group is. A group box on the graph belongs to
          // the object it points at, not necessarily to the centre.
          ownerOop: el.getAttribute('data-expand-of'),
        };
      },
    },
    {
      attr: 'data-inspect-target',
      build: function () {
        return { command: 'inspectTarget' };
      },
    },
  ];

  function wire(doc, vscode) {
    // One delegated listener rather than a listener per control: a class Object scan draws
    // 20 nodes over a table of 284 rows, each with its own buttons, and an expanded class
    // adds up to a hundred more.
    function dispatch(target) {
      if (!target || !target.closest) return false;
      for (var i = 0; i < ROUTES.length; i++) {
        var el = target.closest('[' + ROUTES[i].attr + ']');
        if (el) {
          vscode.postMessage(ROUTES[i].build(el));
          return true;
        }
      }
      return false;
    }

    doc.addEventListener('click', function (event) {
      dispatch(event.target);
    });

    // Keyboard parity: the SVG groups carry tabindex and the rest are real buttons, which
    // already fire click on Enter and Space. The groups do not, so they are handled here.
    doc.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var el = event.target;
      if (!el || !el.closest) return;
      if (el.tagName === 'BUTTON') return; // the browser will synthesise a click
      if (dispatch(el)) event.preventDefault();
    });

    // Suppress the default webview context menu. Nothing on this page is editable and
    // nothing is meant to be cut or pasted into it, so Cut/Copy/Paste is three commands
    // that either do nothing or silently mangle a read-only view. VS Code only offers them
    // when the page leaves the contextmenu event unhandled.
    doc.addEventListener('contextmenu', function (event) {
      event.preventDefault();
    });

    // Bring the expanded class into view. The host re-renders the whole document on every
    // action, which resets the scroll to the top — so expanding a class from a node in the
    // diagram used to look like nothing had happened at all, because the rows it opened
    // were below the fold. Guarded because jsdom does not implement scrollIntoView.
    var opened = doc.querySelector('tr.row.open');
    if (opened && typeof opened.scrollIntoView === 'function') {
      opened.scrollIntoView({ block: 'center' });
    }
  }

  var root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.ObjectGraphView = { wire: wire };

  // In the live webview, bootstrap against the real vscode API. In tests,
  // acquireVsCodeApi is undefined, so the module just exposes `wire`.
  if (typeof acquireVsCodeApi === 'function') {
    wire(document, acquireVsCodeApi());
  }
})();
