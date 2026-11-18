import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';

/**
 * Regression for the Phase-5 rename bug.
 *
 * The enhanced inspector webview decides whether a table/tree cell carries rich
 * attribute-run styling by comparing the cell's server-sent `__typeLabel`
 * against the literal `'gtPhlowRunBasedText'` (in `cellHtml`). That literal is a
 * WIRE VALUE emitted by the server — `GtPhlowRunBasedText class>>typeLabel` in
 * the vendored `resources/enhancedInspector/gtoolkit-remote.gs` payload — NOT a
 * Jasper identifier. A rename that touches only the client comparison makes the
 * branch never match, silently downgrading styled cells to plain text.
 *
 * That regression was invisible to two safety nets: `tsc` never type-checks the
 * webview script (it is an injected string), and no test exercised `cellHtml`.
 * These tests pin both the behavior and the client<->server wire contract.
 */

const CLIENT_SRC = fs.readFileSync(path.join(__dirname, '..', 'enhancedInspector.ts'), 'utf8');
const SERVER_PAYLOAD = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'resources',
    'enhancedInspector',
    'gtoolkit-remote.gs',
  ),
  'utf8',
);

/** Slice a `function <name>(...) { ... }` declaration out of the webview script
 *  by matching braces. String/regex-naive, which is safe for the small pure
 *  helpers extracted here (none contain `{`/`}` inside string or regex
 *  literals). */
