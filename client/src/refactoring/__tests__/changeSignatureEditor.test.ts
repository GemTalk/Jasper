// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { renderSignatureEditorHtml } from '../changeSignatureEditorHtml';

// Evaluate changeSignatureEditorView.js in jsdom so it registers the global
// ChangeSignatureEditor, exactly as the webview does when it injects the file.
beforeAll(() => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../changeSignatureEditorView.js'),
    'utf8',
  );
  new Function(source)();
});

interface EditorApi {
  wire(
    doc: Document,
    vscode: { postMessage: (m: unknown) => void },
  ): {
    parts: () => string[];
    permutation: () => number[];
    newArgNames: () => string[];
    defaults: () => string[];
    updatePreview: () => void;
    move: (li: Element, dir: number) => void;
    addParam: () => Element | null;
  };
}

function api(): EditorApi {
  return (globalThis as unknown as { ChangeSignatureEditor: EditorApi }).ChangeSignatureEditor;
}

function mount(oldSelector: string, argNames: string[], dictName?: string) {
  const html = renderSignatureEditorHtml({
    className: 'Foo',
    oldSelector,
    isMeta: false,
    argNames,
    dictName,
    nonce: 'test',
    script: '',
  });
  document.documentElement.innerHTML = html
    .replace(/^[\s\S]*?<body>/, '')
    .replace(/<\/body>[\s\S]*$/, '');
  const vscode = { postMessage: vi.fn() };
  const handle = api().wire(document, vscode);
  return { handle, vscode };
}

