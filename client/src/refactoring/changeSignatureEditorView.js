/**
 * Webview-side behavior for the change-method-signature (M5) editor
 * (changeSignatureEditor.ts).
 *
 * Read at runtime via fs.readFileSync and injected as a <script> tag — NOT bundled —
 * so the reorder / add / remove / live-selector / OK-Cancel logic can be unit-tested
 * in jsdom (see changeSignatureEditor.test.ts) instead of living in an inline string.
 *
 * The host renders one <li.kwrow> per selector part. A reused parameter carries
 * data-orig = its 1-based ORIGINAL argument index and shows its argument read-only
 * (M5 keeps reused argument names). "Add parameter" clones the #addRowTemplate row —
 * an editable keyword part, an editable argument name, and a default-value input,
 * data-orig="0". "Remove" drops a row. On OK we report, in DOM order: the parts of
 * every row (newParts), and — for the argument-bearing rows — the permutation
 * (data-orig), the argument names, and the defaults (the default input for a new
 * parameter, '' for a reused one).
 *
 * A row's SHAPE is not fixed at render. A unary selector's sole part renders with no
 * argument and no data-orig, so it would contribute a keyword part and nothing else;
 * typing a colon in it (`fullAddress` → `fullAddress:`) is plainly a request for a
 * one-argument method, so syncRowShape grows the row in place into the same argument
 * name + default fields "Add parameter" would have given it, marks it data-orig="0",
 * and the existing payload path then reports it as a new parameter with no host
 * change. Deleting the colon collapses it back, keeping what was typed in the
 * argument fields in case the colon comes back. Only rows we expanded collapse
 * (data-expanded), so an added parameter is never silently un-made — a genuinely
 * mismatched arity is caught by validate() instead.
 *
 * Exposed as the global `ChangeSignatureEditor` so both the webview and tests can
 * reach `wire`.
 */
