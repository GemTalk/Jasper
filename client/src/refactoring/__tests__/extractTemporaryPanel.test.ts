// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  renderExtractTemporaryPanelHtml,
  renderExtractTemporaryCards,
} from '../extractTemporaryPanelHtml';
import { ExtractTemporaryChange } from '../extractTemporaryPreview';

// The extract-temporary panel reuses the shared rename-method view JS for its DOM
// behaviour (diff toggle, pagination, apply), so wire that up in jsdom and verify
// the M3-specific contract: there are NO selection checkboxes, so nothing is ever
// deselected and Apply always sends an empty deselected set.
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

function change(id: string): ExtractTemporaryChange {
  return {
    id,
    kind: 'methodRecompile',
    dictName: 'UserGlobals',
    className: 'M3Demo',
    isMeta: false,
    selector: 'compute',
    category: 'calc',
    oldSource: 'compute\n\t^ self a + self a',
    newSource: 'compute\n\t| t |\n\tt := self a.\n\t^ t + t',
  };
}

function mount(changes: ExtractTemporaryChange[], total: number, done: boolean) {
  const full = renderExtractTemporaryPanelHtml({
    newName: 't',
    total,
    occurrenceCount: 1,
    replaceAll: false,
    changes,
    done,
    outOfScope: { references: 0, skipped: 0, collision: null, decline: null },
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

describe('extract-temporary preview panel', () => {
  it('never deselects anything because there are no checkboxes', () => {
    const { handle } = mount([change('1')], 1, true);

    expect(handle.deselectedIds()).toEqual([]);
  });

  it('applies with an empty deselected set', () => {
    const { vscode } = mount([change('1')], 1, true);

    (document.getElementById('apply') as HTMLButtonElement).click();

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'apply', deselected: [] });
  });

  it('cancels through the shared view', () => {
    const { vscode } = mount([change('1')], 1, true);

    (document.getElementById('cancel') as HTMLButtonElement).click();

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'cancel' });
  });

  it('appends a freshly-fetched page and marks the pager done', () => {
    const { handle } = mount([change('1')], 2, false);

    handle.appendChanges(renderExtractTemporaryCards([change('2')]), true);

    expect(document.querySelectorAll('li.change')).toHaveLength(2);
    expect(document.getElementById('pager')?.classList.contains('hidden')).toBe(true);
  });
});
