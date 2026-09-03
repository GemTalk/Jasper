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
 *   data-add-oop            -> { command: 'addToCanvas', oop }
 *   data-remove-oop         -> { command: 'removeFromCanvas', oop }
 *   data-remove-group       -> { command: 'removeGroup', ownerOop, className }
 *   data-clear-canvas       -> { command: 'clearCanvas' }
 *
 * Two gestures never leave the view at all, because they decorate the drawing rather than
 * change the walk: clicking an edge selects it, and `data-edge-hide` trims one out.
 *
 * Dragging a box is a third case, and a mixed one: the movement is local, but the position
 * has to outlive the next redraw, so on release it goes up as
 * `{ command: 'moveBox', boxId, x, y }` and `[data-reset-layout]` clears them all.
 *   data-focus-oop          -> { command: 'focusNode', oop }
 *
 * Exposed as the global `ObjectGraphView` so both the webview (classic <script>) and tests
 * (new Function(source)()) can reach `wire`.
 */
(function () {
  // Order is NOT significant: dispatch walks outward from the clicked element and takes
  // the first element carrying any of these, so nesting decides which control fires. Two
  // attributes on the SAME element would be broken by this order, and none are.
  var ROUTES = [
    {
      attr: 'data-add-oop',
      build: function (el) {
        return { command: 'addToCanvas', oop: el.getAttribute('data-add-oop') };
      },
    },
    {
      attr: 'data-remove-group',
      build: function (el) {
        var pair = el.getAttribute('data-remove-group').split('|');
        return { command: 'removeGroup', ownerOop: pair[0], className: pair.slice(1).join('|') };
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
  ];

  function wire(doc, vscode) {
    // One delegated listener rather than a listener per control: a class Object scan draws
    // 20 nodes over a table of 284 rows, each with its own buttons, and an expanded class
    // adds up to a hundred more.
    // Walks OUTWARD from what was clicked and takes the first element carrying any route
    // attribute — so the innermost control always wins and the order of ROUTES cannot
    // decide it.
    //
    // This replaced a loop that tried each route's `closest` in list order, which made the
    // list load-bearing in a way nothing announced: a control nested inside a bigger click
    // target was shadowed unless it happened to be listed first. It bit three times — the
    // × turning into a re-centre, then the magnifier doing the same, then the magnifier on
    // a box that was itself removable. Nesting is the thing that should decide, and now it
    // is the thing that does.
    function dispatch(target) {
      var el = target;
      while (el && el.hasAttribute) {
        for (var i = 0; i < ROUTES.length; i++) {
          if (el.hasAttribute(ROUTES[i].attr)) {
            vscode.postMessage(ROUTES[i].build(el));
            return true;
          }
        }
        el = el.parentElement;
      }
      return false;
    }

    // Selecting an edge to follow, and hiding one to unclutter, are local visual matters —
    // they change nothing about the walk, so they are handled here and cost no round trip.
    // Both are checked before dispatch, because neither may post a message.
    function clearHighlight() {
      var all = doc.querySelectorAll('[data-edge].hl');
      for (var i = 0; i < all.length; i++) all[i].classList.remove('hl');
      var svgs = doc.querySelectorAll('svg.dim');
      for (var j = 0; j < svgs.length; j++) svgs[j].classList.remove('dim');
    }

    // Hidden lines are recoverable two ways: this bar, and any change to the graph, which
    // re-renders from scratch. An edge is a fact about the repository — hiding trims the
    // drawing, never the graph — so nothing is lost either way.
    function refreshEdgeBar() {
      var bar = doc.getElementById('edgebar');
      var count = doc.querySelectorAll('[data-edge].hidden').length;
      if (!bar) return;
      if (count === 0) {
        bar.setAttribute('hidden', '');
        return;
      }
      bar.removeAttribute('hidden');
      var label = doc.getElementById('edgecount');
      if (label) label.textContent = String(count);
    }

    function hideEdge(el) {
      var btn = el.closest && el.closest('[data-edge-hide]');
      if (!btn) return false;
      var wrap = btn.closest('[data-edge]');
      if (!wrap) return false;
      wrap.classList.add('hidden');
      clearHighlight();
      refreshEdgeBar();
      return true;
    }

    function highlight(el) {
      var wrap = el.closest && el.closest('[data-edge]');
      if (!wrap) return false;
      var svg = wrap.ownerSVGElement || wrap.closest('svg');
      var already = wrap.classList.contains('hl');
      clearHighlight();
      if (!already) {
        wrap.classList.add('hl');
        if (svg) svg.classList.add('dim');
      }
      return true;
    }

    // ── Dragging a box ────────────────────────────────────────────────────────────
    //
    // The drag itself is local: the box gets a transform and follows the pointer. Only on
    // release does the position go to the host, which stores it and re-renders — so the
    // edges are re-routed by the ONE layout that already knows how, rather than by a
    // second copy of that logic here. They therefore hold still during the drag and snap
    // when it ends, which is the trade for not duplicating the router.
    //
    // The svg is drawn 1:1 with its viewBox, so a pointer delta in CSS pixels is the same
    // delta in diagram units and no coordinate transform is needed.
    var drag = null;
    var DRAG_THRESHOLD = 3;

    doc.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) return;
      var el = event.target;
      if (!el || !el.closest) return;
      // Only the grip drags. Starting from "anywhere that is not a control" left a group
      // box ungrabbable — its header fills the top and its rows fill the rest, and both
      // are controls — so the handle is now the single place a move begins.
      if (!el.closest('[data-drag-handle]')) return;
      var box = el.closest('g[data-box]');
      if (!box) return;
      drag = {
        box: box,
        id: box.getAttribute('data-box'),
        x0: Number(box.getAttribute('data-bx')),
        y0: Number(box.getAttribute('data-by')),
        px: event.clientX,
        py: event.clientY,
        moved: false,
      };
    });

    doc.addEventListener('pointermove', function (event) {
      if (!drag) return;
      var dx = event.clientX - drag.px;
      var dy = event.clientY - drag.py;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      drag.box.classList.add('dragging');
      drag.box.setAttribute('transform', 'translate(' + dx + ',' + dy + ')');
    });

    doc.addEventListener('pointerup', function (event) {
      if (!drag) return;
      var d = drag;
      drag = null;
      d.box.classList.remove('dragging');
      if (!d.moved) return;
      // Suppress the click this press would otherwise produce: a drag must not also focus
      // the object it moved.
      suppressClick = true;
      vscode.postMessage({
        command: 'moveBox',
        boxId: d.id,
        x: Math.max(0, d.x0 + (event.clientX - d.px)),
        y: Math.max(0, d.y0 + (event.clientY - d.py)),
      });
    });

    var suppressClick = false;

    doc.addEventListener('click', function (event) {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      var el = event.target;
      // The grip is inside a box that also carries data-focus-oop, so a click on it would
      // otherwise fall through and re-centre on the object just moved.
      if (el && el.closest && el.closest('[data-drag-handle]')) return;
      if (el && el.closest && el.closest('[data-reset-layout]')) {
        vscode.postMessage({ command: 'resetLayout' });
        return;
      }
      if (el && el.closest && el.closest('[data-restore-removed]')) {
        vscode.postMessage({ command: 'restoreRemoved' });
        return;
      }
      if (el && el.id === 'restoreedges') {
        var hidden = doc.querySelectorAll('[data-edge].hidden');
        for (var i = 0; i < hidden.length; i++) hidden[i].classList.remove('hidden');
        refreshEdgeBar();
        return;
      }
      if (hideEdge(el)) return;
      if (highlight(el)) return;
      // Anything else clears the selection. Clicking away from a line should let go of it,
      // and a click that does reach the host re-renders anyway.
      clearHighlight();
      dispatch(el);
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
