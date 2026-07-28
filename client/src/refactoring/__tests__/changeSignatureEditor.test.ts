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
    mount('size', []);
    const part = document.querySelector<HTMLInputElement>('input.part')!;

    part.value = '\\';
    part.dispatchEvent(new Event('input'));

    expect(document.getElementById('error')?.textContent).toBe('');
    expect((document.getElementById('ok') as HTMLButtonElement).disabled).toBe(false);
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
