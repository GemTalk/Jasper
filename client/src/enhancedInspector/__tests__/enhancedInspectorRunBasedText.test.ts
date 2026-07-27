import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

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
