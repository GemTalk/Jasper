// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { renderRenamePanelHtml } from '../renameInstVarPanelHtml';
import { RenameChange } from '../renameInstVarPreview';

// Evaluate renameInstVarPanel.js in jsdom so it registers the global
// RenameInstVarPanel, exactly as the webview does when it injects the file.
beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../renameInstVarPanelView.js'), 'utf8');
  new Function(source)();
});

interface PanelApi {
  wire(
    doc: Document,
    vscode: { postMessage: (m: unknown) => void },
  ): {
    refresh: () => void;
    selectedIds: () => string[];
  };
}

function api(): PanelApi {
  return (globalThis as unknown as { RenameInstVarPanel: PanelApi }).RenameInstVarPanel;
}

const method = (over: Partial<RenameChange> = {}): RenameChange => ({
  id: '1',
  kind: 'methodRecompile',
  dictName: 'UserGlobals',
  className: 'Foo',
  isMeta: false,
  selector: 'bar',
  category: 'accessing',
  oldSource: 'bar\n\t^count',
  newSource: 'bar\n\t^tally',
  ...over,
});

const classDef: RenameChange = {
  id: '9',
  kind: 'classDefinitionEdit',
  dictName: 'UserGlobals',
  className: 'Foo',
  isMeta: false,
  selector: null,
  category: null,
  oldSource: "Object subclass: 'Foo' instVarNames: #( count )",
  newSource: "Object subclass: 'Foo' instVarNames: #( tally )",
};

function mount(changes: RenameChange[]): { vscode: { postMessage: ReturnType<typeof vi.fn> } } {
  const html = renderRenamePanelHtml({
    oldName: 'count',
    newName: 'tally',
    changes,
    nonce: 'test',
    script: '',
  });
  document.body.innerHTML = html.split('<body>')[1].split('</body>')[0];
  const vscode = { postMessage: vi.fn() };
  api().wire(document, vscode);
  return { vscode };
}

