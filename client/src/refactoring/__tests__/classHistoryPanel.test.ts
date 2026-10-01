// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  renderClassHistoryHtml,
  renderVersionRows,
  formatLocalTimestamp,
} from '../classHistoryPanelHtml';
import { ClassVersion } from '../classHistoryModel';

beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../classHistoryPanelView.js'), 'utf8');
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
  return (globalThis as unknown as { ClassHistoryPanel: PanelApi }).ClassHistoryPanel;
}

const versions: ClassVersion[] = [
  {
    index: 2,
    name: 'Bar',
    oop: 60097537,
    timeStamp: '2026-07-17T09:56:44',
    userId: 'SystemUser',
    isCurrent: true,
    definition: "Object subclass: 'Bar'",
    changedMethods: [{ side: 'instance', selector: 'm2', change: 'added' }],
  },
  {
    index: 1,
    name: 'Foo',
    oop: 60084737,
    timeStamp: '2026-07-17T09:55:53',
    userId: 'SystemUser',
    isCurrent: false,
    definition: "Object subclass: 'Foo'",
    changedMethods: [{ side: 'instance', selector: 'm1', change: 'added' }],
  },
];

function mount() {
  const full = renderClassHistoryHtml({
    className: 'Bar',
    versions,
    nonce: 'test',
    script: '',
  });
  const m = full.match(/<body([^>]*)>([\s\S]*)<\/body>/)!;
  document.body.innerHTML = m[2];
  const vscode = { postMessage: vi.fn() };
  const handle = api().wire(document, vscode);
  return { handle, vscode, full };
}

describe('class history viewer HTML', () => {
  it('shows Restore and Remove buttons only on non-current versions', () => {
    const { full } = mount();

    const currentRow = full.match(/data-index="2"[\s\S]*?<\/li>/)![0];
    const oldRow = full.match(/data-index="1"[\s\S]*?<\/li>/)![0];
    expect(currentRow).not.toContain('class="restore"');
    expect(currentRow).not.toContain('class="remove"');
    expect(oldRow).toContain('class="restore"');
    expect(oldRow).toContain('class="remove"');
  });

  it('shows each version’s name, timestamp (in the user’s locale), author, and object id', () => {
    const html = renderVersionRows(versions);

    expect(html).toContain('Foo');
    expect(html).toContain(formatLocalTimestamp('2026-07-17T09:55:53'));
    expect(html).toContain('SystemUser');
    expect(html).toContain('oop 60084737');
  });

  it('renders an ISO timestamp in the user’s locale, not verbatim', () => {
    const html = renderVersionRows(versions);

    const localized = formatLocalTimestamp('2026-07-17T09:55:53');
    expect(localized).not.toBe('2026-07-17T09:55:53');
    expect(html).not.toContain('2026-07-17T09:55:53');
  });

  it('renders the changed-method glyphs', () => {
    const html = renderVersionRows(versions);

    expect(html).toContain('m2');
    expect(html).toContain('mc added');
  });
});

describe('class history viewer behaviour', () => {
  it('asks the host to restore the clicked version', () => {
    const { vscode } = mount();

    (document.querySelector('li.version[data-index="1"] .restore') as HTMLButtonElement).click();

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'restore', index: 1 });
  });

  it('asks the host to remove the clicked version', () => {
    const { vscode } = mount();

    (document.querySelector('li.version[data-index="1"] .remove') as HTMLButtonElement).click();

    expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'remove', index: 1 });
  });

  it('expands a version to reveal its definition', () => {
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

  // A class name does not identify a class: the same name can be bound in several dictionaries,
  // each with its own history, and Restore rewrites whichever one the panel is showing. These
  // pin that the panel says WHICH -- the help the user had no way to get before (#396).
  describe('naming the dictionary the history belongs to', () => {
    const html = (dictName?: string): string =>
      renderClassHistoryHtml({
        className: 'Shadowed',
        versions,
        nonce: 'n',
        script: '',
        dictName,
      });

    it('names the dictionary beside the class in the header', () => {
      expect(html('DictionaryB')).toContain(
        'Definition history of <code>Shadowed</code> in <code>DictionaryB</code>',
      );
    });

    it('leaves the header unqualified when no dictionary was given', () => {
      expect(html(undefined)).toContain('Definition history of <code>Shadowed</code></div>');
    });

    it('escapes a dictionary name rather than letting it reach the DOM as markup', () => {
      const out = html('<img src=x>');
      expect(out).not.toContain('<img src=x>');
      expect(out).toContain('&lt;img src=x&gt;');
    });
  });
});
