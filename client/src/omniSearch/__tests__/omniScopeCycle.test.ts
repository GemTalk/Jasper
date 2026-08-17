// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { renderOmniHtml } from '../omniSearchShared';

// #428 item 26: Tab / Shift+Tab from the search field cycles the scope tabs (the JetBrains
// Search-Everywhere gesture), wrapping around in render order — All, filter scopes, then the explicit
// search scopes — and a footer legend advertises the shortcut.

beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../omniSearchView.js'), 'utf8');
  new Function(source)();
  Element.prototype.scrollIntoView = vi.fn();
});

interface ViewApi {
  wire(
    doc: Document,
    vscode: { postMessage: (m: unknown) => void },
  ): {
    renderTabs: (categories: unknown, scopeId: string | null) => void;
  };
}

function api(): ViewApi {
  return (globalThis as unknown as { OmniSearchView: ViewApi }).OmniSearchView;
}

const SHELL =
  '<div id="omni">' +
  '<div id="tabs"></div>' +
  '<div id="searchbar">' +
  '<div id="field"><input id="query" type="text"><button id="clear" style="display:none">×</button></div>' +
  '<button id="case">Aa</button>' +
  '<button id="refindicator" aria-pressed="false" style="display:none">↗ References</button>' +
  '</div>' +
  '<div id="breadcrumb"></div>' +
  '<div id="error"></div>' +
  '<div id="body"><ul id="results"></ul><div id="preview"></div></div>' +
  '<span id="hints"></span><span id="count"></span>' +
  '<button id="loadMore" style="display:none">Load more</button>' +
  '<button id="loadAll" style="display:none">Load all</button>' +
  '</div>';

const CATS = [
  { id: 'classes', label: 'Classes', explicitOnly: false },
  { id: 'methods', label: 'Methods', explicitOnly: false },
  { id: 'source', label: 'Source', explicitOnly: true },
];
// Render order → cycle order: [null, 'classes', 'methods', 'source'].

function mount() {
  document.body.innerHTML = SHELL;
  const vscode = { postMessage: vi.fn() };
  const handle = api().wire(document, vscode);
  vscode.postMessage.mockClear();
  const input = document.getElementById('query') as HTMLInputElement;
  return { handle, vscode, input };
}

function pressTab(input: HTMLElement, opts: KeyboardEventInit = {}) {
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, ...opts }),
  );
}

function lastSetScope(vscode: { postMessage: ReturnType<typeof vi.fn> }) {
  const calls = vscode.postMessage.mock.calls
    .map((c) => c[0] as { command: string; scopeId?: string | null })
    .filter((m) => m.command === 'setScope');
  return calls.length ? calls[calls.length - 1] : undefined;
}

beforeEach(() => {
  document.body.className = '';
});

describe('scope cycling with Tab / Shift+Tab (#428 #26)', () => {
  it('Tab from the field advances to the next scope', () => {
    const { handle, vscode, input } = mount();
    handle.renderTabs(CATS, null); // active = All
    pressTab(input);
    expect(lastSetScope(vscode)).toEqual({ command: 'setScope', scopeId: 'classes' });
  });

  it('Tab steps through every scope in render order and wraps back to All', () => {
    const { handle, vscode, input } = mount();
    const seen: (string | null)[] = [];
    let active: string | null = null;
    for (let i = 0; i < 4; i++) {
      handle.renderTabs(CATS, active);
      pressTab(input);
      active = lastSetScope(vscode)!.scopeId ?? null;
      seen.push(active);
    }
    expect(seen).toEqual(['classes', 'methods', 'source', null]);
  });

  it('Shift+Tab from All wraps to the last (explicit) scope', () => {
    const { handle, vscode, input } = mount();
    handle.renderTabs(CATS, null);
    pressTab(input, { shiftKey: true });
    expect(lastSetScope(vscode)).toEqual({ command: 'setScope', scopeId: 'source' });
  });

  it('does not cycle when a modifier other than Shift is held', () => {
    const { handle, vscode, input } = mount();
    handle.renderTabs(CATS, null);
    pressTab(input, { ctrlKey: true });
    pressTab(input, { metaKey: true });
    pressTab(input, { altKey: true });
    expect(lastSetScope(vscode)).toBeUndefined();
  });

  it('is a no-op when there is only the All scope', () => {
    const { handle, vscode, input } = mount();
    handle.renderTabs([], null);
    pressTab(input);
    expect(lastSetScope(vscode)).toBeUndefined();
  });
});

describe('scope-switch legend (#428 #26)', () => {
  for (const showPin of [false, true]) {
    it(`the footer hints advertise Tab to switch scope (showPin=${showPin})`, () => {
      const html = renderOmniHtml({ showPin });
      expect(html).toContain('switch scope');
      expect(html).toContain('<kbd>Tab</kbd>');
    });
  }
});
