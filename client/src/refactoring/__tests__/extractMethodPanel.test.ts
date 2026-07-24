// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { renderExtractPanelHtml, renderExtractCards } from '../extractMethodPanelHtml';
import { ExtractChange } from '../extractMethodPreview';

// The extract-method panel reuses the shared rename-method view JS for its DOM
// behaviour (checkboxes, pagination, apply), so wire that up in jsdom and verify
// the M1-specific layout: the two CORE changes are locked on (disabled), while
// duplicate-replacement rows are opt-in (unchecked) and only apply if ticked.
beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../renameMethodPanelView.js'), 'utf8');
  new Function(source)();
});

interface PanelApi {
  wire(
    doc: Document,
    vscode: { postMessage: (m: unknown) => void },
  ): { deselectedIds: () => string[]; appendChanges: (html: string, done: boolean) => void };
}
function api(): PanelApi {
  return (globalThis as unknown as { RenameMethodPanel: PanelApi }).RenameMethodPanel;
}

function core(id: string, selector: string): ExtractChange {
  return {
    id,
    kind: id === '1' ? 'methodAdd' : 'methodRecompile',
    dictName: 'UserGlobals',
    className: 'M1Demo',
    isMeta: false,
    selector,
    category: 'demo',
    oldSource: id === '1' ? '' : 'a',
    newSource: 'b',
  };
}
function dup(id: string, selector: string): ExtractChange {
  return { ...core(id, selector), kind: 'methodRecompile', className: 'M1Demo' };
}

function mount(changes: ExtractChange[], total: number, done: boolean) {
  const full = renderExtractPanelHtml({
    newSelector: 'helper',
    total,
    coreCount: 2,
    changes,
    done,
    outOfScope: { collision: null, decline: null },
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

describe('paginated extract-method panel', () => {
  it('locks the two core changes on and leaves duplicate rows opt-in (unchecked)', () => {
    const { handle } = mount(
      [core('1', 'helper'), core('2', 'demoDuplicateA'), dup('3', 'demoDuplicateB')],
      3,
      true,
    );

    // the duplicate is deselected by default; the two core rows are not
    expect(handle.deselectedIds()).toEqual(['3']);
    expect(document.getElementById('count')?.textContent).toBe('2');
    // core checkboxes are disabled so they can never be deselected
    const coreBoxes = document.querySelectorAll<HTMLInputElement>('li.change .sel[disabled]');
    expect(coreBoxes).toHaveLength(2);
  });

  it('includes a duplicate once the user ticks it', () => {
    const { handle } = mount(
      [core('1', 'helper'), core('2', 'demoDuplicateA'), dup('3', 'demoDuplicateB')],
      3,
      true,
    );
    const cb = document.querySelector<HTMLInputElement>('li.change[data-id="3"] .sel')!;

    cb.checked = true;
    cb.dispatchEvent(new Event('change'));

    expect(handle.deselectedIds()).toEqual([]);
    expect(document.getElementById('count')?.textContent).toBe('3');
  });

  it('applies reporting only the still-unticked duplicates as deselected', () => {
    const { vscode } = mount(
      [core('1', 'helper'), core('2', 'demoDuplicateA'), dup('3', 'demoDuplicateB')],
      3,
      true,
    );

    (document.getElementById('apply') as HTMLButtonElement).click();

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'apply', deselected: ['3'] });
  });

  it('renders appended duplicate rows unchecked (past the core count)', () => {
    const { handle } = mount([core('1', 'helper'), core('2', 'demoDuplicateA')], 3, false);

    handle.appendChanges(renderExtractCards([dup('3', 'demoDuplicateB')], 2, 2), true);

    expect(document.querySelectorAll('li.change')).toHaveLength(3);
    // the appended duplicate is unchecked → deselected by default
    expect(handle.deselectedIds()).toEqual(['3']);
  });
});
