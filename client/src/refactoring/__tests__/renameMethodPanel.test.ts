// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { renderMethodPanelHtml, renderMethodCards } from '../renameMethodPanelHtml';
import { MethodRenameChange } from '../renameMethodPreview';

beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../renameMethodPanelView.js'), 'utf8');
  new Function(source)();
});

interface PanelApi {
  wire(
    doc: Document,
    vscode: { postMessage: (m: unknown) => void },
  ): {
    refresh: () => void;
    deselectedIds: () => string[];
    appendChanges: (html: string, done: boolean) => void;
  };
}
function api(): PanelApi {
  return (globalThis as unknown as { RenameMethodPanel: PanelApi }).RenameMethodPanel;
}

const change = (id: string, selector: string): MethodRenameChange => ({
  id,
  kind: 'methodRename',
  dictName: 'UserGlobals',
  className: 'Foo',
  isMeta: false,
  selector,
  newSelector: `${selector}X`,
  category: 'accessing',
  oldSource: `${selector}\n\t^1`,
  newSource: `${selector}X\n\t^1`,
});

function mount(changes: MethodRenameChange[], total: number, done: boolean) {
  const full = renderMethodPanelHtml({
    oldSelector: 'a',
    newSelector: 'b',
    total,
    changes,
    done,
    outOfScope: { implementors: 0, senders: 0, skipped: 0 },
    skippedMethods: [],
    nonce: 'test',
    script: '',
  });
  const m = full.match(/<body([^>]*)>([\s\S]*)<\/body>/)!;
  document.body.setAttribute('data-total', String(total));
  document.body.innerHTML = m[2];
  const vscode = { postMessage: vi.fn() };
  const handle = api().wire(document, vscode);
  return { handle, vscode };
}

describe('paginated rename-method panel', () => {
  it('starts with every change selected, counted against the total', () => {
    const { handle } = mount([change('1', 'a'), change('2', 'c')], 10, false);

    expect(handle.deselectedIds()).toEqual([]);
    expect(document.getElementById('count')?.textContent).toBe('10');
  });

  it('tracks deselected ids and lowers the selected count', () => {
    const { handle } = mount([change('1', 'a'), change('2', 'c')], 10, false);
    const cb = document.querySelector<HTMLInputElement>('li.change[data-id="2"] .sel')!;

    cb.checked = false;
    cb.dispatchEvent(new Event('change'));

    expect(handle.deselectedIds()).toEqual(['2']);
    expect(document.getElementById('count')?.textContent).toBe('9');
  });

  it('appends a fetched page and updates the loaded status', () => {
    const { handle } = mount([change('1', 'a')], 3, false);

    handle.appendChanges(renderMethodCards([change('2', 'c'), change('3', 'd')]), true);

    expect(document.querySelectorAll('li.change')).toHaveLength(3);
    expect(document.getElementById('pagerStatus')?.textContent).toBe('3 of 3 loaded');
    expect(document.getElementById('pager')?.classList.contains('hidden')).toBe(true);
  });

  it('asks the host for more pages', () => {
    const { vscode } = mount([change('1', 'a')], 5, false);

    (document.getElementById('more') as HTMLButtonElement).click();

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'loadMore' });
  });

  it('applies by reporting only the deselected ids', () => {
    const { vscode } = mount([change('1', 'a'), change('2', 'c')], 2, true);
    const cb = document.querySelector<HTMLInputElement>('li.change[data-id="1"] .sel')!;
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));

    (document.getElementById('apply') as HTMLButtonElement).click();

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'apply', deselected: ['1'] });
  });

  it('omits an options key when the panel has no apply-option checkboxes', () => {
    const { vscode } = mount([change('1', 'a')], 1, true);

    (document.getElementById('apply') as HTMLButtonElement).click();

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'apply', deselected: [] });
  });

  it('collects apply-option checkbox states into the apply message when present', () => {
    const { vscode } = mount([change('1', 'a')], 1, true);
    const fieldset = document.createElement('div');
    fieldset.innerHTML =
      '<input type="checkbox" class="apply-option" data-opt="migrateInstances" checked>' +
      '<input type="checkbox" class="apply-option" data-opt="removeOldFromHistory">';
    document.body.appendChild(fieldset);

    (document.getElementById('apply') as HTMLButtonElement).click();

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: 'apply',
      deselected: [],
      options: { migrateInstances: true, removeOldFromHistory: false },
    });
  });
});