describe('change-signature editor', () => {
  it('shows the current selector, parts, and argument permutation initially', () => {
    const { handle } = mount('at:put:', ['k', 'v']);

    expect(handle.parts()).toEqual(['at:', 'put:']);
    expect(handle.permutation()).toEqual([1, 2]);
    expect(handle.newArgNames()).toEqual(['k', 'v']);
    expect(document.getElementById('sel')?.textContent).toBe('at:put:');
  });

  it('rebuilds the previewed selector as parts are edited', () => {
    mount('copyFrom:to:', ['start', 'stop']);
    const inputs = document.querySelectorAll<HTMLInputElement>('input.part');

    inputs[0].value = 'copyTo:';
    inputs[1].value = 'from:';
    inputs[0].dispatchEvent(new Event('input'));

    expect(document.getElementById('sel')?.textContent).toBe('copyTo:from:');
  });

  it('moves a keyword and its argument together when reordering', () => {
    const { handle } = mount('copyFrom:to:', ['start', 'stop']);
    const rows = document.querySelectorAll('li.kwrow');

    handle.move(rows[1], -1);

    expect(handle.parts()).toEqual(['to:', 'copyFrom:']);
    expect(handle.permutation()).toEqual([2, 1]);
    expect(handle.newArgNames()).toEqual(['stop', 'start']);
  });

  it('adds a parameter as a new zero-index row with an editable name and default', () => {
    const { handle } = mount('at:', ['k']);

    handle.addParam();

    expect(handle.parts()).toEqual(['at:', 'arg:']);
    expect(handle.permutation()).toEqual([1, 0]);
    expect(handle.newArgNames()).toEqual(['k', 'aValue']);
    expect(handle.defaults()).toEqual(['', 'nil']);
  });

  it('removes a parameter when its Remove control is clicked', () => {
    const { handle } = mount('at:put:', ['k', 'v']);
    const rows = document.querySelectorAll('li.kwrow');

    (rows[1].querySelector('button.remove') as HTMLButtonElement).click();

    expect(handle.parts()).toEqual(['at:']);
    expect(handle.permutation()).toEqual([1]);
  });

  it('reflects an edited default value in the emitted defaults', () => {
    const { handle } = mount('at:', ['k']);
    handle.addParam();
    const defval = document.querySelector<HTMLInputElement>('input.defval')!;

    defval.value = '0';
    defval.dispatchEvent(new Event('input'));

    expect(handle.defaults()).toEqual(['', '0']);
  });

  it('reports the parts, permutation, names, defaults, and scope on confirm', () => {
    const { handle, vscode } = mount('at:', ['k']);
    handle.addParam();
    const defval = document.querySelector<HTMLInputElement>('input.defval')!;
    defval.value = 'nil';

    (document.getElementById('ok') as HTMLButtonElement).click();

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: 'ok',
      newParts: ['at:', 'arg:'],
      permutation: [1, 0],
      newArgNames: ['k', 'aValue'],
      defaults: ['', 'nil'],
      scope: { kind: 'hierarchy' },
    });
  });

  it('disables confirm when a part is emptied', () => {
    mount('at:put:', ['k', 'v']);
    const input = document.querySelector<HTMLInputElement>('input.part')!;

    input.value = '';
    input.dispatchEvent(new Event('input'));

    expect((document.getElementById('ok') as HTMLButtonElement).disabled).toBe(true);
  });

  it('flags a duplicate argument name', () => {
    const { handle } = mount('at:', ['k']);
    handle.addParam();
    const argname = document.querySelector<HTMLInputElement>('input.argname')!;

    argname.value = 'k';
    argname.dispatchEvent(new Event('input'));

    expect(document.getElementById('error')?.textContent).toMatch(/Duplicate argument/);
  });

  it('rejects more than one part once the colons are stripped (mirrors the host)', () => {
    mount('at:put:', ['k', 'v']);
    const parts = document.querySelectorAll<HTMLInputElement>('input.part');

    ['at', 'put'].forEach((v, i) => {
      parts[i].value = v;
      parts[i].dispatchEvent(new Event('input'));
    });

    expect(document.getElementById('error')?.textContent).toMatch(/keyword parts/);
    expect((document.getElementById('ok') as HTMLButtonElement).disabled).toBe(true);
  });

  it('rejects a single part that is neither an identifier nor a binary operator', () => {
    mount('size', []);
    const part = document.querySelector<HTMLInputElement>('input.part')!;

    part.value = '9bad';
    part.dispatchEvent(new Event('input'));

    expect(document.getElementById('error')?.textContent).toMatch(/unary identifier or a binary/);
    expect((document.getElementById('ok') as HTMLButtonElement).disabled).toBe(true);
  });

  it('accepts a backslash binary selector', () => {
    // Renamed from another BINARY selector, so the one argument it needs is already
    // there. (Renaming a unary selector to a binary one is rejected on arity — the
    // unary has no argument to bind, and the only way to add one makes it a keyword.)
    mount('+', ['other']);
    const part = document.querySelector<HTMLInputElement>('input.part')!;

    part.value = '\\';
    part.dispatchEvent(new Event('input'));

    expect(document.getElementById('error')?.textContent).toBe('');
    expect((document.getElementById('ok') as HTMLButtonElement).disabled).toBe(false);
  });

  it('rejects renaming a unary selector to a binary one, which has no argument', () => {
    mount('size', []);
    const part = document.querySelector<HTMLInputElement>('input.part')!;

    part.value = '\\';
    part.dispatchEvent(new Event('input'));

    expect(document.getElementById('error')?.textContent).toMatch(/takes 1 argument, but 0/);
    expect((document.getElementById('ok') as HTMLButtonElement).disabled).toBe(true);
  });

  it('has an empty permutation for a unary selector', () => {
    const { handle } = mount('size', []);

    expect(handle.parts()).toEqual(['size']);
    expect(handle.permutation()).toEqual([]);
    expect(handle.newArgNames()).toEqual([]);
  });

  it('cancels without reporting an edit', () => {
    const { vscode } = mount('at:', ['k']);

    (document.getElementById('cancel') as HTMLButtonElement).click();

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'cancel' });
  });
});

// ── Typing a colon on a unary selector ──────────────────────
//
// A unary selector's sole row starts with no argument and no data-orig, so it used to
// contribute a selector part and nothing else however you edited it: typing a colon
// gave a one-keyword selector with zero arguments — not a legal method pattern — with
// Preview… still enabled. These cover the transform that grows the row instead, its
// reverse, and the guard that catches the malformed shape by any other route.

