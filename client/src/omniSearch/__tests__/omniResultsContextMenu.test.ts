// @vitest-environment jsdom
/**
 * Right-clicking the GemStone Search results list.
 *
 * A webview with no context menu of its own falls through to VS Code's, which is
 * Cut / Copy / Paste. Over a result row all three are inert — a row is a place to
 * go, not text to edit — and being the only menu offered they read as the whole
 * of what a right-click can do with a result. The list suppresses them.
 *
 * The PREVIEW pane and the query box deliberately keep theirs: the preview is
 * source you may well want to copy out, and the box is a text field where Paste
 * is the point. That is the same split the Inspector draws between its Meta tab
 * and its Definition / Comment sub-tabs.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

beforeAll(() => {
  const source = fs.readFileSync(path.resolve(__dirname, '../omniSearchView.js'), 'utf8');
  new Function(source)();
  Element.prototype.scrollIntoView = vi.fn();
});

interface ViewApi {
  wire(doc: Document, vscode: { postMessage: (m: unknown) => void }): unknown;
}

function api(): ViewApi {
  return (globalThis as unknown as { OmniSearchView: ViewApi }).OmniSearchView;
}

const SHELL =
  '<div id="omni">' +
  '<div id="tabs"></div>' +
  '<div id="field"><input id="query" type="text"><button id="clear" style="display:none">×</button></div>' +
  '<button id="case">Aa</button>' +
  '<button id="pin">📌</button>' +
  '<div id="scopehint" style="display:none"></div>' +
  '<div id="breadcrumb"></div>' +
  '<div id="error"></div>' +
  '<div id="body"><ul id="results"></ul><div id="preview"></div></div>' +
  '<span id="hints"></span><span id="count"></span><span id="capnote"></span>' +
  '<button id="loadMore" style="display:none">Load more</button>' +
  '<button id="loadAll" style="display:none">Load all</button>' +
  '</div>';

/** Right-click `el`; answers whether the host menu was suppressed. */
function rightClick(el: Element): boolean {
  const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev.defaultPrevented;
}

beforeEach(() => {
  document.body.innerHTML = SHELL;
  api().wire(document, { postMessage: vi.fn() });
});

describe('right-clicking the results list', () => {
  it('suppresses the host Cut/Copy/Paste menu', () => {
    expect(rightClick(document.getElementById('results')!)).toBe(true);
  });

  it('suppresses it over a row as well as over the empty list', () => {
    // A row is what a right-click actually lands on, and the handler sits on the
    // list — so this turns on the event reaching it by bubbling.
    const li = document.createElement('li');
    document.getElementById('results')!.appendChild(li);

    expect(rightClick(li)).toBe(true);
  });
});

describe('right-clicking elsewhere in the panel', () => {
  it('leaves the preview pane its menu, where Copy is the point', () => {
    expect(rightClick(document.getElementById('preview')!)).toBe(false);
  });

  it('leaves the query box its menu, where Paste is the point', () => {
    expect(rightClick(document.getElementById('query')!)).toBe(false);
  });
});
