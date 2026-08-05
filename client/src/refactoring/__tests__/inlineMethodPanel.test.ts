// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { renderInlinePanelHtml, renderInlineCards } from '../inlineMethodPanelHtml';
import { InlineChange } from '../inlineMethodPreview';

// The inline-method panel reuses the shared rename-method view JS for its DOM
// behaviour (checkboxes, pagination, apply), so wire that up in jsdom and verify
// the M2-specific layout: the single CORE change (the rewritten caller) is locked
// on (disabled), while the last-sender removal row is opt-in (unchecked) and only
// applies if the user ticks it.
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

function recompile(id: string): InlineChange {
  return {
    id,
    kind: 'methodRecompile',
    dictName: 'UserGlobals',
    className: 'Account',
    isMeta: false,
    selector: 'report',
    category: 'printing',
    oldSource: 'report\n\t^ self total',
    newSource: 'report\n\t^ balance',
  };
}
function removal(id: string): InlineChange {
  return {
    id,
    kind: 'methodRemove',
    dictName: 'UserGlobals',
    className: 'Account',
    isMeta: false,
    selector: 'total',
    category: 'accessing',
    oldSource: 'total\n\t^ balance',
    newSource: '',
  };
}

function mount(changes: InlineChange[], total: number, lastSender: boolean, done: boolean) {
  const full = renderInlinePanelHtml({
    targetSelector: 'total',
    total,
    coreCount: 1,
    lastSender,
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

describe('paginated inline-method panel', () => {
  it('locks the core recompile on and leaves the removal row opt-in (unchecked)', () => {
    const { handle } = mount([recompile('1'), removal('2')], 2, true, true);

    expect(handle.deselectedIds()).toEqual(['2']);
    expect(document.getElementById('count')?.textContent).toBe('1');
    const coreBoxes = document.querySelectorAll<HTMLInputElement>('li.change .sel[disabled]');
    expect(coreBoxes).toHaveLength(1);
  });

  it('includes the removal once the user ticks it', () => {
    const { handle } = mount([recompile('1'), removal('2')], 2, true, true);
    const cb = document.querySelector<HTMLInputElement>('li.change[data-id="2"] .sel')!;

    cb.checked = true;
    cb.dispatchEvent(new Event('change'));

    expect(handle.deselectedIds()).toEqual([]);
    expect(document.getElementById('count')?.textContent).toBe('2');
  });

  it('applies reporting the still-unticked removal as deselected', () => {
    const { vscode } = mount([recompile('1'), removal('2')], 2, true, true);

    (document.getElementById('apply') as HTMLButtonElement).click();

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'apply', deselected: ['2'] });
  });

  it('renders an appended removal row unchecked (past the core count)', () => {
    const { handle } = mount([recompile('1')], 2, true, false);

    handle.appendChanges(renderInlineCards([removal('2')], 1, 1), true);

    expect(document.querySelectorAll('li.change')).toHaveLength(2);
    expect(handle.deselectedIds()).toEqual(['2']);
  });
});
