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
      if (
        anyKeyword &&
        !p.every(function (s) {
          return /^[A-Za-z_][A-Za-z0-9_]*:$/.test(s);
        })
      ) {
        return 'Each keyword part must be an identifier ending in a colon.';
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
        inp.addEventListener('input', updatePreview);
      });
    };

    rows().forEach(wireRow);

    const addParam = function () {
      if (!template || !list) return null;
      // jsdom and VS Code both support <template>.content; fall back to innerHTML.
      let li = null;
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