function extractFunction(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found in enhancedInspector.ts`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

/** Slice a `const <name> = { ... };` object literal out of the webview script. */
function extractConstObject(src: string, name: string): string {
  const start = src.indexOf(`const ${name} =`);
  if (start < 0) throw new Error(`const ${name} not found in enhancedInspector.ts`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1) + ';';
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

// Rebuild the pure rendering helpers in isolation and hand back cellHtml.
function loadCellHtml(): (raw: unknown) => string {
  const parts = [
    extractConstObject(CLIENT_SRC, 'GT_COLORS'),
    extractFunction(CLIENT_SRC, 'esc'),
    extractFunction(CLIENT_SRC, 'cssColor'),
    extractFunction(CLIENT_SRC, 'attrToCss'),
    extractFunction(CLIENT_SRC, 'applyRuns'),
    extractFunction(CLIENT_SRC, 'cellHtml'),
    'return cellHtml;',
  ];
  const factory = new Function(parts.join('\n')) as () => (raw: unknown) => string;
  return factory();
}

describe('enhanced inspector run-based-text rendering', () => {
  const cellHtml = loadCellHtml();

  it('applies attribute-run styling to a gtPhlowRunBasedText cell', () => {
    const html = cellHtml({
      __typeLabel: 'gtPhlowRunBasedText',
      sourceString: 'AB',
      attributeRuns: {
        items: [
          {
            startIndex: 1,
            endIndex: 2,
            attributes: [{ __typeLabel: 'phlowFontWeightAttribute', weight: 'bold' }],
          },
        ],
      },
    });
    // The rich-text branch must fire: 'A' is wrapped in a styled span, not plain.
    expect(html).toContain('font-weight:bold');
    expect(html).toContain('<span');
    expect(html).toContain('A');
  });

  it('renders a run-based-text cell with no runs as escaped plain text', () => {
    const html = cellHtml({
      __typeLabel: 'gtPhlowRunBasedText',
      sourceString: 'a<b>',
      attributeRuns: { items: [] },
    });
    expect(html).toBe('a&lt;b&gt;');
  });
});

interface FakeTextPane {
  className: string;
  style: { cssText: string; whiteSpace?: string; overflow?: string; minHeight?: string };
  innerHTML: string;
  insertAdjacentHTML(position: string, html: string): void;
}

// Rebuild renderStyledText, the renderer for text views and "Show all" prints.
function loadRenderStyledText(): (el: FakeTextPane, textData: unknown) => void {
  const parts = [
    extractConstObject(CLIENT_SRC, 'GT_COLORS'),
    extractFunction(CLIENT_SRC, 'esc'),
    extractFunction(CLIENT_SRC, 'cssColor'),
    extractFunction(CLIENT_SRC, 'attrToCss'),
    extractFunction(CLIENT_SRC, 'applyRuns'),
    'function highlightJson(str) { return esc(str); }',
    extractFunction(CLIENT_SRC, 'renderStyledText'),
    'return renderStyledText;',
  ];
  const factory = new Function(parts.join('\n')) as () => (
    el: FakeTextPane,
    textData: unknown,
  ) => void;
  return factory();
}

function fakeTextPane(): FakeTextPane {
  return {
    className: '',
    style: { cssText: '' },
    innerHTML: '',
    insertAdjacentHTML(_position, html) {
      this.innerHTML += html;
    },
  };
}

describe('enhanced inspector full print cut-short note', () => {
  const renderStyledText = loadRenderStyledText();

  it('notes the cap under a Show all print the host cut short', () => {
    const el = fakeTextPane();
    renderStyledText(el, { string: "'aaa...", stylerSpecification: null, cutShortAt: 1_000_000 });
    expect(el.innerHTML.startsWith("'aaa...<div")).toBe(true);
    expect(el.innerHTML).toContain('Cut short at about 1,000,000 characters.');
  });

  it('adds no note to a whole Show all print', () => {
    const el = fakeTextPane();
    renderStyledText(el, { string: 'an Account', stylerSpecification: null, cutShortAt: 0 });
    expect(el.innerHTML).toBe('an Account');
  });

  it('adds no note to the Print tab text that gtPrint abbreviated', () => {
    // The Print tab's own payload: 'truncated' only means "offer Show all".
    const el = fakeTextPane();
    renderStyledText(el, {
      string: 'anArray( 1, 2, 3...',
      stylerSpecification: null,
      truncated: true,
    });
    expect(el.innerHTML).toBe('anArray( 1, 2, 3...');
  });

  it('notes the cap under a parser-styled print too', () => {
    const el = fakeTextPane();
    renderStyledText(el, {
      string: '{}',
      stylerSpecification: {
        __typeLabel: 'remotePhlowTextParserStylerSpecification',
        parserClassName: 'JSONParser',
      },
      cutShortAt: 1_000_000,
    });
    expect(el.innerHTML).toContain('Cut short');
  });
});

describe('enhanced inspector Show all link', () => {
  type AddShowAllBar = (
    col: { id: number; oop: string },
    contentPane: HTMLElement,
    methodSelector: string,
    error: string | null,
  ) => void;

  function load() {
    const dom = new JSDOM('<div id="pane">abbreviated print</div>');
    const posted: unknown[] = [];
    const vscode = { postMessage: (m: unknown) => posted.push(m) };
    const addShowAllBar = new Function(
      'document',
      'vscode',
      `${extractFunction(CLIENT_SRC, 'addShowAllBar')}\nreturn addShowAllBar;`,
    )(dom.window.document, vscode) as AddShowAllBar;
    const pane = dom.window.document.getElementById('pane') as HTMLElement;
    return { addShowAllBar, pane, posted };
  }

  it('asks the host for the whole print and drops the link', () => {
    const { addShowAllBar, pane, posted } = load();
    addShowAllBar({ id: 4, oop: '1000' }, pane, 'gtPrintFor:', null);

    (pane.querySelector('.show-all-bar a') as HTMLElement).click();

    expect(posted).toEqual([
      { command: 'fetchFullPrintString', columnId: 4, oop: '1000', methodSelector: 'gtPrintFor:' },
    ]);
    expect(pane.querySelector('.show-all-bar')).toBeNull();
  });

  it('puts the link back with the reason after a failure, keeping the text shown', () => {
    const { addShowAllBar, pane } = load();
    addShowAllBar({ id: 4, oop: '1000' }, pane, 'gtPrintFor:', 'session busy');

    expect(pane.textContent?.startsWith('abbreviated print')).toBe(true);
    expect(pane.querySelector('.show-all-bar a')?.textContent).toBe('Show all…');
    expect(pane.querySelector('.show-all-error')?.textContent).toBe(
      "Couldn't show all: session busy",
    );
  });

  it('never shows two links', () => {
    const { addShowAllBar, pane } = load();
    addShowAllBar({ id: 4, oop: '1000' }, pane, 'gtPrintFor:', null);
    addShowAllBar({ id: 4, oop: '1000' }, pane, 'gtPrintFor:', 'session busy');

    expect(pane.querySelectorAll('.show-all-bar')).toHaveLength(1);
  });
});

describe('enhanced inspector Show all link on returning to a tab', () => {
  type Col = {
    id: number;
    oop: string;
    specs: { methodSelector: string; viewName: string }[];
    cachedViewData: Record<string, string>;
    showAllOffered: Record<string, boolean>;
    el: { tabBar: HTMLElement; contentPane: HTMLElement };
  };

  /** activateTab, drawing a cached tab as its data string and the real Show all bar. */
  function load() {
    const dom = new JSDOM('<div id="bar"></div><div id="pane"></div>');
    const doc = dom.window.document;
    const vscode = { postMessage: () => undefined };
    const fns = new Function(
      'document',
      'vscode',
      `function renderMetaTab() {}
function renderEnhancedInspectorContent(col, pane, spec, data) { pane.textContent = data; }
${extractFunction(CLIENT_SRC, 'addShowAllBar')}
${extractFunction(CLIENT_SRC, 'activateTab')}
return activateTab;`,
    )(doc, vscode) as (col: Col, methodSelector: string) => void;
    const col: Col = {
      id: 4,
      oop: '1000',
      specs: [{ methodSelector: 'gtPrintFor:', viewName: 'GtPhlowTextEditorViewSpecification' }],
      cachedViewData: { 'gtPrintFor:': 'abbreviated print' },
      showAllOffered: {},
      el: { tabBar: doc.getElementById('bar')!, contentPane: doc.getElementById('pane')! },
    };
    return { activateTab: fns, col };
  }

  it('offers Show all again on a cut-short print drawn from the cache', () => {
    const { activateTab, col } = load();
    col.showAllOffered['gtPrintFor:'] = true;

    activateTab(col, 'gtPrintFor:');

    expect(col.el.contentPane.querySelector('.show-all-bar a')?.textContent).toBe('Show all…');
  });

  it('offers nothing on a print already shown in full', () => {
    const { activateTab, col } = load();
    col.showAllOffered['gtPrintFor:'] = false;

    activateTab(col, 'gtPrintFor:');

    expect(col.el.contentPane.querySelector('.show-all-bar')).toBeNull();
  });
});

describe('enhanced inspector run-based-text wire contract', () => {
  it('client cellHtml comparison matches the exact __typeLabel the server emits', () => {
    // Client: the value cellHtml checks to enter the rich-text branch.
    const clientMatch = CLIENT_SRC.match(/raw\.__typeLabel === '([^']+)'/);
    expect(clientMatch, 'raw.__typeLabel comparison not found in cellHtml').not.toBeNull();
    const clientLabel = clientMatch![1];

    // Server: GtPhlowRunBasedText class>>typeLabel return value in the payload.
    const serverMatch = SERVER_PAYLOAD.match(
      /classmethod:\s+GtPhlowRunBasedText\s*\n\s*typeLabel\b[\s\S]{0,40}?\^\s*'([^']+)'/,
    );
    expect(
      serverMatch,
      'GtPhlowRunBasedText>>typeLabel not found in gtoolkit-remote.gs',
    ).not.toBeNull();
    const serverLabel = serverMatch![1];

    expect(clientLabel).toBe(serverLabel);
    expect(clientLabel).toBe('gtPhlowRunBasedText');
  });
});