describe('change-signature editor: colon on a unary selector', () => {
  function typePart(index: number, value: string) {
    const inputs = document.querySelectorAll<HTMLInputElement>('input.part');
    inputs[index].value = value;
    inputs[index].dispatchEvent(new Event('input'));
  }

  it('grows the row into a parameter when a colon is typed', () => {
    const { handle } = mount('fullAddress', []);
    expect(handle.permutation()).toEqual([]);

    typePart(0, 'fullAddress:');

    expect(handle.parts()).toEqual(['fullAddress:']);
    // Reported as a NEW parameter (data-orig 0) with the template's name and default.
    expect(handle.permutation()).toEqual([0]);
    expect(handle.newArgNames()).toEqual(['aValue']);
    expect(handle.defaults()).toEqual(['nil']);
    expect(document.querySelector('span.arg.none')).toBeNull();
    expect(document.getElementById('sel')?.textContent).toBe('fullAddress:');
  });

  it('leaves Preview enabled and posts a well-formed edit after the transform', () => {
    const { vscode } = mount('fullAddress', []);
    typePart(0, 'fullAddress:');
    const argname = document.querySelector<HTMLInputElement>('input.argname')!;
    argname.value = 'anAddress';
    argname.dispatchEvent(new Event('input'));

    const ok = document.getElementById('ok') as HTMLButtonElement;
    expect(ok.disabled).toBe(false);
    expect(document.getElementById('error')?.textContent).toBe('');
    ok.click();

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'ok',
        newParts: ['fullAddress:'],
        permutation: [0],
        newArgNames: ['anAddress'],
        defaults: ['nil'],
      }),
    );
  });

  it('collapses the row again when the colon is deleted', () => {
    const { handle } = mount('fullAddress', []);
    typePart(0, 'fullAddress:');
    typePart(0, 'fullAddress');

    expect(handle.permutation()).toEqual([]);
    expect(handle.newArgNames()).toEqual([]);
    expect(document.querySelector('span.arg.none')).not.toBeNull();
    expect(document.querySelector('input.argname')).toBeNull();
  });

  it('keeps the typed argument name and default across a collapse and re-expand', () => {
    const { handle } = mount('fullAddress', []);
    typePart(0, 'fullAddress:');
    const argname = document.querySelector<HTMLInputElement>('input.argname')!;
    argname.value = 'anAddress';
    argname.dispatchEvent(new Event('input'));
    const defval = document.querySelector<HTMLInputElement>('input.defval')!;
    defval.value = "''";
    defval.dispatchEvent(new Event('input'));

    typePart(0, 'fullAddress');
    typePart(0, 'fullAddress:');

    expect(handle.newArgNames()).toEqual(['anAddress']);
    expect(handle.defaults()).toEqual(["''"]);
  });

  it('does not double-bind the row controls when it expands', () => {
    const { handle } = mount('fullAddress', []);
    typePart(0, 'fullAddress:');

    (document.querySelector('button.remove') as HTMLButtonElement).click();

    expect(handle.parts()).toEqual([]);
  });

  it('does not grow a binary selector row', () => {
    const { handle } = mount('+', ['other']);

    typePart(0, '+:');

    // `+:` is not an identifier-colon, so the row keeps the shape it was rendered
    // with — the reused argument it already had.
    expect(handle.newArgNames()).toEqual(['other']);
    expect(document.querySelectorAll('input.argname')).toHaveLength(0);
  });

  it('does not un-make an added parameter when its colon is deleted', () => {
    const { handle } = mount('fullAddress', []);
    handle.addParam();

    typePart(1, 'arg');

    // The row stays a parameter (only rows the colon expanded collapse), so the
    // mismatch surfaces as an error rather than a silently dropped argument.
    expect(handle.newArgNames()).toEqual(['aValue']);
    expect((document.getElementById('ok') as HTMLButtonElement).disabled).toBe(true);
  });
});