describe('renderRenamePanelHtml', () => {
  it('renders one card per change, all checkboxes checked', () => {
    const html = renderRenamePanelHtml({
      oldName: 'count',
      newName: 'tally',
      changes: [method(), classDef],
      nonce: 'n',
      script: '',
    });

    const cards = html.match(/class="change"/g) ?? [];
    expect(cards).toHaveLength(2);
    expect(html).toContain('data-id="1"');
    expect(html).toContain('data-id="9"');
    expect(html.match(/class="sel" checked/g) ?? []).toHaveLength(2);
  });

  it('marks the class-definition edit as required — checked and disabled — while method recompiles stay deselectable', () => {
    const html = renderRenamePanelHtml({
      oldName: 'count',
      newName: 'tally',
      changes: [method(), classDef],
      nonce: 'n',
      script: '',
    });

    // exactly one disabled (required) checkbox — the class-definition card
    expect(html.match(/class="sel" checked disabled/g) ?? []).toHaveLength(1);
    // the method-recompile card stays plainly deselectable
    expect(html).toContain('class="sel" checked aria-label="Include');
  });

  it('collapses diffs by default and offers an expand-all toggle', () => {
    const html = renderRenamePanelHtml({
      oldName: 'count',
      newName: 'tally',
      changes: [method(), classDef],
      nonce: 'n',
      script: '',
    });

    expect(html.match(/class="diff hidden"/g) ?? []).toHaveLength(2);
    expect(html).toContain('id="toggleAll"');
    expect(html).toContain('Expand all');
  });

  it('shows the before/after diff lines for a change', () => {
    const html = renderRenamePanelHtml({
      oldName: 'count',
      newName: 'tally',
      changes: [method()],
      nonce: 'n',
      script: '',
    });

    expect(html).toContain('class="line del"');
    expect(html).toContain('class="line add"');
    expect(html).toContain('-\t^count');
    expect(html).toContain('+\t^tally');
  });

  it('escapes HTML in source so markup cannot break out', () => {
    const html = renderRenamePanelHtml({
      oldName: 'count',
      newName: 'tally',
      changes: [method({ newSource: 'bar\n\t^<script>' })],
      nonce: 'n',
      script: '',
    });

    expect(html).not.toContain('^<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('rename panel interactions', () => {
  it('starts with every change selected and the count reflecting that', () => {
    mount([method({ id: '1' }), method({ id: '2', selector: 'baz' }), classDef]);

    expect(document.getElementById('count')?.textContent).toBe('3');
    expect(document.getElementById('selcount')?.textContent).toBe('3');
  });

  it('renders the class-definition checkbox disabled so it cannot be deselected', () => {
    mount([method({ id: '1' }), classDef]);

    const defCb = document.querySelector('li.change[data-id="9"] .sel') as HTMLInputElement;
    const methodCb = document.querySelector('li.change[data-id="1"] .sel') as HTMLInputElement;

    expect(defCb.disabled).toBe(true);
    expect(defCb.checked).toBe(true);
    // a real click cannot toggle a disabled input, so it can never be deselected
    expect(methodCb.disabled).toBe(false);
  });

  it('drops a change from the count when unchecked', () => {
    mount([method({ id: '1' }), classDef]);

    const first = document.querySelector('li.change[data-id="1"] .sel') as HTMLInputElement;
    first.checked = false;
    first.dispatchEvent(new Event('change'));

    expect(document.getElementById('count')?.textContent).toBe('1');
    expect(document.querySelector('li.change[data-id="1"]')?.classList.contains('deselected')).toBe(
      true,
    );
  });

  it('applies only the still-checked change ids', () => {
    const { vscode } = mount([method({ id: '1' }), method({ id: '2', selector: 'baz' }), classDef]);

    const second = document.querySelector('li.change[data-id="2"] .sel') as HTMLInputElement;
    second.checked = false;
    second.dispatchEvent(new Event('change'));
    (document.getElementById('apply') as HTMLButtonElement).click();

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'apply', ids: ['1', '9'] });
  });

  it('posts a cancel when Cancel is clicked', () => {
    const { vscode } = mount([method()]);

    (document.getElementById('cancel') as HTMLButtonElement).click();

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'cancel' });
  });

  it('disables Apply when nothing is selected', () => {
    mount([method({ id: '1' })]);

    const cb = document.querySelector('li.change[data-id="1"] .sel') as HTMLInputElement;
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));

    expect((document.getElementById('apply') as HTMLButtonElement).disabled).toBe(true);
  });

  it('starts with every diff collapsed for a scannable list', () => {
    mount([method({ id: '1' }), classDef]);

    document.querySelectorAll('li.change pre.diff').forEach((pre) => {
      expect(pre.classList.contains('hidden')).toBe(true);
    });
  });

  it('expands and collapses a diff when its header is clicked', () => {
    mount([method({ id: '1' })]);

    const head = document.querySelector('li.change[data-id="1"] .change-head') as HTMLElement;
    const pre = document.querySelector('li.change[data-id="1"] pre.diff') as HTMLElement;

    head.click();
    expect(pre.classList.contains('hidden')).toBe(false);
    head.click();
    expect(pre.classList.contains('hidden')).toBe(true);
  });

  it('does not expand the diff when the checkbox is clicked', () => {
    mount([method({ id: '1' })]);

    const cb = document.querySelector('li.change[data-id="1"] .sel') as HTMLInputElement;
    const pre = document.querySelector('li.change[data-id="1"] pre.diff') as HTMLElement;

    cb.click();

    expect(pre.classList.contains('hidden')).toBe(true);
  });

  it('expands all diffs then collapses them again via the header toggle', () => {
    mount([method({ id: '1' }), method({ id: '2', selector: 'baz' }), classDef]);

    const toggleAll = document.getElementById('toggleAll') as HTMLButtonElement;
    const hidden = () =>
      Array.from(document.querySelectorAll('li.change pre.diff')).filter((p) =>
        p.classList.contains('hidden'),
      ).length;

    expect(toggleAll.textContent).toBe('Expand all');
    toggleAll.click();
    expect(hidden()).toBe(0);
    expect(toggleAll.textContent).toBe('Collapse all');
    toggleAll.click();
    expect(hidden()).toBe(3);
    expect(toggleAll.textContent).toBe('Expand all');
  });

  it('a double-click on Apply posts exactly one apply and disables the button', () => {
    const { vscode } = mount([method({ id: '1' }), classDef]);
    const apply = document.getElementById('apply') as HTMLButtonElement;

    apply.click();
    apply.click();

    const applies = vscode.postMessage.mock.calls.filter(
      (c) => (c[0] as { command: string }).command === 'apply',
    );
    expect(applies).toHaveLength(1);
    expect(apply.disabled).toBe(true);
  });

  it('a checkbox change while applying cannot re-enable Apply', () => {
    mount([method({ id: '1' }), method({ id: '2', selector: 'baz' })]);
    const apply = document.getElementById('apply') as HTMLButtonElement;
    apply.click();
    expect(apply.disabled).toBe(true);

    const cb = document.querySelector<HTMLInputElement>('li.change[data-id="2"] .sel')!;
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));

    expect(apply.disabled).toBe(true);
  });
});
