// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  renderMethodHistoryHtml,
  renderVersionRows,
  formatLocalTimestamp,
} from '../methodHistoryPanelHtml';
import { MethodVersion } from '../methodHistoryModel';

beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../methodHistoryPanelView.js'), 'utf8');
  new Function(source)();
});

interface PanelApi {
  wire(
    doc: Document,
    vscode: { postMessage: (m: unknown) => void },
  ): {
    wireRows: () => void;
    handleMessage: (m: unknown) => void;
  };
}
function api(): PanelApi {
  return (globalThis as unknown as { MethodHistoryPanel: PanelApi }).MethodHistoryPanel;
}

const versions: MethodVersion[] = [
  {
    index: 2,
    timeStamp: '2026-08-25T09:56:44',
    userId: 'SystemUser',
    category: 'accessing',
    isCurrent: true,
    source: 'bar\n  ^ 2',
    notInHistory: false,
  },
  {
    index: 1,
    timeStamp: '2026-08-25T09:55:53',
    userId: 'DataCurator',
    category: 'accessing',
    isCurrent: false,
    source: 'bar\n  ^ 1',
    notInHistory: false,
  },
];

function mount(vs: MethodVersion[] = versions) {
  const full = renderMethodHistoryHtml({
    methodLabel: 'Foo>>bar',
    versions: vs,
    nonce: 'test',
    script: '',
  });
  const m = full.match(/<body([^>]*)>([\s\S]*)<\/body>/)!;
  document.body.innerHTML = m[2];
  const vscode = { postMessage: vi.fn() };
  const handle = api().wire(document, vscode);
  return { handle, vscode, full };
}

describe('method history viewer HTML', () => {
  it('offers Restore and Diff only on non-current versions', () => {
    const { full } = mount();

    const currentRow = full.match(/data-index="2"[\s\S]*?<\/li>/)![0];
    const oldRow = full.match(/data-index="1"[\s\S]*?<\/li>/)![0];
    expect(currentRow).not.toContain('class="restore"');
    expect(currentRow).not.toContain('class="diff"');
    expect(oldRow).toContain('class="restore"');
    expect(oldRow).toContain('class="diff"');
  });

  it('badges the current version', () => {
    const { full } = mount();

    expect(full).toContain('class="version is-current" data-index="2"');
    const currentRow = full.match(/data-index="2"[\s\S]*?<\/li>/)![0];
    expect(currentRow).toContain('>current<');
  });

  it('shows each version’s timestamp in the user’s locale, and its author', () => {
    const html = renderVersionRows(versions);

    expect(html).toContain(formatLocalTimestamp('2026-08-25T09:55:53'));
    expect(html).toContain('DataCurator');
    expect(html).not.toContain('2026-08-25T09:55:53');
  });

  it('renders an inline diff of an old version against the current one', () => {
    const html = renderVersionRows(versions);

    const oldRow = html.match(/data-index="1"[\s\S]*?<\/li>/)![0];
    expect(oldRow).toContain('class="diff"'); // the button title contains "diff"
    expect(oldRow).toContain('dl del'); // "^ 1" removed
    expect(oldRow).toContain('dl add'); // "^ 2" added
  });

  it('shows a synthetic current version plainly, with no restore/diff actions', () => {
    const synthetic: MethodVersion[] = [
      {
        index: 0,
        timeStamp: '',
        userId: '',
        category: 'accessing',
        isCurrent: true,
        source: 'bar\n  ^ 42',
        notInHistory: true,
      },
    ];

    const html = renderVersionRows(synthetic);

    expect(html).toContain('is-current');
    expect(html).not.toContain('class="restore"');
    expect(html).not.toContain('class="diff"');
  });
});

describe('method history viewer behaviour', () => {
  it('asks the host to restore the clicked version', () => {
    const { vscode } = mount();

    (document.querySelector('li.version[data-index="1"] .restore') as HTMLButtonElement).click();

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'restore', index: 1 });
  });

  it('asks the host to open a side-by-side diff for the clicked version', () => {
    const { vscode } = mount();

    (document.querySelector('li.version[data-index="1"] .diff') as HTMLButtonElement).click();

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'diff', index: 1 });
  });

  it('expands a version to reveal its source', () => {
    mount();
    const row = document.querySelector('li.version[data-index="1"]')!;

    (row.querySelector('.version-head') as HTMLElement).click();

    expect(row.querySelector('.detail')?.classList.contains('hidden')).toBe(false);
  });

  it('re-renders the version list when the host refreshes after a restore', () => {
    const { handle } = mount();

    handle.handleMessage({ command: 'refresh', html: renderVersionRows([versions[0]]) });

    expect(document.querySelectorAll('li.version')).toHaveLength(1);
  });

  it('keeps an expanded version open across a refresh, so the diff is not lost', () => {
    const { handle } = mount();
    const oldRow = document.querySelector('li.version[data-index="1"]')!;
    (oldRow.querySelector('.version-head') as HTMLElement).click();
    expect(oldRow.querySelector('.detail')?.classList.contains('hidden')).toBe(false);

    // A new version is compiled elsewhere: the list re-renders with a new current
    // on top, but the row the user was viewing (index 1) stays expanded.
    const withNewCurrent: MethodVersion[] = [
      { ...versions[0], index: 3, isCurrent: true, source: 'bar\n  ^ 3' },
      { ...versions[0], index: 2, isCurrent: false, source: 'bar\n  ^ 2' },
      { ...versions[1], index: 1, isCurrent: false },
    ];
    handle.handleMessage({ command: 'refresh', html: renderVersionRows(withNewCurrent) });

    const reRenderedOld = document.querySelector('li.version[data-index="1"]')!;
    expect(reRenderedOld.querySelector('.detail')?.classList.contains('hidden')).toBe(false);
    // The newly-added current version comes in collapsed.
    const newCurrent = document.querySelector('li.version[data-index="3"]')!;
    expect(newCurrent.querySelector('.detail')?.classList.contains('hidden')).toBe(true);
  });
});
