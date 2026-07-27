// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { renderSignaturePanelHtml, renderSignatureCards } from '../changeSignaturePanelHtml';
import { MethodSignatureChange, OutOfScopeCounts } from '../changeSignaturePreview';

// The change-signature panel reuses the R2 panel's DOM script (renameMethodPanelView.js,
// the global RenameMethodPanel), so its checkbox / pagination / apply behaviour is
// exercised here against the M5 HTML.
beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../renameMethodPanelView.js'), 'utf8');
  new Function(source)();
});

interface PanelApi {
  wire(
    doc: Document,
    vscode: { postMessage: (m: unknown) => void },
  ): {
    deselectedIds: () => string[];
    appendChanges: (html: string, done: boolean) => void;
  };
}
function api(): PanelApi {
  return (globalThis as unknown as { RenameMethodPanel: PanelApi }).RenameMethodPanel;
}

const clearOos: OutOfScopeCounts = {
  implementors: 0,
  senders: 0,
  skipped: 0,
  collision: null,
  decline: null,
};

const change = (id: string, selector: string): MethodSignatureChange => ({
  id,
  kind: 'methodRename',
  dictName: 'UserGlobals',
  className: 'Foo',
  isMeta: false,
  selector,
  newSelector: `${selector}put:`,
  category: 'accessing',
  oldSource: `${selector} k\n\t^1`,
  newSource: `${selector} k put: v\n\t^1`,
});

function mount(changes: MethodSignatureChange[], total: number, done: boolean) {
  const full = renderSignaturePanelHtml({
    oldSelector: 'at:',
    newSelector: 'at:put:',
    total,
    changes,
    done,
    outOfScope: clearOos,
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

describe('paginated change-signature panel', () => {
  it('starts with every change selected', () => {
    const { handle } = mount([change('1', 'at:'), change('2', 'to:')], 10, false);

    expect(handle.deselectedIds()).toEqual([]);
    expect(document.getElementById('count')?.textContent).toBe('10');
  });

  it('tracks deselected ids and lowers the selected count', () => {
    const { handle } = mount([change('1', 'at:'), change('2', 'to:')], 10, false);
    const cb = document.querySelector<HTMLInputElement>('li.change[data-id="2"] .sel')!;

    cb.checked = false;
    cb.dispatchEvent(new Event('change'));

    expect(handle.deselectedIds()).toEqual(['2']);
    expect(document.getElementById('count')?.textContent).toBe('9');
  });

  it('appends a fetched page and hides the pager when done', () => {
    mount([change('1', 'at:')], 3, false);

    api()
      .wire(document, { postMessage: vi.fn() })
      .appendChanges(renderSignatureCards([change('2', 'to:'), change('3', 'by:')]), true);

    expect(document.querySelectorAll('li.change')).toHaveLength(3);
    expect(document.getElementById('pager')?.classList.contains('hidden')).toBe(true);
  });

  it('applies by reporting only the deselected ids', () => {
    const { vscode } = mount([change('1', 'at:'), change('2', 'to:')], 2, true);
    const cb = document.querySelector<HTMLInputElement>('li.change[data-id="1"] .sel')!;
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));

    (document.getElementById('apply') as HTMLButtonElement).click();

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'apply', deselected: ['1'] });
  });
});
