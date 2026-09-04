/**
 * Column-strip model (miller columns) shared by the inspector webviews — the
 * Enhanced Inspector and the basic tabbed Inspector both drive their strip
 * through this.
 *
 * Like methodListView.js / listFilter.js, this is read at runtime via
 * fs.readFileSync and injected into the webview as a <script> tag — it is NOT
 * compiled into the bundle. It lives in its own file so the strip's
 * display/business decisions can be unit-tested in jsdom
 * (see millerColumns.test.ts) instead of being trapped in the inline
 * webview <script>.
 *
 * The decisions this module owns:
 *  - Drilling is ADDITIVE and never replaces. A drilled row opens its own
 *    column IMMEDIATELY to the right of the source it came from, shoving later
 *    columns rightward, so the parent→child lineage reads left-to-right.
 *  - Each column is INDEPENDENT: closing one removes only that column (never its
 *    neighbors); closing the last one asks the host to dispose the whole panel.
 *  - Focus tracks the focused column and drives the panel title (setTitle).
 *  - Width: a new column inherits its source column's width as a flex-basis and
 *    grows to fill spare space; a manual resize PINS it to an exact width.
 *
 * Rendering (headers, tabs, tables, trees, meta) stays in the inline script and
 * is supplied here via the injected `buildColumnDom` and `populate` callbacks,
 * so this model has no dependency on how a column's content is drawn. Likewise
 * the per-column state a renderer needs — caches, active tab, widths — comes
 * from the injected `makeState` callback, so the two inspectors keep their own
 * column shapes and neither has to carry the other's fields.
 *
 * Exposed as the global `MillerColumns` so both the webviews (classic <script>)
 * and tests (new Function(source)()) can reach it.
 */
(function () {
  // opts: { strip, postMessage, defaultWidth, minWidth, buildColumnDom, populate,
  //         makeState }
  //  - buildColumnDom(col) -> rootEl, and sets col.el (at least { root }).
  //  - populate(col, msg)  -> fills the column's content (no-op-able in tests).
  //  - makeState()         -> the renderer's own per-column fields, merged into
  //                           the descriptor. Optional; omit for a bare column.
  function createColumnStrip(opts) {
    var strip = opts.strip;
    var postMessage = opts.postMessage;
    var defaultWidth = opts.defaultWidth;
    var minWidth = opts.minWidth;
    var buildColumnDom = opts.buildColumnDom;
    var populate = opts.populate;
    var makeState = opts.makeState;

    var columns = []; // ordered array of column descriptors (left→right)
    var columnsById = {}; // id -> descriptor
    var focusedColumnId = null;

    // The fields the MODEL owns. Everything else on a descriptor belongs to the
    // renderer and arrives via makeState, which cannot overwrite these.
    function makeDescriptor(id, oop, width) {
      var col = {};
      if (makeState) {
        var state = makeState();
        for (var k in state) {
          if (Object.prototype.hasOwnProperty.call(state, k)) col[k] = state[k];
        }
      }
      col.id = id;
      col.oop = oop;
      col.width = width;
      col.className = '';
      col.label = '';
      col.title = '';
      col.el = null;
      return col;
    }

    function get(id) {
      return columnsById[id];
    }

    function columnOf(elem) {
      var colEl = elem && elem.closest ? elem.closest('.column') : null;
      return colEl ? columnsById[colEl.dataset.colId] : null;
    }

    // Attach a freshly-built column: seed its flex-basis width and index it.
    function register(col, root) {
      root.style.flexBasis = col.width + 'px';
      columnsById[col.id] = col;
    }

    function removeColumns(cols) {
      cols.forEach(function (c) {
        if (c.el && c.el.root) c.el.root.remove();
        delete columnsById[c.id];
      });
    }

    // Root column (top-level Inspect It / debugger var-inspect): replaces the
    // whole strip with a single column.
    function addRoot(msg) {
      removeColumns(columns.splice(0));
      var col = makeDescriptor(msg.columnId, msg.oop, defaultWidth);
      var root = buildColumnDom(col);
      register(col, root);
      strip.appendChild(root);
      columns.push(col);
      populate(col, msg);
      focus(col, true);
      return col;
    }

    // Drilled column: additive, inserted immediately to the right of its source
    // (never replaces). Inherits the source column's width. If the source is
    // gone (closed mid-flight), falls back to appending at the far right.
    function addChild(msg) {
      var source = columnsById[msg.sourceColumnId];
      var width = (source && source.width) || defaultWidth;
      var col = makeDescriptor(msg.columnId, msg.oop, width);
      var root = buildColumnDom(col);
      register(col, root);
      var srcIndex = source ? columns.indexOf(source) : -1;
      if (srcIndex === -1) {
        strip.appendChild(root);
        columns.push(col);
      } else {
        strip.insertBefore(root, source.el.root.nextSibling);
        columns.splice(srcIndex + 1, 0, col);
      }
      populate(col, msg);
      if (root.scrollIntoView) root.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      focus(col, true);
      return col;
    }

    // Close ONE column (independent): remove only it. When the last column goes,
    // ask the host to dispose the whole panel. Otherwise focus the neighbor.
    function close(col) {
      var idx = columns.indexOf(col);
      if (idx === -1) return;
      removeColumns(columns.splice(idx, 1));
      if (columns.length === 0) {
        postMessage({ command: 'closePanel' });
        return;
      }
      focus(columns[Math.min(idx, columns.length - 1)], true);
    }

    function focus(col, force) {
      if (!col) return;
      if (!force && focusedColumnId === col.id) return;
      focusedColumnId = col.id;
      columns.forEach(function (c) {
        if (c.el && c.el.root) c.el.root.classList.toggle('focused', c === col);
      });
      postMessage({ command: 'setTitle', title: col.title || col.className || '' });
    }

    // Pin a column to an exact width (stop it growing/shrinking) so a manual
    // resize sticks while the other columns keep filling the strip.
    function pinWidth(col, px) {
      var w = Math.max(minWidth, px);
      var root = col.el.root;
      root.style.flexGrow = '0';
      root.style.flexShrink = '0';
      root.style.flexBasis = w + 'px';
      col.width = w;
      return w;
    }

    return {
      columns: columns,
      get: get,
      columnOf: columnOf,
      addRoot: addRoot,
      addChild: addChild,
      close: close,
      focus: focus,
      pinWidth: pinWidth,
      focusedId: function () {
        return focusedColumnId;
      },
    };
  }

  var root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.MillerColumns = { createColumnStrip: createColumnStrip };
})();