(function () {
  function wire(doc, vscode) {
    const scriptEl = doc.querySelector('script[data-old-selector]');
    const dictName = scriptEl ? scriptEl.getAttribute('data-dict-name') || '' : '';
    const okBtn = doc.getElementById('ok');
    const cancelBtn = doc.getElementById('cancel');
    const addBtn = doc.getElementById('addParam');
    const selEl = doc.getElementById('sel');
    const errEl = doc.getElementById('error');
    const scopeEl = doc.getElementById('scope');
    const list = doc.querySelector('ul.rows');
    const template = doc.getElementById('addRowTemplate');

    const rows = function () {
      return Array.prototype.slice.call(doc.querySelectorAll('li.kwrow'));
    };
    const parts = function () {
      return rows().map(function (li) {
        const inp = li.querySelector('input.part');
        return inp ? inp.value : '';
      });
    };
    const argRows = function () {
      return rows().filter(function (li) {
        return li.hasAttribute('data-orig');
      });
    };
    const permutation = function () {
      return argRows().map(function (li) {
        return parseInt(li.getAttribute('data-orig'), 10);
      });
    };
    const argNameOf = function (li) {
      const inp = li.querySelector('input.argname');
      if (inp) return inp.value;
      const span = li.querySelector('span.arg');
      return span ? span.getAttribute('data-argname') || '' : '';
    };
    const newArgNames = function () {
      return argRows().map(argNameOf);
    };
    const defaults = function () {
      return argRows().map(function (li) {
        const isNew = li.getAttribute('data-orig') === '0';
        const inp = li.querySelector('input.defval');
        return isNew && inp ? inp.value : '';
      });
    };

    // Live validation mirrors changeSignaturePreview closely enough for immediate
    // feedback; the extension re-validates authoritatively.
    const validate = function () {
      const p = parts();
      if (p.length === 0) return 'A selector needs at least one part.';
      if (
        p.some(function (s) {
          return s.trim().length === 0;
        })
      )
        return 'Selector parts cannot be empty.';
      const anyKeyword = p.some(function (s) {
        return s.charAt(s.length - 1) === ':';
      });
      // Binary-selector chars incl. backslash — mirrors selectorShape.ts / the host's
      // validateSignatureParts. Kept inline because the webview script can't import.
      const isBinaryPart = function (s) {
        return /^[-+*/\\~<>=&|@%,?!]+$/.test(s);
      };
      // Mirror the host's validateSignatureParts shape rules so an invalid selector is
      // caught while the rows are still on screen — not after OK disposes the panel and
      // loses the edit: all keyword parts, OR a single unary/binary part.
      if (anyKeyword) {
        if (
          !p.every(function (s) {
            return /^[A-Za-z_][A-Za-z0-9_]*:$/.test(s);
          })
        ) {
          return 'Each keyword part must be an identifier ending in a colon.';
        }
      } else if (p.length === 1) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(p[0]) && !isBinaryPart(p[0])) {
          return 'A single-part selector must be a unary identifier or a binary operator.';
        }
      } else {
        return 'A selector with more than one part must use keyword parts (each ending in a colon).';
      }
      // Mirror the host's arity guard: shape alone does not make a legal method
      // pattern — a keyword selector binds exactly one argument per keyword. The row
      // transform above keeps this satisfied for the unary case, but an added
      // parameter whose part loses its colon can still land here.
      const argCount = argRows().length;
      const expected = anyKeyword ? p.length : isBinaryPart(p[0]) ? 1 : 0;
      if (argCount !== expected) {
        return (
          "'" +
          p.join('') +
          "' takes " +
          expected +
          ' argument' +
          (expected === 1 ? '' : 's') +
          ', but ' +
          argCount +
          (argCount === 1 ? ' was' : ' were') +
          ' given.'
        );
      }
      const names = newArgNames();
      const seen = {};
      for (let i = 0; i < names.length; i++) {
        const n = names[i].trim();
        if (n.length === 0) continue;
        if (seen[n]) return 'Duplicate argument name: ' + n + '.';
        seen[n] = true;
      }
      return '';
    };

    const updatePreview = function () {
      if (selEl) selEl.textContent = parts().join('');
      const err = validate();
      if (errEl) errEl.textContent = err;
      if (okBtn) okBtn.disabled = err.length > 0;
    };

    const move = function (li, dir) {
      if (dir < 0) {
        const prev = li.previousElementSibling;
        if (prev) li.parentNode.insertBefore(li, prev);
      } else {
        const next = li.nextElementSibling;
        if (next) li.parentNode.insertBefore(next, li);
      }
      updatePreview();
    };

    // A keyword part: an identifier ending in a colon. A binary part (`+`, `<:`) is
    // deliberately NOT this, so typing a colon on a binary row changes nothing
    // structural — the unary case is the one with an obvious reading.
    const isKeywordPart = function (v) {
      return /^[A-Za-z_][A-Za-z0-9_]*:$/.test(v);
    };

    // The argument-name / default inputs a new parameter needs, cloned out of
    // #addRowTemplate so their markup lives in one place (changeSignatureEditorHtml).
    const newArgFields = function () {
      if (!template) return null;
      let src;
      if (template.content && template.content.firstElementChild) {
        src = template.content.firstElementChild.cloneNode(true);
      } else {
        const tmp = doc.createElement('div');
        tmp.innerHTML = template.innerHTML;
        src = tmp.querySelector('li.kwrow');
      }
      if (!src) return null;
      const argname = src.querySelector('input.argname');
      const label = src.querySelector('span.default-label');
      const defval = src.querySelector('input.defval');
      if (!argname || !label || !defval) return null;
      return { argname: argname, label: label, defval: defval };
    };

    // Grow a no-argument row into a parameter row, in place.
    const expandRow = function (li) {
      const none = li.querySelector('span.arg.none');
      const fields = newArgFields();
      if (!none || !fields) return;
      // Put back whatever was typed before a previous collapse, if anything.
      const argDraft = li.getAttribute('data-argname-draft');
      const defDraft = li.getAttribute('data-defval-draft');
      if (argDraft !== null) fields.argname.value = argDraft;
      if (defDraft !== null) fields.defval.value = defDraft;
      const parent = none.parentNode;
      parent.insertBefore(fields.argname, none);
      parent.insertBefore(fields.label, none);
      parent.insertBefore(fields.defval, none);
      parent.removeChild(none);
      li.setAttribute('data-orig', '0');
      li.setAttribute('data-expanded', '1');
      // Wire only the new inputs — re-running wireRow would double-bind ▲▼/Remove.
      fields.argname.addEventListener('input', updatePreview);
      fields.defval.addEventListener('input', updatePreview);
    };

    // Shrink a row we previously expanded back to "(no argument)", remembering the
    // argument name and default so re-typing the colon does not lose them.
    const collapseRow = function (li) {
      const argname = li.querySelector('input.argname');
      const label = li.querySelector('span.default-label');
      const defval = li.querySelector('input.defval');
      if (!argname) return;
      li.setAttribute('data-argname-draft', argname.value);
      if (defval) li.setAttribute('data-defval-draft', defval.value);
      const none = doc.createElement('span');
      none.className = 'arg none';
      none.textContent = '(no argument)';
      argname.parentNode.insertBefore(none, argname);
      argname.parentNode.removeChild(argname);
      if (label) label.parentNode.removeChild(label);
      if (defval) defval.parentNode.removeChild(defval);
      li.removeAttribute('data-orig');
      li.removeAttribute('data-expanded');
    };

    // Keep a row's shape in step with what its selector part now says.
    const syncRowShape = function (li) {
      const inp = li.querySelector('input.part');
      if (!inp) return;
      const keyword = isKeywordPart(inp.value);
      if (keyword && !li.hasAttribute('data-orig')) expandRow(li);
      else if (!keyword && li.getAttribute('data-expanded') === '1') collapseRow(li);
    };

    const wireRow = function (li) {
      const up = li.querySelector('button.up');
      const down = li.querySelector('button.down');
      const remove = li.querySelector('button.remove');
      const inputs = li.querySelectorAll('input');
      if (up)
        up.addEventListener('click', function () {
          move(li, -1);
        });
      if (down)
        down.addEventListener('click', function () {
          move(li, 1);
        });
      if (remove)
        remove.addEventListener('click', function () {
          if (li.parentNode) li.parentNode.removeChild(li);
          updatePreview();
        });
      Array.prototype.forEach.call(inputs, function (inp) {
        inp.addEventListener('input', function () {
          // A selector part can change the row's shape (unary ⇄ one parameter), so
          // reconcile that before recomputing the preview off the new shape.
          if (inp.classList && inp.classList.contains('part')) syncRowShape(li);
          updatePreview();
        });
      });
    };

    rows().forEach(wireRow);

    const addParam = function () {
      if (!template || !list) return null;
      // jsdom and VS Code both support <template>.content; fall back to innerHTML.
      let li;
      if (template.content && template.content.firstElementChild) {
        li = template.content.firstElementChild.cloneNode(true);
      } else {
        const tmp = doc.createElement('div');
        tmp.innerHTML = template.innerHTML;
        li = tmp.querySelector('li.kwrow');
      }
      if (!li) return null;
      list.appendChild(li);
      wireRow(li);
      updatePreview();
      return li;
    };

    if (addBtn) {
      addBtn.addEventListener('click', addParam);
    }

    if (okBtn) {
      okBtn.addEventListener('click', function () {
        if (validate().length > 0) return;
        const kind = scopeEl ? scopeEl.value : 'hierarchy';
        const scope = kind === 'dictionary' ? { kind: kind, dictName: dictName } : { kind: kind };
        vscode.postMessage({
          command: 'ok',
          newParts: parts(),
          permutation: permutation(),
          newArgNames: newArgNames(),
          defaults: defaults(),
          scope: scope,
        });
      });
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        vscode.postMessage({ command: 'cancel' });
      });
    }

    updatePreview();
    return {
      parts: parts,
      permutation: permutation,
      newArgNames: newArgNames,
      defaults: defaults,
      updatePreview: updatePreview,
      move: move,
      addParam: addParam,
    };
  }

  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.ChangeSignatureEditor = { wire: wire };

  if (typeof acquireVsCodeApi === 'function') {
    wire(document, acquireVsCodeApi());
  }
})();
