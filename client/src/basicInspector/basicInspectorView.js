/**
 * Rendering for the basic tabbed Inspector's webview.
 *
 * Like millerColumns.js / debuggerView.js, this is read at runtime via
 * fs.readFileSync and injected as a <script> tag — it is NOT compiled into the
 * bundle. It lives in its own file so its display decisions can be unit-tested
 * in jsdom (see basicInspectorView.test.ts) instead of being trapped in the
 * inline webview <script>.
 *
 * The split with millerColumns.js: that module owns the column STRIP — order,
 * additive insert-right drilling, independent close, focus→title, width. This
 * module owns what is drawn INSIDE a column — the tab bar, the tables, paging,
 * the evaluation pane, the inline editor, the context menu — plus the per-column
 * history that Back and Forward walk.
 *
 * Exposed as the global `BasicInspectorView`.
 */
(function () {
  var strip, ctxMenu, vscode, PAGE_SIZE, Columns;
  var ctxTarget = null; // { columnId, oop, label, value, kind, index, keyOop, editable }

  // ── Small helpers ─────────────────────────

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function post(msg) {
    vscode.postMessage(msg);
  }

  /**
   * Which tabs an object gets, derived purely from its header. A tab never
   * appears for structure the object doesn't have, so an empty tab is never
   * something the user has to click to discover.
   *
   * Print, Meta and Evaluate are unconditional: every object can be printed, has
   * a class, and can be the receiver of an expression.
   */
  function tabsFor(header) {
    var tabs = [];
    if (!header) return [{ id: 'print', label: 'Print' }];
    if (header.namedSize > 0) tabs.push({ id: 'slots', label: 'Slots' });
    if (header.isDictionary && header.entryCount > 0)
      tabs.push({ id: 'entries', label: 'Entries' });
    if (!header.isDictionary && header.itemCount > 0) tabs.push({ id: 'items', label: 'Items' });
    if (header.isBytes) tabs.push({ id: 'bytes', label: 'Bytes' });
    tabs.push({ id: 'print', label: 'Print' });
    tabs.push({ id: 'meta', label: 'Meta' });
    tabs.push({ id: 'eval', label: 'Evaluate' });
    return tabs;
  }

  /** Total rows behind a paged tab, so the toolbar can say "N of M". */
  function totalFor(col, tab) {
    if (!col.header) return 0;
    if (tab === 'items') return col.header.itemCount;
    if (tab === 'entries') return col.header.entryCount;
    if (tab === 'bytes') return col.header.itemCount;
    return 0;
  }

  /**
   * The paging buttons a partially-loaded tab offers. "Load more" takes the
   * next page; "Load all" keeps going until the tab is complete — bounded by
   * the panel, which reads in pages and stops at a ceiling rather than holding
   * the session for a collection of a million elements. When it stops early the
   * toolbar simply still shows a remainder, and another click carries on.
   */
  function moreButtons(remaining) {
    return (
      '<button class="btn" data-more="page">Load more</button>' +
      '<button class="btn" data-more="all" title="Load the remaining ' +
      remaining +
      '">Load all</button>'
    );
  }

  /**
   * How the Slots tab is ordered, for the whole panel rather than one column —
   * it is a reading preference, not a fact about an object, so it should not
   * have to be set again after every dive.
   *
   * Alphabetical by default: the stone answers `allInstVarNames`, which is
   * superclass-first then definition order, and on a class of any size that is
   * an order you cannot search by eye. Definition order stays one click away
   * because it is the order the class is written in, which is the one that
   * matters when you are reading the class rather than a value. Nothing is lost
   * by sorting: each row carries the `instVarAt:` index it was read at, so
   * writes are unaffected and definition order is just that index ascending.
   */
  var slotSort = 'name';

  function sortSlots(rows) {
    return rows.sort(
      slotSort === 'name'
        ? function (a, b) {
            return String(a.label).localeCompare(String(b.label));
          }
        : function (a, b) {
            return a.index - b.index;
          },
    );
  }

  /** The write-kind for rows on a tab; null when the tab isn't editable. */
  function slotKindFor(tab) {
    if (tab === 'slots') return 'instvar';
    if (tab === 'items') return 'indexed';
    if (tab === 'entries') return 'entry';
    return null;
  }

  // ── Column DOM ────────────────────────────

  function createColumnDom(col) {
    var root = document.createElement('div');
    root.className = 'column';
    root.dataset.colId = col.id;
    root.innerHTML =
      '<div class="col-inner">' +
      '<div class="header">' +
      '<button class="nav-btn nav-back" title="Back to the previously inspected object">&#8249;</button>' +
      '<button class="nav-btn nav-fwd" title="Forward">&#8250;</button>' +
      '<span class="obj-class"></span>' +
      '<span class="obj-sep" style="display:none">&#8250;</span>' +
      '<span class="obj-label"></span>' +
      '<span class="header-oop"></span>' +
      '<span class="col-close" title="Close">&#215;</span>' +
      '</div>' +
      '<div class="tab-bar"></div>' +
      '<div class="content-pane"><div class="placeholder">Loading&#8230;</div></div>' +
      '</div>' +
      '<div class="col-resize-edge"></div>';
    col.el = {
      root: root,
      navBack: root.querySelector('.nav-back'),
      navFwd: root.querySelector('.nav-fwd'),
      objClass: root.querySelector('.obj-class'),
      objSep: root.querySelector('.obj-sep'),
      objLabel: root.querySelector('.obj-label'),
      headerOop: root.querySelector('.header-oop'),
      tabBar: root.querySelector('.tab-bar'),
      contentPane: root.querySelector('.content-pane'),
    };
    return root;
  }

  /**
   * Point a column at an object, and place that object in the column's history.
   *
   * The history is the list of objects this column has shown, with
   * `historyIndex` marking the one on screen. A dive truncates anything ahead of
   * the cursor and appends — the same "new branch discards the forward stack"
   * rule a browser's history follows. A Back or Forward step arrives with
   * `msg.remember` false because `navigate` has already moved the cursor; only
   * the very first load of a fresh column seeds the list.
   */
  function populateColumn(col, msg) {
    if (msg.remember) {
      col.history = col.history.slice(0, col.historyIndex + 1);
      col.history.push({ oop: msg.oop, label: msg.label || '' });
      col.historyIndex = col.history.length - 1;
    } else if (col.history.length === 0) {
      col.history = [{ oop: msg.oop, label: msg.label || '' }];
      col.historyIndex = 0;
    }
    col.oop = msg.oop;
    col.header = msg.header || null;
    col.label = msg.label || '';
    col.className = col.header ? col.header.className : '';
    // The editor tab is named for the OBJECT, exactly as the Enhanced
    // Inspector names it — its printString, capped. The label is whatever
    // opened this column, and after an Inspect It in a workspace that is the
    // whole expression you selected, which makes for a tab you cannot read and
    // cannot tell apart from the next one. It still has a home: the column
    // header, where "what produced this" is the useful thing to know.
    col.title = titleFor(col);
    col.activeTab = null;
    col.tabData = {};
    col.loadedRows = {};
    col.evalText = '';
    col.evalOut = null;
    col.metaSubTab = 'instanceMethods';
    col.metaRenderedSubTab = null;
    col.openSelector = null;
    col.methodSource = {};
    col.bytesRadix = 16;
    col.chordArmed = false;
    col.evalVarsRequested = false;
    col.editing = null;
    col.editError = null;

    var e = col.el;
    e.objClass.textContent = col.className;
    e.objSep.style.display = col.label ? '' : 'none';
    e.objLabel.textContent = col.label;
    e.objLabel.title = col.header ? col.header.printString : '';
    e.headerOop.textContent = 'oop ' + col.oop;
    renderNav(col);

    var tabs = tabsFor(col.header);
    e.tabBar.innerHTML = tabs
      .map(function (t) {
        return '<div class="tab" data-tab="' + t.id + '">' + esc(t.label) + '</div>';
      })
      .join('');
    activateTab(col, tabs[0].id);
  }

  /**
   * What the editor tab is called while this column has focus.
   *
   * Jadeite's own inspector caption is `'Jadeite Inspector on ', <class name>`,
   * plus `(N characters)` for a String and `(N bytes)` for a ByteArray — the
   * class, not the printString. That is the better answer for an editor tab:
   * a printString is as long as the object feels like being, is often nearly
   * identical between two objects of the same class, and after an Inspect It in
   * a workspace it is the least recognisable thing on the tab strip. The class
   * name is short, stable, and the thing you are actually looking for when
   * picking one of six open inspectors out of the strip.
   *
   * The size suffix follows Jadeite exactly, for the two classes where the size
   * is the fact you want without opening anything.
   */
  function titleFor(col) {
    var name = col.className || '';
    if (!col.header || !col.header.sizeUnit) return name;
    return name + ' (' + col.header.itemCount + ' ' + col.header.sizeUnit + ')';
  }

  function renderNav(col) {
    col.el.navBack.disabled = col.historyIndex <= 0;
    col.el.navFwd.disabled = col.historyIndex >= col.history.length - 1;
  }

  /**
   * Step the column's history cursor and ask the host for whatever object lands
   * under it. `remember: false` on the way out, so the reply doesn't push the
   * object we just moved to back onto the list.
   */
  function navigate(col, delta) {
    var target = col.historyIndex + delta;
    if (target < 0 || target >= col.history.length) return;
    col.historyIndex = target;
    var entry = col.history[target];
    post({
      command: 'diveHere',
      columnId: col.id,
      oop: entry.oop,
      label: entry.label,
      remember: false,
    });
  }

  /** Show `oop` in this column, in place, recording it in the column's history. */
  function dive(col, oop, label) {
    post({ command: 'diveHere', columnId: col.id, oop: oop, label: label, remember: true });
  }

  // ── Tabs ──────────────────────────────────

  function activateTab(col, tab) {
    col.activeTab = tab;
    var tabEls = col.el.tabBar.querySelectorAll('.tab');
    for (var i = 0; i < tabEls.length; i++) {
      tabEls[i].classList.toggle('active', tabEls[i].dataset.tab === tab);
    }
    if (tab === 'eval') {
      renderEval(col);
      return;
    }
    if (col.tabData[tab] !== undefined) {
      renderTab(col);
      return;
    }
    col.el.contentPane.innerHTML = '<div class="placeholder">Loading&#8230;</div>';
    post({ command: 'fetchTab', columnId: col.id, oop: col.oop, tab: tab, from: 1 });
  }

  function renderTab(col) {
    var tab = col.activeTab;
    var pane = col.el.contentPane;
    var data = col.tabData[tab];
    if (data === undefined || data === null) {
      pane.innerHTML = '<div class="placeholder">Nothing to show.</div>';
      return;
    }
    if (tab === 'print') renderText(pane, data);
    else if (tab === 'meta') renderMeta(col, pane, data);
    else if (tab === 'bytes') renderBytes(col, pane, data);
    else renderRows(col, pane, data);
  }

  function renderText(pane, text) {
    pane.innerHTML = '';
    var div = document.createElement('div');
    div.className = 'detail-value';
    div.textContent = text;
    pane.appendChild(div);
  }

  // ── Row tables (Slots / Items / Entries) ──

  function renderRows(col, pane, rows) {
    var tab = col.activeTab;
    var labelHead = tab === 'entries' ? 'Key' : tab === 'items' ? 'Index' : 'Name';
    var total = totalFor(col, tab);
    var html = '';

    // Sorting in place keeps `data-row` pointing at the same row the user sees;
    // every action on a row goes through this array.
    if (tab === 'slots') sortSlots(rows);
    if (total > rows.length) {
      html +=
        '<div class="toolbar"><span class="toolbar-label">Showing ' +
        rows.length +
        ' of ' +
        total +
        '</span>' +
        moreButtons(total - rows.length) +
        '</div>';
    }
    html += '<div class="table-wrap"><table class="rows"><thead><tr>';
    // On Slots the Name header is the sort control, the way a table's header
    // usually is — no separate row of buttons above the table to spend space on.
    html +=
      '<th class="cell-label' +
      (tab === 'slots'
        ? ' sortable" data-slot-sort="1" title="Sort by name, or by the order the classes declare them'
        : '') +
      '">' +
      labelHead +
      (tab === 'slots'
        ? '<span class="sort-mark">' + (slotSort === 'name' ? '\u25B4' : '\u2261') + '</span>'
        : '') +
      '</th><th>Value</th><th class="cell-class">Class</th></tr></thead><tbody>';

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      html +=
        '<tr data-row="' +
        i +
        '">' +
        '<td class="cell-label" title="' +
        esc(r.label) +
        '">' +
        esc(r.label) +
        '</td>' +
        '<td class="cell-value' +
        (r.revertible ? ' cell-edited' : '') +
        '" title="' +
        esc(r.value) +
        '">' +
        (r.revertible
          ? '<button class="revert-btn" data-revert="' +
            i +
            '" title="Restore the original value">&#8634;</button> '
          : '') +
        esc(r.value) +
        '</td>' +
        '<td class="cell-class">' +
        esc(r.className) +
        '</td>' +
        '</tr>';
    }
    if (total > rows.length) {
      html +=
        '<tr class="load-more-row" data-more="page"><td colspan="3">Load ' +
        Math.min(PAGE_SIZE, total - rows.length) +
        ' more&#8230;</td></tr>';
    }
    html += '</tbody></table></div>';
    if (col.editError) html += '<div class="edit-error">' + esc(col.editError) + '</div>';
    pane.innerHTML = html;
  }

  /**
   * Open the inline editor on a row. The typed expression is evaluated with the
   * inspected object as `self`, so `self class` and the object's own instance
   * variables are all in scope.
   */
  function beginEdit(col, rowIndex) {
    var kind = slotKindFor(col.activeTab);
    var rows = col.tabData[col.activeTab];
    if (!kind || !rows || !rows[rowIndex]) return;
    var row = rows[rowIndex];
    if (kind !== 'entry' && !row.index) return; // unwritable slot

    var cell = col.el.contentPane.querySelector('tr[data-row="' + rowIndex + '"] .cell-value');
    if (!cell) return;
    col.editing = { rowIndex: rowIndex, kind: kind, index: row.index, keyOop: row.keyOop };
    cell.innerHTML = '<input class="row-editor" type="text">';
    var input = cell.querySelector('.row-editor');
    input.value = row.value;
    input.select();
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        // Stop here. `commitEdit` clears `col.editing`, so by the time this
        // Enter reached the strip's own handler that guard would be down and
        // the keystroke would be read as "dive into the selected row" — editing
        // a Character of a String would commit the write and then replace the
        // column with an inspector on the Character.
        ev.preventDefault();
        ev.stopPropagation();
        commitEdit(col, input.value);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        cancelEdit(col);
      }
    });
    input.addEventListener('blur', function () {
      if (col.editing) cancelEdit(col);
    });
  }

  function commitEdit(col, expression) {
    var edit = col.editing;
    if (!edit) return;
    col.editing = null;
    col.editError = null;
    post({
      command: 'setSlot',
      columnId: col.id,
      oop: col.oop,
      kind: edit.kind,
      index: edit.index,
      keyOop: edit.keyOop,
      expression: expression,
    });
  }

  function cancelEdit(col) {
    col.editing = null;
    renderTab(col);
  }

  /** A write landed: every printString and OOP on the tab is stale, so refetch. */
  function refetchActiveTab(col) {
    col.tabData[col.activeTab] = undefined;
    col.loadedRows[col.activeTab] = 0;
    activateTab(col, col.activeTab);
  }

  // ── Bytes ─────────────────────────────────

  /**
   * A byte dump of the object's raw storage: the 1-based index of the first
   * byte on each line, sixteen byte values, then those bytes read as text with
   * anything unprintable shown as a dot.
   *
   * The index column is what ties a line back to the object: the byte under
   * column `n` of the line labelled `i` is `obj _basicAt: i + n`, which is the
   * read the panel made to get it. It is printed in plain decimal against a
   * column header, because a zero-padded number beside a field of hex reads as
   * a hex offset, and then the whole line is a puzzle.
   *
   * Hex is the default because two fixed characters per byte is what makes the
   * columns line up under the header; `Dec` shows the same values as the
   * integers they are. The choice is per column and costs no round trip — the
   * bytes are already here, only their formatting changes.
   */
  function renderBytes(col, pane, bytes) {
    var radix = col.bytesRadix === 10 ? 10 : 16;
    var width = radix === 16 ? 2 : 3;
    var total = totalFor(col, 'bytes');
    var head = padStart('Index', INDEX_WIDTH) + ' ';
    for (var c = 0; c < BYTES_PER_LINE; c++) {
      head += ' ' + padStart(c.toString(radix), width);
    }
    head += '  Text';

    var lines = [];
    for (var i = 0; i < bytes.length; i += BYTES_PER_LINE) {
      var values = '';
      var text = '';
      for (var j = 0; j < BYTES_PER_LINE; j++) {
        if (i + j < bytes.length) {
          var b = bytes[i + j];
          values += ' ' + padStart(b.toString(radix), width);
          text += b >= 32 && b < 127 ? String.fromCharCode(b) : '.';
        } else {
          values += padStart('', width + 1);
        }
      }
      lines.push(
        '<span class="off">' +
          padStart(String(i + 1), INDEX_WIDTH) +
          '</span> ' +
          values +
          '  <span class="txt">' +
          esc(text) +
          '</span>',
      );
    }

    pane.innerHTML =
      '<div class="toolbar">' +
      '<span class="toolbar-label">Showing ' +
      bytes.length +
      ' of ' +
      total +
      ' bytes</span>' +
      (total > bytes.length ? moreButtons(total - bytes.length) : '') +
      '<span class="toolbar-gap"></span>' +
      '<button class="btn' +
      (radix === 16 ? ' active' : '') +
      '" data-radix="16" title="Show each byte in hexadecimal">Hex</button>' +
      '<button class="btn' +
      (radix === 10 ? ' active' : '') +
      '" data-radix="10" title="Show each byte as the integer it is">Dec</button>' +
      '</div>' +
      '<div class="bytes">' +
      (lines.length
        ? '<div class="bytes-head">' + head + '</div>' + lines.join('<br>')
        : 'No bytes.') +
      '</div>';
  }

  /** Bytes shown per dump line, and the width the index column is aligned to. */
  var BYTES_PER_LINE = 16;
  var INDEX_WIDTH = 7;

  function padStart(s, width) {
    s = String(s);
    while (s.length < width) s = ' ' + s;
    return s;
  }

  // ── Meta ──────────────────────────────────

  /**
   * The Meta tab, laid out as the Enhanced Inspector lays its own out, so the
   * two do not present the same facts in two different shapes: the class name,
   * an info bar carrying superclass, package and OOP, and then a sub-tab bar
   * over the one thing you asked to see.
   *
   * Definition and Comment are sub-tabs there rather than sections stacked
   * above the selectors, which is what this used to be — and stacking them cost
   * the selector list its screen: a class with a real comment pushed every
   * method below the fold. Category is the "Package" field of the info bar, not
   * a section, for the same reason.
   */
  function renderMeta(col, pane, meta) {
    if (!meta) {
      pane.innerHTML = '<div class="placeholder">Class metadata unavailable.</div>';
      return;
    }
    var html =
      '<div class="meta">' +
      '<div class="meta-head">' +
      '<div class="meta-head-label">Class</div>' +
      '<div class="meta-class-name">' +
      esc(meta.className) +
      '</div>' +
      '</div>' +
      '<div class="meta-info-bar">' +
      metaFact('Superclass', meta.superclassName) +
      metaFact('Package', meta.category) +
      metaFact('OOP', col.oop) +
      '</div>' +
      '<div class="meta-sub-bar">';
    var subTabs = metaSubTabs(meta);
    for (var t = 0; t < subTabs.length; t++) {
      html +=
        '<div class="tab' +
        (col.metaSubTab === subTabs[t].id ? ' active' : '') +
        '" data-metatab="' +
        subTabs[t].id +
        '">' +
        esc(subTabs[t].label) +
        '</div>';
    }
    html += '</div><div class="meta-sub-content">' + renderMetaSubTab(col, meta) + '</div></div>';
    withMetaScrollKept(col, pane, html);
  }

  /** One `Label: value` cell of the info bar; an em dash when the stone had none. */
  function metaFact(label, value) {
    return '<span>' + esc(label) + ': <strong>' + esc(value || '\u2014') + '</strong></span>';
  }

  /**
   * The sub-tabs, in the Enhanced Inspector's order. The two method lists carry
   * their counts, because the number of selectors is the thing you most often
   * want from this tab without opening it.
   */
  function metaSubTabs(meta) {
    return [
      {
        id: 'instanceMethods',
        label: 'Instance Methods (' + meta.instanceSelectors.length + ')',
      },
      { id: 'classMethods', label: 'Class Methods (' + meta.classSelectors.length + ')' },
      { id: 'definition', label: 'Definition' },
      { id: 'comment', label: 'Comment' },
    ];
  }

  function renderMetaSubTab(col, meta) {
    if (col.metaSubTab === 'definition') {
      return '<pre class="meta-pre">' + esc(meta.definition || '') + '</pre>';
    }
    if (col.metaSubTab === 'comment') {
      return meta.comment
        ? '<pre class="meta-pre meta-comment">' + esc(meta.comment) + '</pre>'
        : '<div class="placeholder">No comment.</div>';
    }
    var isClassSide = col.metaSubTab === 'classMethods';
    var selectors = isClassSide ? meta.classSelectors : meta.instanceSelectors;
    if (!selectors.length) return '<div class="placeholder">No methods.</div>';
    var html = '<div class="method-list">';
    for (var i = 0; i < selectors.length; i++) {
      var sel = selectors[i];
      var open = col.openSelector === sel;
      html +=
        '<div class="method-item' +
        (open ? ' open' : '') +
        '" data-selector="' +
        esc(sel) +
        '">' +
        esc(sel) +
        '</div>';
      if (open) {
        var key = metaSourceKey(col, sel);
        html +=
          '<div class="method-source-box">' +
          esc(col.methodSource[key] === undefined ? 'Loading…' : col.methodSource[key]) +
          '</div>';
      }
    }
    return html + '</div>';
  }

  /** Which side a fetched source belongs to; a selector can exist on both. */
  function metaSourceKey(col, selector) {
    return (col.metaSubTab === 'classMethods' ? 'class' : 'instance') + ':' + selector;
  }

  /**
   * Redraw the Meta tab without throwing the reader back to the top.
   *
   * Opening a selector rebuilds the whole tab, and the rebuilt scroller starts
   * at offset zero — so the source you asked for appeared somewhere off screen
   * and the list you were reading was gone. The source box is inserted *below*
   * the selector clicked, so nothing above it moves and putting the old offset
   * back leaves the click where the user left it. Switching between Instance
   * and Class is a different list, and starts at the top as it should.
   */
  function withMetaScrollKept(col, pane, html) {
    // `.meta-sub-content` is the element that scrolls — `.meta` is the flex
    // column holding the fixed heading above it.
    var prev = pane.querySelector('.meta-sub-content');
    var keepTop = prev && col.metaRenderedSubTab === col.metaSubTab ? prev.scrollTop : 0;
    pane.innerHTML = html;
    col.metaRenderedSubTab = col.metaSubTab;
    var next = pane.querySelector('.meta-sub-content');
    if (next && keepTop) next.scrollTop = keepTop;
  }

  // ── Evaluate pane ─────────────────────────

  /**
   * The chord the pane answers to, and what each closing key runs.
   *
   * These are the editor's own bindings — `ctrl+k d` / `e` / `i` for Display,
   * Execute and Inspect It — so the keys that run an expression against the
   * stone are the same whether you typed it in a Smalltalk file or here against
   * `self`. The contributed ones cannot serve: all three are `when:
   * editorTextFocus`, which a focused webview never satisfies, and the commands
   * behind them read the active text editor for their code. So the pane
   * recognises the chord itself, which is what `chordArmed` below is for — and
   * because those bindings do not resolve here, the chord runs the pane's own
   * action rather than colliding with a command.
   *
   * `ctrl+k r`, Debug It, is deliberately absent. Debug It works by compiling
   * the expression and starting it with the single-step flag set, so the halt
   * on its first statement carries a process for the debugger to attach to. The
   * pane evaluates through `evaluateInContext:symbolList:`, an ordinary perform
   * that runs to completion — there is no halted process to hand over, so the
   * key would have nothing to open.
   */
  var EVAL_CHORD = { d: 'display', e: 'execute', i: 'inspect' };

  /** The chord prefix as this platform writes it, for buttons and the hint. */
  function chordLabel() {
    var platform = (typeof navigator !== 'undefined' && navigator.platform) || '';
    return platform.indexOf('Mac') === 0 ? 'Cmd+K' : 'Ctrl+K';
  }

  /**
   * The names the pane will type for you, grouped by the class that declares
   * them.
   *
   * Every one of these is in scope: `allInstVarNames` is the whole chain, so an
   * inherited instance variable is as writable here as one the class declares
   * itself — grouping under the declaring class is what makes that visible
   * rather than something you have to already know. The receiver comes first,
   * on its own, because `self` is the one name that is always there.
   *
   * Each row carries the class of the value currently in the slot, which is the
   * other half of what you need before sending it anything.
   */
  function evalVariableGroups(col) {
    var groups = [{ owner: 'Receiver', vars: [{ name: 'self', className: selfSummary(col) }] }];
    var rows = col.tabData.slots;
    if (!rows) return groups;
    // Declaration order, root class first, so the groups read down the chain
    // however the Slots tab itself happens to be sorted.
    var ordered = rows.slice().sort(function (a, b) {
      return a.index - b.index;
    });
    for (var i = 0; i < ordered.length; i++) {
      var owner = ordered[i].definingClass || col.className || '';
      var group = groups[groups.length - 1];
      if (group.owner !== owner) {
        group = { owner: owner, vars: [] };
        groups.push(group);
      }
      group.vars.push({ name: ordered[i].label, className: ordered[i].className });
    }
    return groups;
  }

  /**
   * How the receiver is described beside `self`: its class, and how much of it
   * there is.
   *
   * An Array or a String has no named instance variables at all, so the list
   * would otherwise be one row saying `self` and nothing else. The size is the
   * fact that makes the pane useful for those objects — it is what tells you
   * that `self at: 12` is a question you can ask, and what the answer to
   * `self size` is going to be before you ask it.
   */
  function selfSummary(col) {
    var name = col.className || '';
    var h = col.header;
    if (!h) return name;
    if (h.sizeUnit) return name + ' (' + countOf(h.itemCount, h.sizeUnit) + ')';
    if (h.isDictionary && h.entryCount) return name + ' (' + countOf(h.entryCount, 'entries') + ')';
    if (h.itemCount) return name + ' (' + countOf(h.itemCount, 'items') + ')';
    return name;
  }

  /** `1 item` rather than `1 items`; the plural forms all just lose the s. */
  function countOf(n, plural) {
    return n + ' ' + (n === 1 ? plural.replace(/s$/, '') : plural);
  }

  /**
   * Ask for the slot names the variables list is built from, once per column.
   * Only worth doing for an object that has named instance variables.
   */
  function ensureEvalVariables(col) {
    if (col.tabData.slots !== undefined) return;
    if (!col.header || !col.header.namedSize) return;
    if (col.evalVarsRequested) return;
    col.evalVarsRequested = true;
    post({ command: 'fetchTab', columnId: col.id, oop: col.oop, tab: 'slots', from: 1 });
  }

  function renderEvalVariables(col) {
    var groups = evalVariableGroups(col);
    var html = '<div class="eval-vars"><div class="eval-vars-list">';
    for (var g = 0; g < groups.length; g++) {
      html += '<div class="eval-var-owner">' + esc(groups[g].owner) + '</div>';
      for (var v = 0; v < groups[g].vars.length; v++) {
        var item = groups[g].vars[v];
        html +=
          '<div class="eval-var" data-var="' +
          esc(item.name) +
          '" title="' +
          esc(item.name + (item.className ? ' \u2014 ' + item.className : '')) +
          '. Click to insert into the expression.">' +
          '<span class="eval-var-name">' +
          esc(item.name) +
          '</span>' +
          '<span class="eval-var-class">' +
          esc(item.className) +
          '</span>' +
          '<button class="eval-var-copy" data-copy-var="' +
          esc(item.name) +
          '" title="Copy this name">&#128203;</button>' +
          '</div>';
      }
    }
    return html + '</div></div>';
  }

  function renderEval(col) {
    var pane = col.el.contentPane;
    var mod = chordLabel();
    // A chord left half-typed when the tab was switched away is not still
    // waiting for its second key when the pane comes back.
    col.chordArmed = false;
    pane.innerHTML =
      '<div class="eval">' +
      '<div class="toolbar">' +
      '<button class="btn" data-eval="display" title="' +
      mod +
      ' D">Display It</button>' +
      '<button class="btn" data-eval="execute" title="' +
      mod +
      ' E">Execute It</button>' +
      '<button class="btn" data-eval="inspect" title="' +
      mod +
      ' I">Inspect It</button>' +
      '<span class="eval-hint">' +
      mod +
      ' D &#183; E &#183; I</span>' +
      '</div>' +
      '<div class="eval-body">' +
      '<div class="eval-editor">' +
      // The clear button sits inside the box's own top-right corner and appears
      // only once there is something to clear — the affordance the debugger's
      // eval bar and the list filters already use.
      '<div class="eval-input-wrap">' +
      '<textarea class="eval-input" spellcheck="false"></textarea>' +
      '<button class="clear-btn" data-eval-clear="1" tabindex="-1" title="Clear">&#10005;</button>' +
      '</div>' +
      '<div class="eval-out' +
      (col.evalOut && !col.evalOut.ok ? ' error' : '') +
      '">' +
      esc(col.evalOut ? col.evalOut.text : '') +
      '</div>' +
      '</div>' +
      renderEvalVariables(col) +
      '</div>' +
      '</div>';
    ensureEvalVariables(col);
    var input = pane.querySelector('.eval-input');
    input.value = col.evalText;
    showClearWhenTyped(col);
    input.addEventListener('input', function () {
      col.evalText = input.value;
      showClearWhenTyped(col);
    });
    pane.querySelector('.eval').addEventListener('keydown', function (ev) {
      evalKeydown(col, ev);
    });
    input.addEventListener('blur', function () {
      disarmChord(col);
    });
  }

  /**
   * Half-typed chords are the reason this is a state machine rather than a
   * modifier test: the closing key of `Ctrl+K D` arrives on its own, and would
   * otherwise be a `d` typed into the expression. Anything that isn't a chord
   * key disarms and is typed as usual, so a stray Ctrl+K costs one keystroke
   * and never a swallowed character.
   */
  function evalKeydown(col, ev) {
    if (col.chordArmed) {
      disarmChord(col);
      var action = EVAL_CHORD[String(ev.key).toLowerCase()];
      if (!action) return;
      ev.preventDefault();
      ev.stopPropagation();
      runEval(col, action);
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && String(ev.key).toLowerCase() === 'k') {
      ev.preventDefault();
      ev.stopPropagation();
      armChord(col);
      return;
    }
    if (ev.key === 'Escape') {
      disarmChord(col);
      return;
    }
    // Ctrl+Enter stays as it was: the one-key way to see a result, for anyone
    // who never reaches for the chord.
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      runEval(col, 'display');
    }
  }

  function armChord(col) {
    col.chordArmed = true;
    setChordHint(col, chordLabel() + '&#8230;');
  }

  function disarmChord(col) {
    if (!col.chordArmed) return;
    col.chordArmed = false;
    setChordHint(col, chordLabel() + ' D &#183; E &#183; I');
  }

  function setChordHint(col, html) {
    var hint = col.el.contentPane.querySelector('.eval-hint');
    if (!hint) return;
    hint.innerHTML = html;
    hint.classList.toggle('armed', !!col.chordArmed);
  }

  /**
   * Drop a name into the expression at the caret, and keep the caret after it.
   * Typing is the point of the list, so focus goes back to the textarea rather
   * than staying on the name that was clicked.
   */
  function insertVariable(col, name) {
    var input = col.el.contentPane.querySelector('.eval-input');
    if (!input) return;
    var at = input.selectionStart === null ? input.value.length : input.selectionStart;
    var to = input.selectionEnd === null ? at : input.selectionEnd;
    input.value = input.value.slice(0, at) + name + input.value.slice(to);
    col.evalText = input.value;
    var caret = at + name.length;
    input.focus();
    input.setSelectionRange(caret, caret);
  }

  /**
   * Redraw only the variables list. The rest of the pane is left alone on
   * purpose: rebuilding it would swap out the textarea under a user who may be
   * mid-expression, taking their caret and focus with it.
   */
  function refreshEvalVariables(col) {
    var vars = col.el.contentPane.querySelector('.eval-vars');
    if (!vars) return;
    vars.outerHTML = renderEvalVariables(col);
  }

  /** The clear button is offered only when there is an expression to clear. */
  function showClearWhenTyped(col) {
    var wrap = col.el.contentPane.querySelector('.eval-input-wrap');
    if (wrap) wrap.classList.toggle('has-text', col.evalText.length > 0);
  }

  /** Empty the expression and whatever the last one answered. */
  function clearEval(col) {
    col.evalText = '';
    col.evalOut = null;
    renderEval(col);
    var input = col.el.contentPane.querySelector('.eval-input');
    if (input) input.focus();
  }

  function runEval(col, mode) {
    if (!col.evalText.trim()) return;
    post({
      command: 'evaluate',
      columnId: col.id,
      oop: col.oop,
      expression: col.evalText,
      mode: mode,
    });
  }

  // ── Context menu ──────────────────────────

  function rowContext(col, rowIndex) {
    var rows = col.tabData[col.activeTab];
    if (!rows || !rows[rowIndex]) return null;
    var row = rows[rowIndex];
    var kind = slotKindFor(col.activeTab);
    return {
      columnId: col.id,
      rowIndex: rowIndex,
      oop: row.oop,
      label: row.label,
      value: row.value,
      kind: kind,
      index: row.index,
      keyOop: row.keyOop,
      editable: !!kind && (kind === 'entry' ? !!row.keyOop : !!row.index),
    };
  }

  function showCtxMenu(x, y, target) {
    ctxTarget = target;
    var edit = ctxMenu.querySelector('[data-action="edit"]');
    if (edit) edit.style.display = target.editable ? '' : 'none';
    ctxMenu.style.display = 'block';
    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top = y + 'px';
  }

  function hideCtxMenu() {
    ctxMenu.style.display = 'none';
    ctxTarget = null;
  }

  function runCtxAction(action) {
    var t = ctxTarget;
    hideCtxMenu();
    if (!t) return;
    var col = Columns.get(t.columnId);
    if (action === 'inspect') {
      post({ command: 'inspectRow', sourceColumnId: t.columnId, oop: t.oop, label: t.label });
    } else if (action === 'dive') {
      if (col) dive(col, t.oop, t.label);
    } else if (action === 'edit') {
      if (col) beginEdit(col, t.rowIndex);
    } else if (action === 'copyValue') {
      post({ command: 'copyText', text: t.value, what: 'printString' });
    } else if (action === 'copyOop') {
      post({ command: 'copyText', text: String(t.oop), what: 'OOP' });
    } else if (action === 'browse') {
      post({ command: 'browseClass', oop: t.oop });
    }
  }

  // ── Event wiring ──────────────────────────

  function wireEvents() {
    strip.addEventListener('click', function (ev) {
      var col = Columns.columnOf(ev.target);
      if (!col) return;
      Columns.focus(col);

      if (ev.target.closest('.col-close')) {
        Columns.close(col);
        return;
      }
      if (ev.target.closest('.nav-back')) {
        navigate(col, -1);
        return;
      }
      if (ev.target.closest('.nav-fwd')) {
        navigate(col, 1);
        return;
      }
      // Only the column's own tab bar — the Meta tab's sub-tabs are styled with
      // the same class and would otherwise be caught here and activate nothing.
      var tab = ev.target.closest('.tab');
      if (tab && tab.parentElement === col.el.tabBar) {
        activateTab(col, tab.dataset.tab);
        return;
      }
      var revert = ev.target.closest('[data-revert]');
      if (revert) {
        var rows = col.tabData[col.activeTab];
        var row = rows && rows[Number(revert.dataset.revert)];
        if (row) {
          post({
            command: 'revertSlot',
            columnId: col.id,
            oop: col.oop,
            kind: slotKindFor(col.activeTab),
            index: row.index,
            keyOop: row.keyOop,
          });
        }
        return;
      }
      var more = ev.target.closest('[data-more]');
      if (more) {
        var loaded = col.loadedRows[col.activeTab] || 0;
        post({
          command: 'fetchTab',
          columnId: col.id,
          oop: col.oop,
          tab: col.activeTab,
          from: loaded + 1,
          all: more.dataset.more === 'all',
        });
        return;
      }
      if (ev.target.closest('[data-slot-sort]')) {
        slotSort = slotSort === 'name' ? 'definition' : 'name';
        renderTab(col);
        return;
      }
      var radix = ev.target.closest('[data-radix]');
      if (radix) {
        col.bytesRadix = Number(radix.dataset.radix);
        renderTab(col);
        return;
      }
      var metaTab = ev.target.closest('[data-metatab]');
      if (metaTab) {
        col.metaSubTab = metaTab.dataset.metatab;
        col.openSelector = null;
        renderTab(col);
        return;
      }
      var method = ev.target.closest('.method-item');
      if (method) {
        toggleMethod(col, method.dataset.selector);
        return;
      }
      var copyVar = ev.target.closest('[data-copy-var]');
      if (copyVar) {
        post({ command: 'copyText', text: copyVar.dataset.copyVar, what: 'Variable name' });
        return;
      }
      var useVar = ev.target.closest('[data-var]');
      if (useVar) {
        insertVariable(col, useVar.dataset.var);
        return;
      }
      if (ev.target.closest('[data-eval-clear]')) {
        clearEval(col);
        return;
      }
      var evalBtn = ev.target.closest('[data-eval]');
      if (evalBtn) {
        runEval(col, evalBtn.dataset.eval);
        return;
      }
    });

    // Double-click a row: drill into a NEW column to the right.
    strip.addEventListener('dblclick', function (ev) {
      var col = Columns.columnOf(ev.target);
      var tr = ev.target.closest ? ev.target.closest('tr[data-row]') : null;
      if (!col || !tr) return;
      var target = rowContext(col, Number(tr.dataset.row));
      if (target) {
        post({
          command: 'inspectRow',
          sourceColumnId: col.id,
          oop: target.oop,
          label: target.label,
        });
      }
    });

    strip.addEventListener('contextmenu', function (ev) {
      var col = Columns.columnOf(ev.target);
      var tr = ev.target.closest ? ev.target.closest('tr[data-row]') : null;
      if (!col || !tr) return;
      var target = rowContext(col, Number(tr.dataset.row));
      if (!target) return;
      ev.preventDefault();
      Columns.focus(col);
      showCtxMenu(ev.clientX, ev.clientY, target);
    });

    ctxMenu.addEventListener('click', function (ev) {
      var item = ev.target.closest('[data-action]');
      if (item) runCtxAction(item.dataset.action);
    });

    document.addEventListener('click', function (ev) {
      if (!ctxMenu.contains(ev.target)) hideCtxMenu();
    });

    // Enter dives in place — the Jadeite idiom, kept distinct from the
    // double-click that opens a new column.
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      // Enter inside any field belongs to that field, not to the row behind it.
      var tag = ev.target && ev.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      var col = Columns.get(Columns.focusedId());
      if (!col || col.editing) return;
      var tr = col.el.contentPane.querySelector('tr.selected[data-row]');
      if (!tr) return;
      var target = rowContext(col, Number(tr.dataset.row));
      if (target) dive(col, target.oop, target.label);
    });

    // Row selection, so Enter has something to act on.
    strip.addEventListener('mousedown', function (ev) {
      var tr = ev.target.closest ? ev.target.closest('tr[data-row]') : null;
      if (!tr) return;
      var body = tr.parentElement;
      for (var i = 0; i < body.children.length; i++) {
        body.children[i].classList.remove('selected');
      }
      tr.classList.add('selected');
    });
  }

  function toggleMethod(col, selector) {
    if (col.openSelector === selector) {
      col.openSelector = null;
      renderTab(col);
      return;
    }
    col.openSelector = selector;
    var key = metaSourceKey(col, selector);
    var isClassSide = col.metaSubTab === 'classMethods';
    renderTab(col);
    if (col.methodSource[key] === undefined) {
      post({
        command: 'fetchMethodSource',
        columnId: col.id,
        oop: col.oop,
        selector: selector,
        isClassSide: isClassSide,
      });
    }
  }

  // ── Host messages ─────────────────────────

  function handleHostMessage(msg) {
    var col;
    switch (msg.command) {
      case 'addRoot':
        Columns.addRoot(msg);
        return;
      case 'addChild':
        Columns.addChild(msg);
        return;
      case 'replaceColumn':
        col = Columns.get(msg.columnId);
        if (col) populateColumn(col, msg);
        return;
      case 'tabData':
        col = Columns.get(msg.columnId);
        if (!col) return;
        applyTabData(col, msg);
        return;
      case 'evalResult':
        col = Columns.get(msg.columnId);
        if (!col) return;
        col.evalOut = { ok: msg.ok, text: msg.text };
        if (col.activeTab === 'eval') renderEval(col);
        return;
      case 'setSlotResult':
        col = Columns.get(msg.columnId);
        if (!col) return;
        col.editError = msg.ok ? null : msg.error;
        // A write leaves every printString and OOP on the tab stale, so refetch.
        // A failure changed nothing on the stone — just redraw, which closes the
        // inline editor and surfaces the error.
        if (msg.ok) refetchActiveTab(col);
        else renderTab(col);
        return;
      case 'methodSource':
        col = Columns.get(msg.columnId);
        if (!col) return;
        col.methodSource[(msg.isClassSide ? 'class' : 'instance') + ':' + msg.selector] =
          msg.source;
        if (col.activeTab === 'meta') renderTab(col);
        return;
    }
  }

  /** Merge a page into the tab's accumulated data, then draw it. */
  function applyTabData(col, msg) {
    if (msg.tab === 'print') {
      col.tabData.print = msg.text;
    } else if (msg.tab === 'meta') {
      col.tabData.meta = msg.meta;
    } else if (msg.tab === 'bytes') {
      var bytes = msg.from > 1 ? (col.tabData.bytes || []).concat(msg.bytes) : msg.bytes;
      col.tabData.bytes = bytes;
      col.loadedRows.bytes = bytes.length;
    } else {
      var rows = msg.from > 1 ? (col.tabData[msg.tab] || []).concat(msg.rows) : msg.rows;
      col.tabData[msg.tab] = rows;
      col.loadedRows[msg.tab] = rows.length;
    }
    if (col.activeTab === msg.tab) renderTab(col);
    // The evaluation pane builds its variables list out of the Slots rows, so
    // a page that lands while it is open fills that list in.
    else if (col.activeTab === 'eval' && msg.tab === 'slots') refreshEvalVariables(col);
  }

  // ── Init ──────────────────────────────────

  function init(opts) {
    // Panel-wide display state starts at its default for each new panel. The
    // module is loaded once per webview, so this is the panel's own slate.
    slotSort = 'name';
    strip = opts.strip;
    ctxMenu = opts.ctxMenu;
    vscode = opts.vscode;
    PAGE_SIZE = opts.pageSize;

    Columns = (opts.millerColumns || MillerColumns).createColumnStrip({
      strip: strip,
      postMessage: post,
      defaultWidth: opts.defaultColumnWidth,
      minWidth: opts.minColumnWidth,
      buildColumnDom: createColumnDom,
      populate: populateColumn,
      makeState: function () {
        return {
          header: null,
          activeTab: null,
          tabData: {},
          loadedRows: {},
          history: [],
          historyIndex: -1,
          evalText: '',
          evalOut: null,
          metaSubTab: 'instanceMethods',
          metaRenderedSubTab: null,
          openSelector: null,
          methodSource: {},
          bytesRadix: 16,
          chordArmed: false,
          evalVarsRequested: false,
          editing: null,
          editError: null,
        };
      },
    });

    wireEvents();
    window.addEventListener('message', function (ev) {
      handleHostMessage(ev.data);
    });
    post({ command: 'ready' });
    return {
      // Exposed for tests: the strip and the pure decisions above.
      columns: Columns,
      tabsFor: tabsFor,
      handleHostMessage: handleHostMessage,
    };
  }

  var root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.BasicInspectorView = { init: init, tabsFor: tabsFor };
})();
