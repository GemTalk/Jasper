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
 *   data-focus-oop          -> { command: 'focusNode', oop }
 *   data-reset-layout       -> { command: 'resetLayout' }
 *   data-restore-removed    -> { command: 'restoreRemoved' }
 *
 * Two gestures never leave the view at all, because they decorate the drawing rather than
 * change the walk: clicking an edge selects it, and `data-edge-hide` trims one out.
 *
 * The one thing kept between renders is where you were looking: the horizontal scroll of
 * the graph, and which object the last action grew the picture from. Both live in the
 * webview's own store rather than in the walk, because they describe the viewport and not
 * the graph — see the note above the scroll handling in `wire`.
 *
 * Dragging a box is a third case, and a mixed one: the movement is local, but the position
 * has to outlive the next redraw, so on release it goes up as
 * `{ command: 'moveBox', boxId, x, y }` and `[data-reset-layout]` clears them all.
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

  // Actions that add boxes. A referrer is drawn one column OUT from the object it points
  // at, so every one of these makes the picture wider to the right.
  var GROWS = { focusNode: 1, addToCanvas: 1, dive: 1 };

  function wire(doc, vscode) {
    // ── Keeping your place when the picture grows ────────────────────────────────
    //
    // The host re-renders the whole document on every action, so the graph wrapper comes
    // back scrolled hard left. On a picture already wider than the panel that put the new
    // boxes -- the only thing you actually asked for -- off the right-hand edge, and the
    // click read as having done nothing at all.
    //
    // Two rules. An action that GROWS the graph scrolls the object it grew from to the
    // left edge, which is precisely where its new column is visible beside it. Anything
    // else keeps the scroll you already had. The state rides in the webview's own store,
    // which survives the host replacing the HTML; a `vscode` without one -- the stub the
    // tests pass -- simply gets neither behaviour.
    function readState() {
      if (!vscode || typeof vscode.getState !== 'function') return {};
      return vscode.getState() || {};
    }

    function remember(patch) {
      if (!vscode || typeof vscode.setState !== 'function') return;
      var next = readState();
      for (var k in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) next[k] = patch[k];
      }
      vscode.setState(next);
    }

    // Where the box holding this object sits. An object promoted onto the graph gets a box
    // of its own; one that is still only a row inside a class box has to answer with that
    // box, since the row has no x of its own. Oops are digit strings, so they go into an
    // attribute selector as they are.
    function boxLeftOf(oop) {
      // Digits only. This value came from a reply the stone streamed, and a stray quote in
      // it would throw SyntaxError out of querySelector -- which happens during wire(),
      // after the listeners are attached, so the page stays clickable while the scroll
      // handling silently never installs.
      if (!/^\d+$/.test(String(oop))) return null;
      var box = doc.querySelector('[data-box="o:' + oop + '"]');
      if (!box) {
        var row = doc.querySelector('[data-focus-oop="' + oop + '"]');
        box = row && row.closest ? row.closest('[data-box]') : null;
      }
      var x = box ? Number(box.getAttribute('data-bx')) : NaN;
      return isFinite(x) ? x : null;
    }
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
            var msg = ROUTES[i].build(el);
            remember({ growFrom: GROWS[msg.command] && msg.oop ? msg.oop : null });
            vscode.postMessage(msg);
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
    // The tooltip is a <title> put INTO the selected edge and taken out again when it is
    // let go. A <title> left on every edge would fire on any accidental sweep of the
    // pointer across the picture, which is the sort of chatter the dotted cross-links were
    // removed for; making it follow the selection means it only ever answers a line you
    // have deliberately picked. An edge with no data-tip -- a class box's, which stands for
    // many references and so has no one variable to name -- is given none.
    function tipOff(wrap) {
      var t = wrap.querySelector(':scope > title');
      if (t) wrap.removeChild(t);
    }

    function tipOn(wrap) {
      var text = wrap.getAttribute('data-tip');
      if (!text || wrap.querySelector(':scope > title')) return;
      var t = doc.createElementNS('http://www.w3.org/2000/svg', 'title');
      t.textContent = text;
      // First child: a <title> is the tooltip for its parent only when it leads it.
      wrap.insertBefore(t, wrap.firstChild);
    }

    function clearHighlight() {
      var all = doc.querySelectorAll('[data-edge].hl');
      for (var i = 0; i < all.length; i++) {
        all[i].classList.remove('hl');
        tipOff(all[i]);
      }
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
        tipOn(wrap);
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
      // A new press starts a new gesture, so a swallow left over from a drag that never
      // saw its click cannot eat an unrelated one later.
      suppressClick = false;
      if (event.button !== 0) return;
      var el = event.target;
      if (!el || !el.closest) return;
      // Only the grip drags. Starting from "anywhere that is not a control" left a group
      // box ungrabbable — its header fills the top and its rows fill the rest, and both
      // are controls — so the handle is now the single place a move begins.
      if (!el.closest('[data-drag-handle]')) return;
      var box = el.closest('g[data-box]');
      if (!box) return;
      // Capture, so the move and the release keep coming to us even once the pointer has
      // left the webview. Without it, releasing outside the frame left `drag` non-null and
      // the box glued to the pointer, and the next unrelated click committed a move the
      // user never made.
      if (typeof box.setPointerCapture === 'function') {
        try {
          box.setPointerCapture(event.pointerId);
        } catch (_e) {
          // Not fatal -- the buttons check below is the backstop.
        }
      }
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
      // The button went up somewhere we never heard about; drop the drag rather than
      // dragging on with nothing held.
      if (event.buttons === 0) {
        drag.box.classList.remove('dragging');
        drag.box.removeAttribute('transform');
        drag = null;
        return;
      }
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

    doc.addEventListener('pointercancel', function () {
      if (!drag) return;
      drag.box.classList.remove('dragging');
      drag.box.removeAttribute('transform');
      drag = null;
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

    // Read the saved scroll BEFORE wiring the listener, since restoring it fires one.
    var wrap = doc.querySelector('.graphwrap');
    if (wrap) {
      var saved = readState();
      var grewAt = saved.growFrom ? boxLeftOf(saved.growFrom) : null;
      // A margin, so the object you grew from is not flush against the panel edge.
      wrap.scrollLeft = grewAt === null ? saved.scrollLeft || 0 : Math.max(0, grewAt - 24);
      remember({ growFrom: null, scrollLeft: wrap.scrollLeft });
      // One listener rather than a save beside every postMessage: a drag, a reset and an
      // edge trimmed all redraw too, and all of them should land where you left off.
      wrap.addEventListener('scroll', function () {
        remember({ scrollLeft: wrap.scrollLeft });
      });
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
